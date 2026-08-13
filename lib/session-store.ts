import { accounts as seededAccounts } from "@/lib/data";
import { appPersistence } from "@/lib/persistence";
import { accountSchema, type Account, type Buyer, type Firmographics, type Signal } from "@/lib/schemas";

export type ZoomInfoCompanyProfile = {
  firmographics: Firmographics;
  legalName?: string;
  revenueRange?: string;
};

export type ZoomInfoAccountUpdate = {
  canonicalCompanyId: string;
  zoominfoCompanyId: string;
  signal: Signal;
  buyers: Buyer[];
  profile?: ZoomInfoCompanyProfile;
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

// ZoomInfo can name real contacts but knows nothing about Aberdeen's own relationships, so
// a refresh that simply replaced the buyer list erased every warm path and silently cost the
// account its relationship score. Aberdeen relationship rows are kept alongside the live
// contacts; no warmth is transferred onto a ZoomInfo-named person, which would be a guess.
function mergeBuyers(account: Account, incoming: Buyer[]): Buyer[] {
  if (!incoming.length) return account.buyers;
  const live = incoming.map((buyer, index) => ({ ...buyer, id: `${account.id}-zoominfo-buyer-${index + 1}` }));
  const liveNames = new Set(live.map((buyer) => buyer.name.toLowerCase()));
  const relationships = account.buyers.filter((buyer) => buyer.warmth !== "Unknown" && !liveNames.has(buyer.name.toLowerCase()));
  return [...live, ...relationships];
}

function applyProfile(account: Account, update: ZoomInfoAccountUpdate): Partial<Account> {
  const profile = update.profile;
  if (!profile) return {};
  const { firmographics, legalName, revenueRange } = profile;
  const revenueMillions = firmographics.revenueMillions ?? null;
  return {
    legalName: legalName || account.legalName,
    industry: firmographics.industry || account.industry,
    // A ZoomInfo revenue figure is verified where the seeded one was demo research, so it
    // replaces the seed. When ZoomInfo has no figure the seeded value is left untouched.
    revenueMillions: revenueMillions === null ? account.revenueMillions : revenueMillions,
    revenueRange: revenueMillions === null ? account.revenueRange : revenueRange || account.revenueRange,
    firmographics,
    source: revenueMillions === null ? account.source : { label: "ZoomInfo company profile", url: account.website, observedAt: firmographics.source.observedAt, provenance: "verified" as const },
  };
}

export function applyZoomInfoUpdatesToAccounts(accounts: Account[], updates: ZoomInfoAccountUpdate[]): Account[] {
  const byCanonicalId = new Map(updates.map((update) => [update.canonicalCompanyId, update]));
  return accounts.map((account) => {
    const update = byCanonicalId.get(account.canonicalCompanyId);
    if (!update) return account;
    return accountSchema.parse({
      ...account,
      ...applyProfile(account, update),
      providerIds: { ...account.providerIds, zoominfoCompanyId: update.zoominfoCompanyId },
      signal: { ...update.signal, accountId: account.id },
      buyers: mergeBuyers(account, update.buyers),
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
