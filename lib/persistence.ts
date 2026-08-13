import { Redis } from "@upstash/redis";
import type { OAuthDiscoveryState, StoredOAuthTokens } from "@modelcontextprotocol/client";
import type { Account } from "@/lib/schemas";
import type { ZoomInfoAccountUpdate } from "@/lib/session-store";

export type PendingOAuth = {
  state: string;
  createdAt: string;
  codeVerifier?: string;
  authorizationUrl?: string;
  discoveryState?: OAuthDiscoveryState;
};

export type ZoomInfoMeta = {
  requiredToolsReady: boolean;
  discoveredTools: string[];
  authorizationPendingUntil?: string;
  error?: string;
  lastSuccessfulRefreshAt?: string;
  cacheExpiresAt?: string;
};

export type StoredCompanyCache = {
  update: ZoomInfoAccountUpdate;
  expiresAt: number;
  key: string;
};

export interface AppPersistence {
  readonly kind: "memory" | "redis";
  loadAccounts(): Promise<Account[] | null>;
  saveAccounts(accounts: Account[]): Promise<void>;
  createPendingOAuth(record: PendingOAuth, ttlSeconds: number): Promise<void>;
  updatePendingOAuth(state: string, patch: Partial<PendingOAuth>, ttlSeconds: number): Promise<void>;
  getPendingOAuth(state: string): Promise<PendingOAuth | null>;
  consumePendingOAuth(state: string): Promise<PendingOAuth | null>;
  getTokenBlob(): Promise<string | null>;
  saveTokenBlob(blob: string): Promise<void>;
  deleteTokenBlob(): Promise<void>;
  getZoomInfoMeta(): Promise<ZoomInfoMeta>;
  updateZoomInfoMeta(patch: Partial<ZoomInfoMeta>): Promise<void>;
  getCompanyCache(canonicalCompanyId: string): Promise<StoredCompanyCache | null>;
  saveCompanyCache(canonicalCompanyId: string, entry: StoredCompanyCache, ttlSeconds: number): Promise<void>;
  clearCompanyCache(canonicalCompanyIds: string[]): Promise<void>;
  acquireLock(name: string, owner: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(name: string, owner: string): Promise<void>;
  getLoginFailures(clientKey: string): Promise<number>;
  recordLoginFailure(clientKey: string, ttlSeconds: number): Promise<number>;
  clearLoginFailures(clientKey: string): Promise<void>;
}

const DEFAULT_META: ZoomInfoMeta = { requiredToolsReady: false, discoveredTools: [] };

type MemoryState = {
  accounts: Account[] | null;
  pending: Map<string, { value: PendingOAuth; expiresAt: number }>;
  tokenBlob: string | null;
  meta: ZoomInfoMeta;
  cache: Map<string, { value: StoredCompanyCache; expiresAt: number }>;
  locks: Map<string, { owner: string; expiresAt: number }>;
  failures: Map<string, { count: number; expiresAt: number }>;
};

declare global {
  var __signalOutreachPersistence: MemoryState | undefined;
}

function memoryState(): MemoryState {
  if (!globalThis.__signalOutreachPersistence) {
    globalThis.__signalOutreachPersistence = {
      accounts: null,
      pending: new Map(),
      tokenBlob: null,
      meta: { ...DEFAULT_META },
      cache: new Map(),
      locks: new Map(),
      failures: new Map(),
    };
  }
  return globalThis.__signalOutreachPersistence;
}

class MemoryPersistence implements AppPersistence {
  readonly kind = "memory" as const;

  async loadAccounts() { return memoryState().accounts ? structuredClone(memoryState().accounts) : null; }
  async saveAccounts(accounts: Account[]) { memoryState().accounts = structuredClone(accounts); }
  async createPendingOAuth(record: PendingOAuth, ttlSeconds: number) { memoryState().pending.set(record.state, { value: structuredClone(record), expiresAt: Date.now() + ttlSeconds * 1000 }); }
  async updatePendingOAuth(state: string, patch: Partial<PendingOAuth>, ttlSeconds: number) {
    const current = await this.getPendingOAuth(state);
    if (!current) throw new Error("ZoomInfo OAuth request expired; reconnect ZoomInfo");
    memoryState().pending.set(state, { value: { ...current, ...patch, state }, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  async getPendingOAuth(state: string) {
    const entry = memoryState().pending.get(state);
    if (!entry || entry.expiresAt <= Date.now()) { memoryState().pending.delete(state); return null; }
    return structuredClone(entry.value);
  }
  async consumePendingOAuth(state: string) { const value = await this.getPendingOAuth(state); memoryState().pending.delete(state); return value; }
  async getTokenBlob() { return memoryState().tokenBlob; }
  async saveTokenBlob(blob: string) { memoryState().tokenBlob = blob; }
  async deleteTokenBlob() { memoryState().tokenBlob = null; }
  async getZoomInfoMeta() { return structuredClone(memoryState().meta); }
  async updateZoomInfoMeta(patch: Partial<ZoomInfoMeta>) { memoryState().meta = { ...memoryState().meta, ...patch }; }
  async getCompanyCache(id: string) {
    const entry = memoryState().cache.get(id);
    if (!entry || entry.expiresAt <= Date.now()) { memoryState().cache.delete(id); return null; }
    return structuredClone(entry.value);
  }
  async saveCompanyCache(id: string, entry: StoredCompanyCache, ttlSeconds: number) { memoryState().cache.set(id, { value: structuredClone(entry), expiresAt: Date.now() + ttlSeconds * 1000 }); }
  async clearCompanyCache(ids: string[]) { ids.forEach((id) => memoryState().cache.delete(id)); }
  async acquireLock(name: string, owner: string, ttlSeconds: number) {
    const current = memoryState().locks.get(name);
    if (current && current.expiresAt > Date.now()) return false;
    memoryState().locks.set(name, { owner, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }
  async releaseLock(name: string, owner: string) { if (memoryState().locks.get(name)?.owner === owner) memoryState().locks.delete(name); }
  async getLoginFailures(key: string) {
    const entry = memoryState().failures.get(key);
    if (!entry || entry.expiresAt <= Date.now()) { memoryState().failures.delete(key); return 0; }
    return entry.count;
  }
  async recordLoginFailure(key: string, ttlSeconds: number) {
    const count = await this.getLoginFailures(key) + 1;
    memoryState().failures.set(key, { count, expiresAt: Date.now() + ttlSeconds * 1000 });
    return count;
  }
  async clearLoginFailures(key: string) { memoryState().failures.delete(key); }
}

class RedisPersistence implements AppPersistence {
  readonly kind = "redis" as const;
  constructor(private readonly redis: Redis, private readonly prefix: string) {}
  private key(suffix: string) { return `${this.prefix}:${suffix}`; }
  private pendingKey(state: string) { return this.key(`oauth:pending:${state}`); }
  private cacheKey(id: string) { return this.key(`zoominfo:cache:${id}`); }
  private failureKey(id: string) { return this.key(`admin:failures:${id}`); }

  async loadAccounts() { return this.redis.get<Account[]>(this.key("accounts")); }
  async saveAccounts(accounts: Account[]) { await this.redis.set(this.key("accounts"), accounts); }
  async createPendingOAuth(record: PendingOAuth, ttlSeconds: number) { await this.redis.set(this.pendingKey(record.state), record, { ex: ttlSeconds }); }
  async updatePendingOAuth(state: string, patch: Partial<PendingOAuth>, ttlSeconds: number) {
    const current = await this.getPendingOAuth(state);
    if (!current) throw new Error("ZoomInfo OAuth request expired; reconnect ZoomInfo");
    await this.redis.set(this.pendingKey(state), { ...current, ...patch, state }, { ex: ttlSeconds });
  }
  async getPendingOAuth(state: string) { return this.redis.get<PendingOAuth>(this.pendingKey(state)); }
  async consumePendingOAuth(state: string) { return this.redis.getdel<PendingOAuth>(this.pendingKey(state)); }
  async getTokenBlob() { return this.redis.get<string>(this.key("zoominfo:tokens")); }
  async saveTokenBlob(blob: string) { await this.redis.set(this.key("zoominfo:tokens"), blob); }
  async deleteTokenBlob() { await this.redis.del(this.key("zoominfo:tokens")); }
  async getZoomInfoMeta() { return (await this.redis.get<ZoomInfoMeta>(this.key("zoominfo:meta"))) ?? { ...DEFAULT_META }; }
  async updateZoomInfoMeta(patch: Partial<ZoomInfoMeta>) { const current = await this.getZoomInfoMeta(); await this.redis.set(this.key("zoominfo:meta"), { ...current, ...patch }); }
  async getCompanyCache(id: string) { return this.redis.get<StoredCompanyCache>(this.cacheKey(id)); }
  async saveCompanyCache(id: string, entry: StoredCompanyCache, ttlSeconds: number) { await this.redis.set(this.cacheKey(id), entry, { ex: ttlSeconds }); }
  async clearCompanyCache(ids: string[]) { if (ids.length) await this.redis.del(...ids.map((id) => this.cacheKey(id))); }
  async acquireLock(name: string, owner: string, ttlSeconds: number) { return (await this.redis.set(this.key(`lock:${name}`), owner, { nx: true, ex: ttlSeconds })) === "OK"; }
  async releaseLock(name: string, owner: string) {
    await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [this.key(`lock:${name}`)], [owner]);
  }
  async getLoginFailures(id: string) { return Number(await this.redis.get<number>(this.failureKey(id)) ?? 0); }
  async recordLoginFailure(id: string, ttlSeconds: number) {
    const key = this.failureKey(id);
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ttlSeconds);
    return count;
  }
  async clearLoginFailures(id: string) { await this.redis.del(this.failureKey(id)); }
}

function redisEnvironment(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

let selectedPersistence: AppPersistence | undefined;

export function appPersistence(): AppPersistence {
  if (selectedPersistence) return selectedPersistence;
  const config = redisEnvironment();
  selectedPersistence = config
    ? new RedisPersistence(new Redis({ url: config.url, token: config.token }), process.env.SIGNAL_OUTREACH_REDIS_PREFIX || "signal-outreach:v1")
    : new MemoryPersistence();
  return selectedPersistence;
}

export function redisConfigured(): boolean { return Boolean(redisEnvironment()); }

export function resetPersistenceForTests(): void {
  selectedPersistence = undefined;
  globalThis.__signalOutreachPersistence = undefined;
}

export function resetPersistenceClientForTests(): void {
  selectedPersistence = undefined;
}

export type { StoredOAuthTokens };
