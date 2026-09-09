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
  buyersFailed?: boolean;
  warnings?: string[];
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

// Provider contact identity and internally verified relationships are separate evidence.
export function mergeBuyers(account: Account, incoming: Buyer[], failed = false): Buyer[] {
  const relationships = account.buyers.filter((buyer) => buyer.relationshipProvenance === "verified");
  // Retain previously observed contacts only on a failed lookup, never demo personas.
  const contacts = failed ? account.buyers.filter((buyer) => buyer.source.provenance === "verified") : incoming;
  // Stable provider IDs keep identity separate from a person's mutable name or list rank.
  const ids = new Set(contacts.map((buyer) => buyer.id));
  return [...contacts.map((buyer) => {
    const relationship = relationships.find((item) => item.id === buyer.id);
    return relationship ? { ...buyer, warmth: relationship.warmth, relationshipSource: relationship.relationshipSource, relationshipProvenance: relationship.relationshipProvenance, suggestedPath: relationship.suggestedPath } : buyer;
  }), ...relationships.filter((buyer) => !ids.has(buyer.id))];
}

function applyProfile(account: Account, update: ZoomInfoAccountUpdate): Partial<Account> {
  const profile = update.profile;
  if (!profile) return {};
  const { firmographics, legalName, revenueRange } = profile;
  const revenueMillions = firmographics.revenueMillions ?? null;
  return {
    legalName: legalName || account.legalName,
    industry: firmographics.industry || account.industry,
    // A missing provider revenue remains unknown; do not silently reuse demo revenue.
    revenueMillions,
    revenueRange: revenueMillions === null ? "Not verified" : revenueRange || "Not verified",
    firmographics,
    source: { label: "ZoomInfo company profile", url: account.website, observedAt: firmographics.source.observedAt, provenance: "verified" as const },
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
      buyers: mergeBuyers(account, update.buyers, update.buyersFailed),
      enrichment: { lastAttemptedAt: new Date().toISOString(), lastSuccessfulAt: update.signal.source.observedAt, warnings: update.warnings || [] },
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
