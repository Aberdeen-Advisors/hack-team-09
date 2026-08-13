import { randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { accountSchema, buyerSchema, firmographicsSchema, signalSchema, type Account, type Buyer, type Firmographics, type Signal } from "@/lib/schemas";
import { appPersistence, redisConfigured, resetPersistenceForTests, type AppPersistence, type PendingOAuth } from "@/lib/persistence";
import { scoreAccount } from "@/lib/scoring";
import { applyAndPersistZoomInfoUpdates, loadAccounts, type ZoomInfoAccountUpdate, type ZoomInfoCompanyProfile } from "@/lib/session-store";
import { decryptOAuthTokens, encryptOAuthTokens, tokenEncryptionConfigured } from "@/lib/token-crypto";

const REQUIRED_TOOLS = ["lookup", "search_companies", "enrich_intent", "enrich_scoops", "get_recommended_contacts", "search_contacts"] as const;
const DEFAULT_TOPIC_QUERIES = ["artificial intelligence", "generative AI", "digital transformation", "cloud migration", "data analytics"];
const RELEVANT_SCOOP_TYPES = ["Funding", "Mergers & Acquisitions (M&A)", "New Hire", "Promotion", "Management Move", "Executive Move", "Project", "Pain Point", "Partnership", "Product Launch", "Facilities Relocation / Expansion"];

type UnknownRecord = Record<string, unknown>;
const OAUTH_PENDING_TTL_SECONDS = 600;
const REFRESH_LOCK_TTL_SECONDS = 180;

export function zoomInfoMode(): "mock" | "mcp" {
  return process.env.ZOOMINFO_PROVIDER?.toLowerCase() === "mcp" ? "mcp" : "mock";
}

function mcpUrl(): URL {
  return new URL(process.env.ZOOMINFO_MCP_URL || "https://mcp.zoominfo.com/mcp");
}

function redirectUri(): string {
  return process.env.ZOOMINFO_MCP_REDIRECT_URI || "http://localhost:3000/api/integrations/zoominfo/callback";
}

// ZoomInfo registers MCP apps in Okta, which rejects the whole token request with
// "The client secret supplied for a confidential client is invalid" whenever the
// presented client-authentication style does not match the registration. Okta accepts
// all three, so the working style is a property of the registration, not of this code.
// "none" is a public PKCE client that sends no secret at all.
type ClientAuthMethod = "client_secret_post" | "client_secret_basic" | "none";

function clientAuthMethod(): ClientAuthMethod {
  const configured = process.env.ZOOMINFO_MCP_AUTH_METHOD?.trim().toLowerCase();
  if (configured === "basic" || configured === "client_secret_basic") return "client_secret_basic";
  if (configured === "none" || configured === "public") return "none";
  return "client_secret_post";
}

// Values pasted into a Vercel environment variable routinely carry a trailing newline
// or space, which Okta reports as an invalid secret rather than a malformed request.
function clientCredentials(): { clientId: string; clientSecret?: string } {
  const clientId = process.env.ZOOMINFO_MCP_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOMINFO_MCP_CLIENT_SECRET?.trim();
  if (!clientId) throw new Error("ZOOMINFO_MCP_CLIENT_ID is not configured");
  if (!clientSecret && clientAuthMethod() !== "none") throw new Error("ZOOMINFO_MCP_CLIENT_SECRET is not configured");
  return { clientId, clientSecret: clientSecret || undefined };
}

function configurationError(): string | undefined {
  if (zoomInfoMode() !== "mcp") return undefined;
  if (!process.env.ZOOMINFO_MCP_CLIENT_ID?.trim()) return "ZOOMINFO_MCP_CLIENT_ID is not configured.";
  if (!process.env.ZOOMINFO_MCP_CLIENT_SECRET?.trim() && clientAuthMethod() !== "none") return "ZOOMINFO_MCP_CLIENT_SECRET is not configured.";
  if (!tokenEncryptionConfigured()) return "ZOOMINFO_TOKEN_ENCRYPTION_KEY is missing or invalid.";
  if (process.env.NODE_ENV === "production" && !redisConfigured()) return "Upstash Redis is required for ZoomInfo MCP in production.";
  return undefined;
}

// Reports how the credentials were shaped without ever revealing them, so an
// invalid-client failure can be diagnosed from the integration drawer instead of guessing.
export function credentialDiagnostics(): string {
  const rawId = process.env.ZOOMINFO_MCP_CLIENT_ID || "";
  const rawSecret = process.env.ZOOMINFO_MCP_CLIENT_SECRET || "";
  const padded = [rawId !== rawId.trim() ? "client ID" : undefined, rawSecret !== rawSecret.trim() ? "client secret" : undefined].filter(Boolean);
  return [
    `auth method ${clientAuthMethod()}`,
    `client ID ${rawId.trim().length} chars starting "${rawId.trim().slice(0, 4)}"`,
    rawSecret.trim() ? `client secret ${rawSecret.trim().length} chars` : "no client secret set",
    padded.length ? `trimmed surrounding whitespace from ${padded.join(" and ")}` : undefined,
  ].filter(Boolean).join("; ");
}

export function zoomInfoOAuthEnabled(): boolean {
  return zoomInfoMode() === "mcp" && !configurationError();
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]").slice(0, 400);
}

function isCredentialRejection(error: unknown): boolean {
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code.toLowerCase() : "";
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return code === "invalid_client" || code === "unauthorized_client" || message.includes("invalid_client") || message.includes("client secret");
}

// The authorization server reports every credential problem with the same opaque text,
// so attach how the credentials were shaped to distinguish a wrong secret from a
// registration that expects a different client-authentication style.
function authorizationError(error: unknown): string {
  const message = friendlyError(error);
  return isCredentialRejection(error) ? `${message} [${credentialDiagnostics()}]` : message;
}

export class DurableZoomInfoOAuthProvider implements OAuthClientProvider {
  private flowState?: string;

  constructor(private readonly persistence: AppPersistence, private readonly consumedPending?: PendingOAuth) {
    this.flowState = consumedPending?.state;
  }

  get currentState(): string | undefined { return this.flowState; }
  get redirectUrl(): string { return redirectUri(); }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Aberdeen Signal-to-Outreach",
      redirect_uris: [redirectUri()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: clientAuthMethod(),
    };
  }

  // The SDK only honours our token_endpoint_auth_method when the authorization server
  // advertises it, and silently downgrades to client_secret_basic otherwise. This hook
  // takes precedence over that selection entirely, so the configured method is what is
  // actually sent. Declared as a bound property because the SDK reads it off the provider
  // and calls it detached from `this`.
  addClientAuthentication = async (headers: Headers, params: URLSearchParams): Promise<void> => {
    const { clientId, clientSecret } = clientCredentials();
    params.set("client_id", clientId);
    if (clientAuthMethod() === "none" || !clientSecret) return;
    if (clientAuthMethod() === "client_secret_basic") {
      params.delete("client_secret");
      headers.set("Authorization", `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`);
      return;
    }
    params.set("client_secret", clientSecret);
  };

  async state(): Promise<string> {
    if (this.flowState) return this.flowState;
    this.flowState = randomUUID();
    await this.persistence.createPendingOAuth({ state: this.flowState, createdAt: new Date().toISOString() }, OAUTH_PENDING_TTL_SECONDS);
    return this.flowState;
  }

  clientInformation(): StoredOAuthClientInformation {
    const { clientId, clientSecret } = clientCredentials();
    return { client_id: clientId, client_secret: clientSecret, token_endpoint_auth_method: clientAuthMethod() };
  }

  async tokens(): Promise<StoredOAuthTokens | undefined> {
    const blob = await this.persistence.getTokenBlob();
    return blob ? decryptOAuthTokens(blob) : undefined;
  }
  async saveTokens(tokens: StoredOAuthTokens): Promise<void> { await this.persistence.saveTokenBlob(encryptOAuthTokens(tokens)); }
  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.flowState) throw new Error("ZoomInfo OAuth state was not initialized");
    await this.persistence.updatePendingOAuth(this.flowState, { authorizationUrl: url.toString() }, OAUTH_PENDING_TTL_SECONDS);
  }
  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    if (!this.flowState) throw new Error("ZoomInfo OAuth state was not initialized");
    await this.persistence.updatePendingOAuth(this.flowState, { codeVerifier }, OAUTH_PENDING_TTL_SECONDS);
  }
  async codeVerifier(): Promise<string> {
    const pending = this.consumedPending ?? (this.flowState ? await this.persistence.getPendingOAuth(this.flowState) : null);
    const codeVerifier = pending?.codeVerifier;
    if (!codeVerifier) throw new Error("ZoomInfo OAuth code verifier is missing; reconnect ZoomInfo");
    return codeVerifier;
  }
  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    // The SDK calls this before it ever calls state() (right after discovery,
    // well before the authorization URL is built), so flowState may not exist yet.
    const state = await this.state();
    await this.persistence.updatePendingOAuth(state, { discoveryState }, OAUTH_PENDING_TTL_SECONDS);
  }
  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const pending = this.consumedPending ?? (this.flowState ? await this.persistence.getPendingOAuth(this.flowState) : null);
    return pending?.discoveryState;
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all" || scope === "tokens") await this.persistence.deleteTokenBlob();
  }
}

function newTransport(provider = new DurableZoomInfoOAuthProvider(appPersistence())): StreamableHTTPClientTransport {
  // ZoomInfo's oauth-authorization-server metadata echoes Okta's issuer
  // (https://okta-login.zoominfo.com/oauth2/default) instead of their own MCP
  // domain, which fails the RFC 8414 §3.3 issuer check. Known ZoomInfo-side
  // misconfiguration; skip the check until they fix it.
  return new StreamableHTTPClientTransport(mcpUrl(), { authProvider: provider, onInsufficientScope: "throw", skipIssuerMetadataValidation: true });
}

function newClient(): Client {
  return new Client({ name: "signal-to-outreach", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
}

async function connectClient(provider?: DurableZoomInfoOAuthProvider): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = newClient();
  const transport = newTransport(provider);
  try {
    await client.connect(transport);
    return { client, transport };
  } catch (error) {
    try { await client.close(); } catch { /* connection was not established */ }
    throw error;
  }
}

async function closeClient(client: Client, transport: StreamableHTTPClientTransport): Promise<void> {
  try { await transport.terminateSession(); } catch { /* stateless server */ }
  try { await client.close(); } catch { /* already closed */ }
}

// ZoomInfo does not publish argument shapes for its MCP tools, so the server's own
// declared schema is the only authoritative description of what `lookup` accepts.
let lookupSchemaSummary: string | undefined;

function summarizeToolSchema(tool: { inputSchema?: unknown }): string | undefined {
  const schema = asRecord(tool.inputSchema);
  const properties = asRecord(schema?.properties);
  if (!properties) return undefined;
  const required = Array.isArray(schema?.required) ? schema.required.filter((name): name is string => typeof name === "string") : [];
  return Object.entries(properties)
    .map(([name, value]) => `${name}${required.includes(name) ? "*" : ""}: ${stringValue(asRecord(value) ?? {}, ["type"]) || "unknown"}`)
    .join(", ");
}

// ZoomInfo deprecates tools in place: the old name keeps returning data with a warning
// appended. Record the successor's declared parameters so a migration can be made from
// the server's own contract rather than guessing at the newer argument names.
let supersededToolSummary: string | undefined;

async function discoverRequiredTools(client: Client): Promise<void> {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  const missing = REQUIRED_TOOLS.filter((name) => !names.includes(name));
  lookupSchemaSummary = summarizeToolSchema(listed.tools.find((tool) => tool.name === "lookup") ?? {});
  const successors = listed.tools.filter((tool) => REQUIRED_TOOLS.some((required) => tool.name.startsWith(`${required}_v`)));
  supersededToolSummary = successors.length
    ? successors.map((tool) => `${tool.name}(${summarizeToolSchema(tool) || "no declared properties"})`).join("; ")
    : undefined;
  await appPersistence().updateZoomInfoMeta({ discoveredTools: names, requiredToolsReady: missing.length === 0 });
  if (missing.length) throw new Error(`ZoomInfo account is missing required MCP tools: ${missing.join(", ")}`);
}

export async function beginZoomInfoAuthorization(): Promise<string> {
  if (zoomInfoMode() !== "mcp") throw new Error("Set ZOOMINFO_PROVIDER=mcp before connecting ZoomInfo");
  const configError = configurationError();
  if (configError) throw new Error(configError);
  clientCredentials();
  const persistence = appPersistence();
  const provider = new DurableZoomInfoOAuthProvider(persistence);
  await persistence.updateZoomInfoMeta({ error: undefined, authorizationPendingUntil: new Date(Date.now() + OAUTH_PENDING_TTL_SECONDS * 1000).toISOString() });
  let connection: { client: Client; transport: StreamableHTTPClientTransport } | undefined;
  try {
    connection = await connectClient(provider);
    await discoverRequiredTools(connection.client);
    return "/?zoominfo=connected";
  } catch (error) {
    const state = provider.currentState;
    const pending = state ? await persistence.getPendingOAuth(state) : null;
    if (error instanceof UnauthorizedError && pending?.authorizationUrl) return pending.authorizationUrl;
    await persistence.updateZoomInfoMeta({ error: authorizationError(error), authorizationPendingUntil: undefined });
    throw error;
  } finally {
    if (connection) await closeClient(connection.client, connection.transport);
  }
}

export async function completeZoomInfoAuthorization(params: URLSearchParams): Promise<void> {
  const configError = configurationError();
  if (configError) throw new Error(configError);
  const returnedState = params.get("state");
  if (!returnedState) throw new Error("ZoomInfo OAuth state was missing; reconnect ZoomInfo");
  const persistence = appPersistence();
  const pending = await persistence.consumePendingOAuth(returnedState);
  if (!pending) throw new Error("ZoomInfo OAuth state expired or was already used; reconnect ZoomInfo");
  if (params.get("error")) {
    const message = `ZoomInfo authorization failed: ${params.get("error_description") || params.get("error")}`;
    await persistence.updateZoomInfoMeta({ error: message, authorizationPendingUntil: undefined });
    throw new Error(message);
  }
  const provider = new DurableZoomInfoOAuthProvider(persistence, pending);
  const transport = newTransport(provider);
  // Rethrow with the diagnostics attached so the callback redirect surfaces them in the
  // toast, not just in the admin-only drawer.
  try { await transport.finishAuth(params); }
  catch (error) {
    const message = authorizationError(error);
    await persistence.updateZoomInfoMeta({ error: message, authorizationPendingUntil: undefined });
    throw new Error(message);
  }
  finally { try { await transport.close(); } catch { /* transport was not connected */ } }
  let connection: { client: Client; transport: StreamableHTTPClientTransport } | undefined;
  try {
    connection = await connectClient(provider);
    await discoverRequiredTools(connection.client);
    await persistence.updateZoomInfoMeta({ error: undefined, authorizationPendingUntil: undefined });
  } catch (error) {
    await persistence.updateZoomInfoMeta({ error: friendlyError(error), authorizationPendingUntil: undefined });
    throw error;
  } finally {
    if (connection) await closeClient(connection.client, connection.transport);
  }
}

export async function disconnectZoomInfo(): Promise<void> {
  const persistence = appPersistence();
  const accounts = await loadAccounts();
  await Promise.all([
    persistence.deleteTokenBlob(),
    persistence.clearCompanyCache([...new Set(accounts.map((account) => account.canonicalCompanyId))]),
    persistence.updateZoomInfoMeta({ requiredToolsReady: false, discoveredTools: [], authorizationPendingUntil: undefined, error: undefined, cacheExpiresAt: undefined }),
  ]);
}

export async function zoomInfoIntegrationSnapshot(admin = false) {
  const persistence = appPersistence();
  const [accounts, meta, tokenBlob] = await Promise.all([loadAccounts(), persistence.getZoomInfoMeta(), persistence.getTokenBlob()]);
  const totalCanonicalAccounts = new Set(accounts.map((account) => account.canonicalCompanyId)).size;
  const liveAccounts = new Set(accounts.filter((account) => account.signal.source.label === "ZoomInfo licensed signal").map((account) => account.canonicalCompanyId)).size;
  const configError = configurationError();
  const configured = zoomInfoMode() === "mock" || !configError;
  const authorizing = meta.authorizationPendingUntil && Date.parse(meta.authorizationPendingUntil) > Date.now();
  const connectionState = zoomInfoMode() === "mock" ? "mock" : configError ? "disabled" : meta.error ? "error" : tokenBlob && meta.requiredToolsReady ? "ready" : authorizing ? "authorizing" : "disconnected";
  return {
    state: connectionState as "disabled" | "mock" | "disconnected" | "authorizing" | "ready" | "error",
    configured,
    requiredToolsReady: admin ? meta.requiredToolsReady : false,
    liveAccounts,
    totalCanonicalAccounts,
    lastSuccessfulRefreshAt: meta.lastSuccessfulRefreshAt,
    cacheExpiresAt: meta.cacheExpiresAt,
    error: admin ? meta.error || configError : undefined,
    note: admin ? meta.lastRefreshNote : undefined,
    // Which build produced this report. Several rounds of debugging were spent unsure
    // whether a fix was actually deployed.
    build: admin ? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) : undefined,
  };
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function flattenRecord(value: unknown): UnknownRecord | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const attributes = asRecord(record.attributes);
  return attributes ? { ...attributes, id: record.id ?? attributes.id } : record;
}

function findRecords(value: unknown, preferredKeys: string[]): UnknownRecord[] {
  if (Array.isArray(value)) return value.map(flattenRecord).filter((item): item is UnknownRecord => Boolean(item));
  const record = asRecord(value);
  if (!record) return [];
  for (const key of preferredKeys) {
    if (record[key] !== undefined) {
      const found = findRecords(record[key], preferredKeys);
      if (found.length) return found;
    }
  }
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      const found = findRecords(nested, preferredKeys);
      if (found.length) return found;
    }
    if (nested && typeof nested === "object") {
      const found = findRecords(nested, preferredKeys);
      if (found.length && found[0] !== nested) return found;
    }
  }
  return [flattenRecord(record)!];
}

function resultText(result: UnknownRecord): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.map((item) => asRecord(item)?.text).filter((value): value is string => typeof value === "string").join("\n");
}

// resultText joins multiple content blocks with newlines, and a run of JSON values is
// not itself valid JSON, so recover whichever lines do parse.
function decodeConcatenatedJson(value: string): unknown {
  const decoded = value.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line) as unknown]; } catch { return []; }
  });
  if (!decoded.length) return value;
  if (decoded.length === 1) return decoded[0];
  // Each block is its own envelope, so combine their record arrays rather than returning
  // a list of envelopes that would flatten into wrappers instead of companies.
  const envelopes = decoded.filter((item): item is UnknownRecord => asRecord(item) !== undefined);
  if (envelopes.length !== decoded.length) return decoded;
  const merged: UnknownRecord = {};
  for (const envelope of envelopes) {
    for (const [key, value] of Object.entries(envelope)) {
      const existing = merged[key];
      if (Array.isArray(existing) && Array.isArray(value)) merged[key] = [...existing, ...value];
      else if (existing === undefined) merged[key] = value;
    }
  }
  return merged;
}

// ZoomInfo returns structuredContent as a JSON string, and that string is itself a
// JSON-encoded string, so a single parse yields more text instead of records. Keep
// unwrapping until something structured appears.
function decodeJson(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "string" || !current.trim()) return current;
    let parsed: unknown;
    try { parsed = JSON.parse(current); } catch { return decodeConcatenatedJson(current); }
    if (parsed === current) return current;
    current = parsed;
  }
  return current;
}

function isUsablePayload(value: unknown): boolean {
  return Array.isArray(value) || asRecord(value) !== undefined;
}

function extractToolPayload(result: unknown): unknown {
  const record = asRecord(result);
  if (!record) return decodeJson(result);
  if (record.isError) throw new Error(resultText(record) || "ZoomInfo MCP tool returned an error");
  // structuredContent can arrive truncated while the complete JSON sits in the text
  // content, so take whichever source actually yields records rather than trusting one.
  const text = resultText(record);
  for (const candidate of [record.structuredContent, text]) {
    if (candidate === undefined || candidate === "") continue;
    const decoded = decodeJson(candidate);
    if (isUsablePayload(decoded)) return decoded;
  }
  // Nothing decoded. Return a source verbatim so the diagnostics can describe it.
  if (record.structuredContent !== undefined) return record.structuredContent;
  return text || record;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ZI0004|rate limit|too many requests|\b429\b/i.test(message);
}

// Refreshing an account fans out to a company search, two enrichments, and up to four
// contact calls, and accounts ran two at a time, so ZoomInfo's per-second quota was
// exceeded before any result came back. Every tool call is funnelled through one spaced
// queue, and a rate-limited call backs off rather than failing the account outright.
let toolQueue: Promise<unknown> = Promise.resolve();

async function callTool(client: Client, name: string, args: UnknownRecord): Promise<unknown> {
  const spacing = Math.max(0, Number(process.env.ZOOMINFO_MCP_REQUEST_SPACING_MS || 250));
  const maxAttempts = Math.max(1, Number(process.env.ZOOMINFO_MCP_MAX_ATTEMPTS || 5));
  const run = toolQueue.then(async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        // Started after the queue slot is granted so waiting does not consume the budget.
        const timeout = Number(process.env.ZOOMINFO_MCP_TIMEOUT_MS || 30000);
        const result = await client.callTool({ name, arguments: args }, { signal: AbortSignal.timeout(timeout) });
        const payload = extractToolPayload(result as unknown);
        await delay(spacing);
        return payload;
      } catch (error) {
        if (attempt >= maxAttempts || !isRateLimited(error)) throw error;
        await delay(spacing * 2 ** attempt);
      }
    }
  });
  // Keep the queue moving when a call fails, and never surface that tail as unhandled.
  toolQueue = run.then(() => undefined, () => undefined);
  return run;
}

function stringValue(record: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

// Number(null), Number("") and Number([]) are all 0, so coercing blindly turns a field
// ZoomInfo simply did not populate into a confident zero. For revenue that meant a real
// company scoring as "Under $50M" against the ICP band, so only genuine numerics count.
function numberValue(record: UnknownRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number") { if (Number.isFinite(raw)) return raw; continue; }
    if (typeof raw !== "string" || !raw.trim()) continue;
    // ZoomInfo formats some numerics as "5,500" or "$4.8B"-style text; strip grouping only.
    const value = Number(raw.replace(/,/g, "").trim());
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

// Describes an unusable response without dumping licensed data into an error string.
// The parse error and the tail are what separate a truncated payload ("Unexpected end of
// JSON input") from a malformed one, which a leading excerpt alone cannot show.
export function payloadPreview(payload: unknown): string {
  if (payload === null || payload === undefined) return `payload was ${String(payload)}`;
  if (typeof payload === "string") {
    let reason: string;
    try {
      const parsed: unknown = JSON.parse(payload);
      reason = `it parsed to ${Array.isArray(parsed) ? "an array" : typeof parsed}, not records`;
    } catch (error) { reason = error instanceof Error ? error.message : String(error); }
    return `payload was ${payload.length} chars of unparsable text (${reason}); starts "${payload.slice(0, 80)}"; ends "${payload.slice(-80)}"`;
  }
  if (Array.isArray(payload)) return `payload was an array of ${payload.length}`;
  if (typeof payload === "object") return `payload keys: ${Object.keys(payload).join(", ").slice(0, 120)}`;
  return `payload was a ${typeof payload}`;
}

function normalizeDomain(value: string): string {
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return value.replace(/^www\./, "").replace(/\/$/, "").toLowerCase(); }
}

// A company can publish several domains and ZoomInfo may order them arbitrarily, so
// every one it returns has to be considered. Matching stays exact: this widens which
// domains are compared, never how loosely they are compared.
export function recordDomains(record: UnknownRecord): string[] {
  const direct = stringValue(record, ["website", "companyWebsite", "domain", "url"]);
  const listed = Array.isArray(record.domainList) ? record.domainList.filter((value): value is string => typeof value === "string") : [];
  return [...new Set([...(direct ? [direct] : []), ...listed].map(normalizeDomain))];
}

// ZoomInfo reports annual revenue in thousands of USD on the numeric field and a bucket
// string on the range field. Only the numeric field can be compared against the ICP band,
// so the unit conversion is stated here rather than assumed at the scoring call site.
// No public company earns $10T, so a result above that means the unit assumption did not
// hold for this record. Scoring a fabricated number would be worse than scoring none, so
// the figure is dropped and the account keeps its existing, clearly-labelled revenue.
const MAX_PLAUSIBLE_REVENUE_MILLIONS = 10_000_000;

export function revenueMillionsFromRecord(record: UnknownRecord): number | null {
  const explicitMillions = numberValue(record, ["revenueMillions", "annualRevenueMillions"]);
  const thousands = numberValue(record, ["revenue", "annualRevenue"]);
  const millions = explicitMillions ?? (thousands === undefined ? undefined : thousands / 1000);
  if (millions === undefined || millions < 0 || millions > MAX_PLAUSIBLE_REVENUE_MILLIONS) return null;
  return millions;
}

export function formatRevenueBand(millions: number | null): string | undefined {
  if (millions === null) return undefined;
  if (millions >= 100_000) return "$100B+";
  if (millions >= 50_000) return "$50B+";
  if (millions >= 20_000) return "$20B+";
  if (millions >= 10_000) return "$10B-$20B";
  if (millions >= 5_000) return "$5B-$10B";
  if (millions >= 1_000) return "$1B-$5B";
  if (millions >= 50) return "$50M-$1B";
  return "Under $50M";
}

// sourceReference.url must parse as a URL. ZoomInfo returns websites as bare hostnames as
// often as full URLs, and letting one through unchecked would fail the schema and take the
// whole account's refresh down over a display-only field.
function absoluteUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { return new URL(value.includes("://") ? value : `https://${value}`).toString(); }
  catch { return undefined; }
}

// The company record was already paid for by the domain match, so the firmographics it
// carries are read here instead of being discarded with the rest of the record.
export function buildCompanyProfile(record: UnknownRecord, now = new Date()): ZoomInfoCompanyProfile {
  const revenueMillions = revenueMillionsFromRecord(record);
  const location = [stringValue(record, ["city"]), stringValue(record, ["state"]), stringValue(record, ["country"])].filter(Boolean).join(", ");
  const firmographics: Firmographics = firmographicsSchema.parse({
    employeeCount: numberValue(record, ["employeeCount", "employees", "numberOfEmployees"]) ?? null,
    revenueMillions,
    industry: stringValue(record, ["primaryIndustry", "industry", "sicIndustry", "naicsIndustry"]),
    hqLocation: location || undefined,
    companyType: stringValue(record, ["companyType", "businessModel", "ownershipType"]),
    ticker: stringValue(record, ["ticker", "tickerSymbol"]),
    foundedYear: numberValue(record, ["foundedYear", "yearFounded"]),
    source: { label: "ZoomInfo company profile", url: absoluteUrl(stringValue(record, ["website", "companyWebsite"])), observedAt: now.toISOString(), provenance: "verified" },
  });
  return {
    firmographics,
    legalName: stringValue(record, ["companyName", "name", "legalName"]),
    revenueRange: stringValue(record, ["revenueRange"]) || formatRevenueBand(revenueMillions),
  };
}

async function resolveCompany(client: Client, account: Account): Promise<{ companyId: string; record: UnknownRecord }> {
  // Seeded websites are full URLs and some carry a path ("/about/"). ZoomInfo matches on
  // the bare hostname, so searching with the raw URL returned nothing for every account
  // while the comparison below was already normalizing. Both sides must use the same form.
  const expectedDomain = normalizeDomain(account.website);
  // An exact-domain lookup needs one record; a smaller page keeps the response well under
  // any response size cap while leaving room for subsidiaries sharing the domain.
  const payload = await callTool(client, "search_companies", { companyWebsite: expectedDomain, pageSize: 5, userIntent: "Resolve a seeded target account by official website for signal monitoring." });
  const records = findRecords(payload, ["companies", "results", "data", "records"]);
  const matches = records.filter((record) => recordDomains(record).includes(expectedDomain));
  if (matches.length !== 1) {
    // Without the domains ZoomInfo actually returned there is no way to tell an empty
    // result apart from a response this code failed to parse.
    const observed = [...new Set(records.flatMap(recordDomains))].slice(0, 5);
    // Naming the fields that were present turns an unknown domain key into a fact.
    const fields = [...new Set(records.flatMap((record) => Object.keys(record)))].slice(0, 20).join(", ");
    const seen = records.length === 0
      ? `the search returned no readable records (${payloadPreview(payload)})`
      : `the search returned ${records.length} record(s) with ${observed.length ? `domains ${observed.join(", ")}` : `no readable domain; fields present: ${fields}`}`;
    throw new Error(matches.length ? `ZoomInfo returned ${matches.length} exact domain matches for ${expectedDomain}` : `No exact ZoomInfo domain match for ${expectedDomain}; ${seen}`);
  }
  const companyId = stringValue(matches[0], ["companyId", "zoominfoCompanyId", "ziCompanyId", "id"]);
  if (!companyId) throw new Error(`ZoomInfo company match for ${account.name} did not include a company ID`);
  return { companyId, record: matches[0] };
}

function topicQueries(): string[] {
  return (process.env.ZOOMINFO_INTENT_TOPIC_QUERIES || DEFAULT_TOPIC_QUERIES.join(",")).split(",").map((value) => value.trim()).filter(Boolean).slice(0, 50);
}

function collectStringArray(value: unknown, key: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectStringArray(item, key));
  const record = asRecord(value);
  if (!record) return [];
  const direct = record[key];
  const directValues = Array.isArray(direct) ? direct.filter((item): item is string => typeof item === "string") : [];
  return [...directValues, ...Object.values(record).flatMap((nested) => nested && typeof nested === "object" ? collectStringArray(nested, key) : [])];
}

// Returns the resolved topics plus, when resolution failed, a note explaining why.
// Intent is one of two signal sources, so an empty result degrades the refresh to
// Scoops-only rather than failing it outright.
async function resolveIntentTopics(client: Client): Promise<{ topics: string[]; note?: string }> {
  const queries = topicQueries();
  let payload: unknown;
  try {
    payload = await callTool(client, "lookup", { fields: queries.map((fuzzyMatch) => ({ fieldName: "intent-topics", fuzzyMatch })), userIntent: "Resolve approved intent topics for Aberdeen signal monitoring." });
  } catch (error) {
    return { topics: [], note: `ZoomInfo intent topic lookup failed, so signals came from Scoops only: ${friendlyError(error)}${lookupSchemaSummary ? ` [lookup accepts ${lookupSchemaSummary}]` : ""}` };
  }
  const records = findRecords(payload, ["topicDetails", "topics", "results", "data", "records"]);
  const topics = records.flatMap((record) => {
    const value = stringValue(record, ["topic", "name", "value", "label"]);
    return value ? [value] : [];
  });
  topics.push(...collectStringArray(payload, "topics"));
  const unique = [...new Set(topics)].slice(0, 50);
  if (unique.length) return { topics: unique };
  const shape = Object.keys(asRecord(payload) ?? {}).join(", ") || typeof payload;
  return { topics: [], note: `ZoomInfo lookup returned no intent topics for ${queries.join(", ")}, so signals came from Scoops only. Response contained: ${shape}.${lookupSchemaSummary ? ` Lookup accepts ${lookupSchemaSummary}.` : ""}` };
}

type SignalCandidate = { id: string; type: Signal["type"]; summary: string; url?: string; date: string; intentScore: number; relevantIntent: boolean; transformationEvidence: boolean; mergerOrAcquisition: boolean; topic?: string; scoopType?: string };

function validDate(record: UnknownRecord, keys: string[]): string | undefined {
  const value = stringValue(record, keys);
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString().slice(0, 10);
}

function intentType(topic: string): Signal["type"] {
  const normalized = topic.toLowerCase();
  if (normalized.includes("artificial intelligence") || normalized.includes("generative") || normalized.includes("machine learning")) return "AI intent";
  if (normalized.includes("cloud") || normalized.includes("modern")) return "Technology modernization";
  return "Transformation";
}

function scoopType(value: string): Signal["type"] | undefined {
  if (value === "Funding") return "Funding";
  if (value.includes("Acquisition") || value.includes("M&A")) return "M&A";
  if (["New Hire", "Promotion", "Management Move", "Executive Move"].includes(value)) return "Executive hire";
  if (["Product Launch", "Facilities Relocation / Expansion", "Project"].includes(value)) return "Technology modernization";
  if (["Pain Point", "Partnership"].includes(value)) return "Transformation";
  return undefined;
}

function whyNow(type: Signal["type"]): string {
  const messages: Record<Signal["type"], string> = {
    "AI intent": "Recent research activity indicates an opportunity to validate the priority, sponsor, timing, and smallest measurable AI outcome.",
    "Executive hire": "A recent leadership change may create a window to validate transformation priorities and the executive mandate.",
    "M&A": "Current transaction activity may create integration, modernization, and operating-model decisions that warrant timely discovery.",
    "Transformation": "Recent business activity may signal a transformation priority; confirm the initiative and measurable outcome before advancing.",
    "Technology modernization": "Recent modernization activity may create a focused opening to connect platform work with measurable adoption and value.",
    "Funding": "Recent funding may create capacity for prioritized experimentation and a scalable delivery model; confirm allocation and timing.",
    "No current signal": "No qualifying ZoomInfo trigger was found in the configured lookback window; keep this account in monitoring.",
  };
  return messages[type];
}

export function buildSignalFromToolResults(accountId: string, intentPayload: unknown, scoopsPayload: unknown, now = new Date()): Signal {
  const intentRecords = findRecords(intentPayload, ["intent", "signals", "results", "data", "records"]);
  const scoopRecords = findRecords(scoopsPayload, ["scoops", "results", "data", "records"]);
  const candidates: SignalCandidate[] = [];
  const lookbackStart = new Date(now);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - Number(process.env.ZOOMINFO_SIGNAL_LOOKBACK_DAYS || 90));
  for (const record of intentRecords) {
    const topic = stringValue(record, ["topic", "topicName", "name"]);
    const date = validDate(record, ["signalDate", "date", "observedAt"]);
    const score = numberValue(record, ["signalScore", "score"]) ?? 0;
    if (!topic || !date || score < 70 || Date.parse(date) < lookbackStart.getTime()) continue;
    const type = intentType(topic);
    candidates.push({ id: stringValue(record, ["intentId", "id"]) || `${accountId}-intent-${topic}`, type, summary: `ZoomInfo intent activity for ${topic} (signal score ${score}).`, url: stringValue(record, ["link", "url", "sourceUrl"]), date, intentScore: score, relevantIntent: true, transformationEvidence: type !== "No current signal", mergerOrAcquisition: false, topic });
  }
  for (const record of scoopRecords) {
    const rawType = stringValue(record, ["scoopType", "type", "category"]);
    const date = validDate(record, ["originalPublishedDate", "publishedDate", "date"]);
    const mappedType = rawType ? scoopType(rawType) : undefined;
    if (!rawType || !date || !mappedType || Date.parse(date) < lookbackStart.getTime()) continue;
    candidates.push({ id: stringValue(record, ["scoopId", "id"]) || `${accountId}-scoop-${date}`, type: mappedType, summary: stringValue(record, ["description", "summary", "linkText"]) || `ZoomInfo ${rawType} scoop.`, url: stringValue(record, ["link", "url", "sourceUrl"]), date, intentScore: 0, relevantIntent: false, transformationEvidence: ["Transformation", "Technology modernization"].includes(mappedType), mergerOrAcquisition: mappedType === "M&A", scoopType: rawType });
  }
  candidates.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.intentScore - a.intentScore || a.id.localeCompare(b.id));
  // Only one candidate becomes the headline, but the workspace scores and recommends against
  // the whole observed picture, so every qualifying trigger is carried through as evidence.
  // ZoomInfo can report the same topic on several dates. Deduplicating on the way in keeps
  // the highest-scoring observation and stops the workspace repeating one topic as evidence.
  // filter() copies first, so sorting here never disturbs the headline ordering below.
  const byTopic = new Map<string, SignalCandidate>();
  for (const candidate of candidates.filter((item) => item.topic).sort((a, b) => b.intentScore - a.intentScore)) {
    if (!byTopic.has(candidate.topic!.toLowerCase())) byTopic.set(candidate.topic!.toLowerCase(), candidate);
  }
  const byScoop = new Map<string, SignalCandidate>();
  for (const candidate of candidates.filter((item) => item.scoopType)) {
    if (!byScoop.has(candidate.id)) byScoop.set(candidate.id, candidate);
  }
  const evidence = {
    intentTopics: [...byTopic.values()].slice(0, 8).map((candidate) => ({ topic: candidate.topic!, score: candidate.intentScore, date: candidate.date })),
    scoops: [...byScoop.values()].slice(0, 8).map((candidate) => ({ type: candidate.scoopType!, summary: candidate.summary, date: candidate.date, url: absoluteUrl(candidate.url) })),
  };
  const selected = candidates[0];
  if (!selected) {
    return signalSchema.parse({ id: `zoominfo-none-${accountId}-${now.toISOString().slice(0, 10)}`, accountId, type: "No current signal", summary: "No qualifying ZoomInfo intent or scoop was found in the configured lookback window.", whyNow: whyNow("No current signal"), source: { label: "ZoomInfo licensed signal", observedAt: now.toISOString(), provenance: "verified" }, date: now.toISOString().slice(0, 10), relevantIntent: false, activeWithin90Days: false, transformationEvidence: false, mergerOrAcquisition: false, evidence });
  }
  // The scoring flags describe the account, not the headline. Reading them off the winning
  // candidate alone meant an account with qualifying intent scored zero for intent whenever a
  // scoop happened to be more recent, so they are answered from every observed trigger.
  return signalSchema.parse({
    id: selected.id,
    accountId,
    type: selected.type,
    summary: selected.summary,
    whyNow: whyNow(selected.type),
    source: { label: "ZoomInfo licensed signal", url: absoluteUrl(selected.url), observedAt: now.toISOString(), provenance: "verified" },
    date: selected.date,
    relevantIntent: candidates.some((candidate) => candidate.relevantIntent),
    activeWithin90Days: true,
    transformationEvidence: candidates.some((candidate) => candidate.transformationEvidence),
    mergerOrAcquisition: candidates.some((candidate) => candidate.mergerOrAcquisition),
    evidence,
  });
}

function decisionRoleForTitle(title: string): string {
  const normalized = title.toLowerCase();
  if (/chief|c-suite|president/.test(normalized)) return "Likely economic buyer or executive sponsor";
  if (/vice president|\bvp\b|head of/.test(normalized)) return "Likely executive sponsor or decision-maker";
  if (/director/.test(normalized)) return "Likely evaluator or functional influencer";
  return "Potential practitioner or subject-matter influencer";
}

export function normalizeBuyerFromContact(record: UnknownRecord, personId: string, rank: number, now = new Date()): Buyer | undefined {
  const name = stringValue(record, ["fullName", "name"]) || [stringValue(record, ["firstName"]), stringValue(record, ["lastName"])].filter(Boolean).join(" ");
  const title = stringValue(record, ["jobTitle", "title"]);
  if (!name || !title) return undefined;
  // Function, seniority, and department are the only non-identifying context ZoomInfo
  // returns that changes how a buyer is approached; email and phone stay excluded.
  const context = [stringValue(record, ["managementLevel", "seniority"]), stringValue(record, ["jobFunction", "department"]), stringValue(record, ["city", "location"])].filter(Boolean).join(" · ");
  return buyerSchema.parse({
    id: `zoominfo-person-${personId}`,
    name,
    title,
    decisionRole: decisionRoleForTitle(title),
    decisionRoleProvenance: "inferred",
    warmth: "Unknown",
    relationshipSource: "No known Aberdeen relationship; ZoomInfo recommendation only",
    relationshipProvenance: "unknown",
    suggestedPath: "Validate relevance and shared context before any outreach; do not treat the recommendation as a relationship.",
    source: { label: context ? `ZoomInfo recommended contact #${rank} · ${context}` : `ZoomInfo recommended contact #${rank}`, observedAt: now.toISOString(), provenance: "verified" },
  });
}

async function fetchBuyers(client: Client, companyId: string): Promise<Buyer[]> {
  const recommendationsPayload = await callTool(client, "get_recommended_contacts", { ziCompanyId: Number(companyId), useCaseType: "PROSPECTING", pageSize: 3 });
  const recommendations = findRecords(recommendationsPayload, ["recommendations", "results", "data", "records"]).slice(0, 3);
  const buyers: Buyer[] = [];
  for (let index = 0; index < recommendations.length; index += 1) {
    const personId = stringValue(recommendations[index], ["zoominfoContactId", "personId", "contactId", "id"]);
    if (!personId) continue;
    const contactPayload = await callTool(client, "search_contacts", { personId, pageSize: 1, userIntent: "Resolve a recommended business contact's name and title only; do not return engagement details." });
    const contact = findRecords(contactPayload, ["contacts", "results", "data", "records"])[0];
    if (!contact) continue;
    const buyer = normalizeBuyerFromContact(contact, personId, index + 1);
    if (buyer) buyers.push(buyer);
  }
  return buyers;
}

function isoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function refreshOneAccount(client: Client, account: Account, topics: string[]): Promise<ZoomInfoAccountUpdate> {
  const company = await resolveCompany(client, account);
  const lookbackDays = Number(process.env.ZOOMINFO_SIGNAL_LOOKBACK_DAYS || 90);
  const startDate = isoDateDaysAgo(lookbackDays);
  // Intent needs resolved topics and Scoops does not, so they fail independently.
  // Buyers are supporting context; losing them must not discard a usable signal.
  const [intentResult, scoopsResult, buyersResult] = await Promise.allSettled([
    topics.length
      ? callTool(client, "enrich_intent", { companyId: company.companyId, topics, signalScoreMin: 70, signalStartDate: startDate, sort: "-signalDate", pageSize: 25, userIntent: "Find recent buying intent relevant to Aberdeen AI strategy, product, modernization, and adoption services." })
      : Promise.resolve({}),
    callTool(client, "enrich_scoops", { zoominfoCompanyIds: [company.companyId], publishedStartDate: startDate, scoopTypes: RELEVANT_SCOOP_TYPES, sort: "-originalPublishedDate", pageSize: 25, userIntent: "Find recent business events that may create a credible consulting outreach trigger." }),
    fetchBuyers(client, company.companyId),
  ]);
  // Reporting "no current signal" when both sources errored would misrepresent a
  // failed lookup as a verified absence of triggers.
  if (intentResult.status === "rejected" && scoopsResult.status === "rejected") throw scoopsResult.reason;
  const intentPayload = intentResult.status === "fulfilled" ? intentResult.value : {};
  const scoopsPayload = scoopsResult.status === "fulfilled" ? scoopsResult.value : {};
  const buyers = buyersResult.status === "fulfilled" ? buyersResult.value : [];
  return { canonicalCompanyId: account.canonicalCompanyId, zoominfoCompanyId: company.companyId, signal: buildSignalFromToolResults(account.id, intentPayload, scoopsPayload), buyers, profile: buildCompanyProfile(company.record) };
}

function refreshCandidates(items: Account[]): Account[] {
  const representatives = new Map<string, Account>();
  for (const account of items) if (!representatives.has(account.canonicalCompanyId) || account.duplicateOf === undefined) representatives.set(account.canonicalCompanyId, account);
  const limit = Math.max(1, Math.min(19, Number(process.env.ZOOMINFO_REFRESH_ACCOUNT_LIMIT || 5)));
  return [...representatives.values()].sort((a, b) => scoreAccount(b).total - scoreAccount(a).total || a.name.localeCompare(b.name)).slice(0, limit);
}

// Bump when a refresh starts capturing fields the cached payload does not carry, otherwise a
// warm cache keeps serving the older, thinner shape until its TTL expires and the new data
// never reaches the workspace. v2 added company firmographics and full signal evidence.
const CACHE_SHAPE_VERSION = "v2";

function cacheKey(account: Account, topics: string[]): string {
  return `${CACHE_SHAPE_VERSION}|${account.canonicalCompanyId}|${normalizeDomain(account.website)}|${topics.join("|")}|${process.env.ZOOMINFO_SIGNAL_LOOKBACK_DAYS || 90}`;
}

export type ZoomInfoRefreshSummary = {
  selected: number;
  updated: number;
  cached: number;
  unchanged: number;
  failed: Array<{ accountId: string; accountName: string; message: string }>;
  estimatedCompanyCredits: number;
};

export class ZoomInfoRefreshInProgressError extends Error {
  constructor() { super("A ZoomInfo refresh is already running"); }
}

export async function refreshZoomInfoAccounts(): Promise<{ accounts: Account[]; summary: ZoomInfoRefreshSummary }> {
  const snapshot = await zoomInfoIntegrationSnapshot(true);
  if (zoomInfoMode() !== "mcp") throw new Error("ZoomInfo MCP mode is not enabled");
  if (snapshot.state !== "ready") throw new Error(snapshot.error || "Connect ZoomInfo before refreshing live signals");
  const persistence = appPersistence();
  const lockOwner = randomUUID();
  if (!await persistence.acquireLock("zoominfo-refresh", lockOwner, REFRESH_LOCK_TTL_SECONDS)) throw new ZoomInfoRefreshInProgressError();
  let connection: { client: Client; transport: StreamableHTTPClientTransport } | undefined;
  try {
    connection = await connectClient();
    const client = connection.client;
    await discoverRequiredTools(client);
    const { topics, note: intentNote } = await resolveIntentTopics(client);
    const currentAccounts = await loadAccounts();
    const candidates = refreshCandidates(currentAccounts);
    const ttlMs = Number(process.env.ZOOMINFO_CACHE_TTL_MINUTES || 1440) * 60_000;
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const updates: ZoomInfoAccountUpdate[] = [];
    const failures: ZoomInfoRefreshSummary["failed"] = [];
    const cacheExpirations: number[] = [];
    let cached = 0;
    let queried = 0;
    for (let offset = 0; offset < candidates.length; offset += 2) {
      const batch = candidates.slice(offset, offset + 2);
      const results = await Promise.allSettled(batch.map(async (account) => {
        const key = cacheKey(account, topics);
        const entry = await persistence.getCompanyCache(account.canonicalCompanyId);
        if (entry && entry.expiresAt > Date.now() && entry.key === key) return { update: entry.update, cached: true, expiresAt: entry.expiresAt };
        const update = await refreshOneAccount(client, accountSchema.parse(account), topics);
        const expiresAt = Date.now() + ttlMs;
        await persistence.saveCompanyCache(account.canonicalCompanyId, { update, expiresAt, key }, ttlSeconds);
        return { update, cached: false, expiresAt };
      }));
      results.forEach((result, index) => {
        const account = batch[index];
        if (result.status === "fulfilled") {
          updates.push(result.value.update);
          cacheExpirations.push(result.value.expiresAt);
          if (result.value.cached) cached += 1; else queried += 1;
        } else {
          failures.push({ accountId: account.id, accountName: account.name, message: friendlyError(result.reason) });
        }
      });
    }
    if (!updates.length) {
      // Naming a single account read as one company's problem when in fact every
      // candidate failed, which pointed debugging at the wrong thing.
      const distinct = [...new Set(failures.map((failure) => failure.message))];
      const message = failures.length
        ? `All ${failures.length} ZoomInfo accounts failed to refresh. ${distinct.slice(0, 3).join(" | ")}${distinct.length > 3 ? ` | and ${distinct.length - 3} more` : ""}`
        : "ZoomInfo refresh returned no usable account data";
      await persistence.updateZoomInfoMeta({ error: message });
      throw new Error(message);
    }
    const updatedAccounts = await applyAndPersistZoomInfoUpdates(updates, currentAccounts);
    await persistence.updateZoomInfoMeta({
      lastSuccessfulRefreshAt: new Date().toISOString(),
      cacheExpiresAt: cacheExpirations.length ? new Date(Math.min(...cacheExpirations)).toISOString() : undefined,
      error: undefined,
      lastRefreshNote: [intentNote, supersededToolSummary && `Newer ZoomInfo tools are available: ${supersededToolSummary}`].filter(Boolean).join(" "),
    });
    return {
      accounts: updatedAccounts,
      summary: { selected: candidates.length, updated: updates.length, cached, unchanged: new Set(updatedAccounts.map((account) => account.canonicalCompanyId)).size - updates.length, failed: failures, estimatedCompanyCredits: queried * 2 },
    };
  } catch (error) {
    await persistence.updateZoomInfoMeta({ error: friendlyError(error) });
    throw error;
  } finally {
    if (connection) await closeClient(connection.client, connection.transport);
    await persistence.releaseLock("zoominfo-refresh", lockOwner);
  }
}

export function resetZoomInfoStateForTests(): void {
  resetPersistenceForTests();
  toolQueue = Promise.resolve();
}

export const zoomInfoInternalsForTests = { callTool, isRateLimited, extractToolPayload, findRecords };
