import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appPersistence } from "@/lib/persistence";
import { loadAccounts } from "@/lib/session-store";
import { accountSchema, targetListSchema, type Account, type TargetList, type TargetListSummary } from "@/lib/schemas";
import { validateImportRows, type ImportPreview, type ImportRow } from "@/lib/target-import";
import { accountMetrics, listAccountDetails } from "@/lib/repository";

export class ListError extends Error {
  constructor(message: string, public status = 400, public errors?: ImportPreview["errors"]) { super(message); }
}

// Shared with the live refresh writer: neither may overwrite the other's snapshot.
export async function withWorkspaceLock<T>(work: () => Promise<T>): Promise<T> {
  const persistence = appPersistence();
  const owner = randomUUID();
  if (!await persistence.acquireLock("zoominfo-refresh", owner, 180)) throw new ListError("An account update is already running. Try again shortly.", 409);
  try { return await work(); } finally { await persistence.releaseLock("zoominfo-refresh", owner); }
}

export async function loadTargetLists(): Promise<TargetList[]> {
  const persistence = appPersistence();
  const current = await persistence.loadTargetLists();
  if (current !== null) return targetListSchema.array().parse(current);
  return withWorkspaceLock(async () => {
    const existing = await persistence.loadTargetLists();
    if (existing !== null) return targetListSchema.array().parse(existing);
    const accounts = await loadAccounts();
    const now = new Date().toISOString();
    const list: TargetList = { id: "starter", name: "Starter Accounts", revision: 1, createdAt: now, updatedAt: now,
      memberships: accounts.map((account) => ({ accountId: account.id, accountName: account.name, filename: "Existing workspace", importedAt: now })) };
    await persistence.saveWorkspace(accounts, [list]);
    return [list];
  });
}

export function accountsForList(list: TargetList, accounts: Account[]): Account[] {
  const ids = new Set(list.memberships.map((m) => m.accountId));
  return accounts.filter((account) => ids.has(account.id));
}
export async function visibleAccounts(): Promise<Account[]> {
  const lists = await loadTargetLists();
  const ids = new Set(lists.flatMap((list) => list.memberships.map((m) => m.accountId)));
  return (await loadAccounts()).filter((account) => ids.has(account.id));
}
export function listSummary(list: TargetList, all: Account[]): TargetListSummary {
  const accounts = [...new Map(accountsForList(list, all).map((account) => [account.canonicalCompanyId, account])).values()];
  const { memberships: _memberships, ...summary } = list;
  void _memberships;
  return { ...summary, total: accounts.length,
    verified: accounts.filter((a) => a.signal.source.provenance === "verified" && !a.enrichment?.error).length,
    pending: accounts.filter((a) => a.signal.source.provenance !== "verified" && !a.enrichment?.error).length,
    failed: accounts.filter((a) => Boolean(a.enrichment?.error)).length };
}
export async function listSummaries(): Promise<TargetListSummary[]> {
  const lists = await loadTargetLists();
  const accounts = await loadAccounts();
  return lists.map((list) => listSummary(list, accounts));
}
export async function getTargetList(id: string): Promise<TargetList> {
  const list = (await loadTargetLists()).find((item) => item.id === id);
  if (!list) throw new ListError("Target list not found", 404);
  return list;
}
export function listWorkspace(list: TargetList, all: Account[]) {
  const accounts = accountsForList(list, all);
  return { list, details: listAccountDetails(accounts), metrics: accountMetrics(accounts), summary: listSummary(list, all) };
}

function newAccount(row: ImportRow, now: string): Account {
  const id = randomUUID();
  return accountSchema.parse({ id, canonicalCompanyId: id, name: row.account_name, legalName: row.account_name,
    website: row.website, industry: "Not verified", revenueMillions: null, revenueRange: "Not verified",
    providerIds: row.zoominfo_company_id ? { zoominfoCompanyId: row.zoominfo_company_id } : undefined,
    source: { label: "Imported account identity — unverified", observedAt: now, provenance: "unknown" }, buyers: [],
    signal: { id: `pending-${id}`, accountId: id, type: "No current signal", summary: "Signal research pending", whyNow: "Enrich this account to check for current ZoomInfo evidence.", date: now.slice(0, 10),
      source: { label: "Awaiting ZoomInfo research", observedAt: now, provenance: "unknown" }, relevantIntent: null, activeWithin90Days: null, transformationEvidence: null, mergerOrAcquisition: null, evidence: { intentTopics: [], scoops: [] } } });
}
const importRequestSchema = z.object({ name: targetListSchema.shape.name, filename: z.string().trim().min(1).max(255), rows: z.array(z.unknown()).min(1).max(500), revision: z.number().int().positive().optional() }).strict();
export async function importTargetList(input: unknown, listId?: string): Promise<TargetList> {
  const parsed = importRequestSchema.safeParse(input);
  if (!parsed.success) throw new ListError("Invalid import request: " + parsed.error.issues[0].message);
  await loadTargetLists();
  return withWorkspaceLock(async () => {
    const persistence = appPersistence();
    const lists = targetListSchema.array().parse(await persistence.loadTargetLists());
    const accounts = structuredClone(await loadAccounts());
    const previous = listId ? lists.find((list) => list.id === listId) : undefined;
    if (listId && !previous) throw new ListError("Target list not found", 404);
    if (previous && parsed.data.revision !== previous.revision) throw new ListError("This list changed. Reload it and preview the file again.", 409);
    const { name, filename, rows } = parsed.data;
    if (lists.some((list) => list.id !== listId && list.name.toLowerCase() === name.toLowerCase())) throw new ListError("A list with that name already exists", 409);
    const preview = validateImportRows(rows, accounts);
    if (preview.errors.length) throw new ListError("Fix all row errors before importing", 400, preview.errors);
    const now = new Date().toISOString();
    const memberships = preview.rows.map((row, index) => {
      const existingId = preview.classifications[index].accountId;
      let account = accounts.find((a) => a.id === existingId);
      if (!account) { account = newAccount(row, now); accounts.push(account); }
      if (row.zoominfo_company_id && !account.providerIds?.zoominfoCompanyId) account.providerIds = { ...account.providerIds, zoominfoCompanyId: row.zoominfo_company_id };
      // Do not overwrite existing evidence or provider identity with upload metadata.
      return { accountId: account.id, accountName: row.account_name, vertical: row.vertical, tier: row.tier, relationshipStatus: row.relationship_status, suggestedEntryOffer: row.suggested_entry_offer, filename, importedAt: now };
    });
    const list = targetListSchema.parse({ id: listId || randomUUID(), name, createdAt: previous?.createdAt || now, updatedAt: now, revision: (previous?.revision || 0) + 1, memberships });
    await persistence.saveWorkspace(accounts, previous ? lists.map((item) => item.id === list.id ? list : item) : [...lists, list]);
    return list;
  });
}
export async function changeTargetList(id: string, action: { name: string; revision: number } | { delete: true; revision: number }): Promise<void> {
  await loadTargetLists();
  await withWorkspaceLock(async () => {
    const lists = targetListSchema.array().parse(await appPersistence().loadTargetLists());
    const list = lists.find((item) => item.id === id);
    if (!list) throw new ListError("Target list not found", 404);
    if (list.revision !== action.revision) throw new ListError("This list changed. Reload the page and try again.", 409);
    let next: TargetList[];
    if ("delete" in action) next = lists.filter((item) => item.id !== id);
    else {
      const name = targetListSchema.shape.name.parse(action.name);
      if (lists.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) throw new ListError("A list with that name already exists", 409);
      next = lists.map((item) => item.id === id ? { ...item, name, updatedAt: new Date().toISOString(), revision: item.revision + 1 } : item);
    }
    await appPersistence().saveWorkspace(await loadAccounts(), next);
  });
}
