// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as create } from "@/app/api/target-lists/route";
import { POST as preview } from "@/app/api/target-lists/import/preview/route";
import { GET as accounts } from "@/app/api/target-lists/[id]/accounts/route";
import { POST as refresh } from "@/app/api/signals/refresh/route";
import { resetPersistenceForTests, appPersistence } from "@/lib/persistence";
import { resetSessionAccountsForTests } from "@/lib/session-store";
import { importTargetList } from "@/lib/target-lists";

beforeEach(() => { vi.stubEnv("UPSTASH_REDIS_REST_URL", ""); vi.stubEnv("KV_REST_API_URL", ""); vi.stubEnv("ZOOMINFO_PROVIDER", "mock"); resetPersistenceForTests(); resetSessionAccountsForTests(); });
afterEach(() => vi.unstubAllEnvs());
const body = { name: "Route test", filename: "test.csv", rows: [{ rowNumber: 2, account_name: "Health", website: "health.com" }] };
const jsonRequest = (path: string, data: unknown, origin = "http://localhost") => new NextRequest(`http://localhost${path}`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(data) });

it("enforces same-origin requests and revalidates submitted rows", async () => {
  expect((await create(jsonRequest("/api/target-lists", body, "https://other.com"))).status).toBe(403);
  expect((await create(jsonRequest("/api/target-lists", { ...body, rows: [{ account_name: "Name only" }] }))).status).toBe(400);
  expect((await create(jsonRequest("/api/target-lists", { ...body, rows: [{ ...body.rows[0], suggested_entry_offer: "=SUM(1)" }] }))).status).toBe(400);
  const response = await create(jsonRequest("/api/target-lists", body));
  expect(response.status).toBe(201);
  const { list } = await response.json();
  const result = await accounts(new NextRequest("http://localhost"), { params: Promise.resolve({ id: list.id }) });
  const workspace = await result.json();
  expect(workspace.details).toHaveLength(1); expect(workspace.details[0].account.name).toBe("Health");
  expect(workspace.metrics.canonicalAccounts).toBe(1);
});

it("previews actual multipart CSV without saving accounts or calling enrichment", async () => {
  const form = new FormData();
  form.set("file", new File(["account_name,website\nHealth,health.com"], "test.csv", { type: "text/csv" }));
  const response = await preview(new NextRequest("http://localhost/api/target-lists/import/preview", { method: "POST", headers: { origin: "http://localhost" }, body: form }));
  expect(response.status).toBe(200);
  expect((await response.json()).errors).toEqual([]);
  expect(await appPersistence().loadAccounts()).toBeNull();
});

it("rejects cross-list batches, oversized batches and mock enrichment", async () => {
  const list = await importTargetList(body);
  const accountId = list.memberships[0].accountId;
  expect((await refresh(jsonRequest("/api/signals/refresh", { listId: list.id, accountIds: ["not-member"] }))).status).toBe(400);
  expect((await refresh(jsonRequest("/api/signals/refresh", { listId: list.id, accountIds: Array(6).fill(accountId) }))).status).toBe(400);
  expect((await refresh(jsonRequest("/api/signals/refresh", { listId: list.id, accountIds: [accountId] }))).status).toBe(409);
  expect((await refresh(jsonRequest("/api/signals/refresh", { accountId }))).status).toBe(200);
  const persisted = (await appPersistence().loadAccounts())!.find((account) => account.id === accountId)!;
  expect(persisted.signal.source.provenance).toBe("unknown");
});
