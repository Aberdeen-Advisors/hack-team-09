// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { parseTargetFile, validateImportRows, MAX_IMPORT_BYTES, normalizedWebsite } from "@/lib/target-import";
import { accountsForList, changeTargetList, getTargetList, importTargetList, listSummaries, loadTargetLists, visibleAccounts } from "@/lib/target-lists";
import { appPersistence, resetPersistenceForTests } from "@/lib/persistence";
import { loadAccounts, resetSessionAccountsForTests } from "@/lib/session-store";
import { scoreAccount } from "@/lib/scoring";
import { groundedAccount, evidenceKey } from "@/lib/evidence";
import { refreshCandidates, zoomInfoInternalsForTests } from "@/lib/zoominfo-mcp";
import { liveAccount } from "./fixtures";

beforeEach(() => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", ""); vi.stubEnv("KV_REST_API_URL", ""); vi.stubEnv("ZOOMINFO_MCP_REQUEST_SPACING_MS", "0");
  resetPersistenceForTests(); resetSessionAccountsForTests();
});
afterEach(() => vi.unstubAllEnvs());
const row = (overrides = {}) => ({ rowNumber: 2, account_name: "Example Health", website: "examplehealth.com", ...overrides });
const request = (name = "Health targets", rows = [row()]) => ({ name, filename: "health.csv", rows });

describe("target file parsing", () => {
  it("parses UTF-8, quoted commas, reordered headers and blank rows without coercing company names", async () => {
    const file = Buffer.from('\uFEFFwebsite, ACCOUNT_NAME ,tier,vertical\r\nWWW.EXAMPLE.COM/about,"Santé, Inc.",1,Healthcare\r\n , , , \r\nother.com,8x8,2,Technology');
    const preview = await parseTargetFile("targets.CSV", file, []);
    expect(preview.errors).toEqual([]);
    expect(preview.rows).toEqual([{ rowNumber: 2, account_name: "Santé, Inc.", website: "https://example.com/", tier: 1, vertical: "Healthcare" }, { rowNumber: 4, account_name: "8x8", website: "https://other.com/", tier: 2, vertical: "Technology" }]);
  });
  it("imports only the first XLSX worksheet and rejects formula and hyperlink cells", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Accounts");
    sheet.addRow(["account_name", "website", "tier"]);
    sheet.addRow(["Health", "health.com", 1]);
    book.addWorksheet("Ignore").addRow(["unrelated"]);
    const preview = await parseTargetFile("targets.xlsx", Buffer.from(await book.xlsx.writeBuffer()), []);
    expect(preview.errors).toEqual([]); expect(preview.rows[0].tier).toBe(1); expect(preview.warnings).toHaveLength(1);
    sheet.getCell("C2").value = { formula: "1+1", result: 2 };
    sheet.getCell("B2").value = { text: "health.com", hyperlink: "https://health.com" };
    const invalid = await parseTargetFile("targets.xlsx", Buffer.from(await book.xlsx.writeBuffer()), []);
    expect(invalid.errors.filter((error) => error.message.includes("non-scalar"))).toHaveLength(2);
    expect(invalid.errors.every((error) => error.row === 2)).toBe(true);
  });
  it.each([
    ["account_name,website,extra\nHealth,health.com,x", "Unknown"],
    ["account_name,account_name\nHealth,Other", "Duplicate header"],
    ["account_name\nHealth", "Required header"],
    ["account_name,website\nHealth,", "Invalid input"],
    ["account_name,website\nA,health.com\nB,www.health.com", "Duplicate company"],
    ["account_name,website,zoominfo_company_id\nA,a.com,123\nB,b.com,123", "Duplicate company"],
    ["account_name,website,tier\nHealth,health.com,1.5", "positive integer"],
    ["account_name,website,vertical\nHealth,health.com,=SUM(1)", "Formula"],
  ])("reports invalid CSV at the offending row: %s", async (csv, message) => {
    const preview = await parseTargetFile("targets.csv", Buffer.from(csv), []);
    expect(preview.errors.some((error) => error.message.includes(message))).toBe(true);
    expect(preview.errors.every((error) => error.row > 0)).toBe(true);
  });
  it("rejects unsupported files, invalid UTF-8, oversized files and too many rows", async () => {
    await expect(parseTargetFile("targets.xls", Buffer.from("x"), [])).rejects.toThrow("CSV or XLSX");
    await expect(parseTargetFile("targets.csv", Buffer.alloc(MAX_IMPORT_BYTES + 1), [])).rejects.toThrow("4 MB");
    await expect(parseTargetFile("targets.csv", Buffer.from([0xff, 0xfe]), [])).rejects.toThrow();
    expect(validateImportRows(Array.from({ length: 501 }, (_, index) => row({ rowNumber: index + 2, website: `account${index}.com` })), []).errors).toContainEqual(expect.objectContaining({ column: "file" }));
  });
  it.each(["javascript:alert(1)", "ftp://health.com", "https://user:pass@health.com", "localhost", "not a website", "http://127.0.0.1", "-health.com"])("rejects invalid website %s", (website) => {
    expect(() => normalizedWebsite(website)).toThrow();
  });
});

describe("named lists and shared evidence", () => {
  it("migrates existing accounts once and does not recreate a deleted starter list", async () => {
    const lists = await loadTargetLists();
    expect(lists[0].name).toBe("Starter Accounts");
    await changeTargetList("starter", { delete: true, revision: 1 });
    expect(await loadTargetLists()).toEqual([]);
    expect(await visibleAccounts()).toEqual([]);
    expect((await loadAccounts()).length).toBeGreaterThan(0);
  });
  it("shares company evidence while keeping list context independent and outside model inputs", async () => {
    const account = liveAccount();
    await appPersistence().saveAccounts([account]);
    const before = evidenceKey(account);
    const a = await importTargetList(request("Campaign A", [row({ account_name: "DraftKings", website: account.website, tier: 1, relationship_status: "Existing client", suggested_entry_offer: "SECRET OFFER" })]));
    const b = await importTargetList(request("Campaign B", [row({ website: account.website, tier: 2 })]));
    expect(a.memberships[0].accountId).toBe(b.memberships[0].accountId);
    expect(a.memberships[0].tier).toBe(1); expect(b.memberships[0].tier).toBe(2);
    const stored = (await loadAccounts())[0];
    expect(evidenceKey(stored)).toBe(before);
    expect(scoreAccount(stored)).toEqual(scoreAccount(account));
    expect(JSON.stringify(groundedAccount(stored))).not.toMatch(/SECRET OFFER|Existing client/);
    expect((await listSummaries()).find((list) => list.id === a.id)?.verified).toBe(1);
  });
  it("replaces memberships atomically, retains orphaned records, and reuses them later", async () => {
    const a = await importTargetList(request());
    const originalId = a.memberships[0].accountId;
    const replaced = await importTargetList({ ...request(a.name, [row({ website: "second.com" })]), revision: a.revision }, a.id);
    expect(replaced.memberships).toHaveLength(1);
    expect(replaced.memberships[0].accountId).not.toBe(originalId);
    expect((await visibleAccounts()).some((account) => account.id === originalId)).toBe(false);
    expect((await loadAccounts()).some((account) => account.id === originalId)).toBe(true);
    const reuse = await importTargetList(request("Reuse"));
    expect(reuse.memberships[0].accountId).toBe(originalId);
  });
  it("rejects invalid rows and stale revisions without partially changing memberships or accounts", async () => {
    const list = await importTargetList(request());
    const before = await loadAccounts();
    await expect(importTargetList({ ...request(list.name, [row({ website: "new.com" }), row({ rowNumber: 3, website: "" })]), revision: list.revision }, list.id)).rejects.toThrow("Fix all");
    expect(await loadAccounts()).toEqual(before);
    expect(await getTargetList(list.id)).toEqual(list);
    await changeTargetList(list.id, { name: "Renamed", revision: list.revision });
    await expect(importTargetList({ ...request(), revision: list.revision }, list.id)).rejects.toThrow("changed");
    await expect(importTargetList(request("RENAMED"))).rejects.toThrow("already exists");
  });
  it("does not overwrite account snapshots during an active refresh", async () => {
    await loadTargetLists();
    await appPersistence().acquireLock("zoominfo-refresh", "live-refresh", 60);
    await expect(importTargetList(request())).rejects.toMatchObject({ status: 409 });
    await appPersistence().releaseLock("zoominfo-refresh", "live-refresh");
    expect((await importTargetList(request())).memberships).toHaveLength(1);
  });
  it("creates accounts with zero evidence points and no invented contacts", async () => {
    const list = await importTargetList(request());
    const account = accountsForList(list, await loadAccounts())[0];
    expect(scoreAccount(account).total).toBe(0); expect(account.buyers).toEqual([]);
    expect(account.signal.source.provenance).toBe("unknown");
    expect(account.industry).toBe("Not verified");
  });
  it("detects identifier conflicts and deduplicates canonical seed aliases", async () => {
    const account = liveAccount(); account.providerIds = { zoominfoCompanyId: "123" };
    expect(validateImportRows([row({ website: account.website, zoominfo_company_id: "456" })], [account]).errors[0].message).toContain("conflict");
    expect(validateImportRows([row({ website: "wrong.com", zoominfo_company_id: "123" })], [account]).errors[0].message).toContain("conflict");
    const duplicate = { ...account, id: "alias", duplicateOf: account.id };
    expect(validateImportRows([row({ website: account.website })], [duplicate, account]).classifications[0].accountId).toBe(account.id);
    expect(refreshCandidates([account, duplicate], undefined, [account.id, duplicate.id])).toHaveLength(1);
    expect(() => refreshCandidates([account], undefined, Array(6).fill(account.id))).toThrow("five");
  });
  it("blocks an uploaded company ID that disagrees with ZoomInfo before fetching signals", async () => {
    const account = liveAccount(); account.providerIds = { zoominfoCompanyId: "999" };
    const client = { callTool: vi.fn().mockResolvedValue({ structuredContent: { companies: [{ companyId: "123", website: "draftkings.com" }] } }) };
    await expect(zoomInfoInternalsForTests.refreshOneAccount(client as never, account, [])).rejects.toThrow("conflicts");
    expect(client.callTool).toHaveBeenCalledTimes(1);
  });
});
