import { accounts as seededAccounts } from "@/lib/data";
import { appPersistence } from "@/lib/persistence";
import { accountSchema, type Account, type Buyer, type Signal } from "@/lib/schemas";

export type ZoomInfoAccountUpdate = {
  canonicalCompanyId: string;
  zoominfoCompanyId: string;
  signal: Signal;
  buyers: Buyer[];
};

type SessionStore = {
  accounts: Account[];
};

declare global {
  var __signalOutreachSessionStore: SessionStore | undefined;
}

function createStore(): SessionStore {
  return { accounts: seededAccounts.map((account) => accountSchema.parse(structuredClone(account))) };
}

function store(): SessionStore {
  if (!globalThis.__signalOutreachSessionStore) globalThis.__signalOutreachSessionStore = createStore();
  return globalThis.__signalOutreachSessionStore;
}

export function getSessionAccounts(): Account[] {
  return store().accounts;
}

export async function loadAccounts(): Promise<Account[]> {
  const persisted = await appPersistence().loadAccounts();
  if (!persisted) return getSessionAccounts();
  const parsed = accountSchema.array().safeParse(persisted);
  if (!parsed.success) throw new Error("Stored account snapshot is invalid");
  store().accounts = parsed.data;
  return store().accounts;
}

export function applyZoomInfoUpdatesToAccounts(accounts: Account[], updates: ZoomInfoAccountUpdate[]): Account[] {
  const byCanonicalId = new Map(updates.map((update) => [update.canonicalCompanyId, update]));
  return accounts.map((account) => {
    const update = byCanonicalId.get(account.canonicalCompanyId);
    if (!update) return account;
    return accountSchema.parse({
      ...account,
      providerIds: { ...account.providerIds, zoominfoCompanyId: update.zoominfoCompanyId },
      signal: { ...update.signal, accountId: account.id },
      buyers: update.buyers.map((buyer, index) => ({ ...buyer, id: `${account.id}-zoominfo-buyer-${index + 1}` })),
    });
  });
}

export function applyZoomInfoUpdates(updates: ZoomInfoAccountUpdate[]): Account[] {
  store().accounts = applyZoomInfoUpdatesToAccounts(store().accounts, updates);
  return store().accounts;
}

export async function applyAndPersistZoomInfoUpdates(updates: ZoomInfoAccountUpdate[], accounts?: Account[]): Promise<Account[]> {
  const current = accounts ?? await loadAccounts();
  const next = applyZoomInfoUpdatesToAccounts(current, updates);
  store().accounts = next;
  await appPersistence().saveAccounts(next);
  return next;
}

export function resetSessionAccountsForTests(): void {
  globalThis.__signalOutreachSessionStore = createStore();
}
