import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appPersistence, resetPersistenceForTests } from "@/lib/persistence";
import { applyZoomInfoUpdates, getSessionAccounts, resetSessionAccountsForTests } from "@/lib/session-store";
import { DurableZoomInfoOAuthProvider, buildSignalFromToolResults, credentialDiagnostics, normalizeBuyerFromContact, recordDomains, resetZoomInfoStateForTests, zoomInfoInternalsForTests } from "@/lib/zoominfo-mcp";

describe("ZoomInfo MCP normalization", () => {
  beforeEach(() => {
    resetSessionAccountsForTests();
    resetZoomInfoStateForTests();
  });

  it("selects the newest qualifying signal and maps its provenance", () => {
    const signal = buildSignalFromToolResults(
      "draftkings",
      { intent: [{ id: "intent-1", topic: "Generative AI", signalScore: 92, signalDate: "2026-08-01" }] },
      { scoops: [{ scoopId: "scoop-1", scoopType: "Funding", originalPublishedDate: "2026-08-05", description: "Announced a new growth investment.", link: "https://example.com/funding" }] },
      new Date("2026-08-13T12:00:00.000Z"),
    );

    expect(signal.type).toBe("Funding");
    expect(signal.id).toBe("scoop-1");
    expect(signal.source.provenance).toBe("verified");
    expect(signal.source.label).toBe("ZoomInfo licensed signal");
  });

  it("reads every domain a company publishes, not just the first", () => {
    expect(recordDomains({ domainList: ["vacationclub.com", "marriottvacationsworldwide.com"] })).toContain("marriottvacationsworldwide.com");
    expect(recordDomains({ companyWebsite: "https://www.MarriottVacationsWorldwide.com/" })).toEqual(["marriottvacationsworldwide.com"]);
    // Seeded sites carry schemes, www, and sometimes a path; all must reduce to the host.
    expect(recordDomains({ website: "https://www.draftkings.com/about/" })).toEqual(["draftkings.com"]);
    expect(recordDomains({})).toEqual([]);
  });

  it("still produces a scoop signal when intent topics could not be resolved", () => {
    const signal = buildSignalFromToolResults(
      "draftkings",
      {},
      { scoops: [{ scoopId: "scoop-9", scoopType: "Mergers & Acquisitions (M&A)", originalPublishedDate: "2026-07-30", description: "Agreed to acquire a competitor." }] },
      new Date("2026-08-13T12:00:00.000Z"),
    );

    expect(signal.type).toBe("M&A");
    expect(signal.mergerOrAcquisition).toBe(true);
    expect(signal.activeWithin90Days).toBe(true);
    expect(signal.source.label).toBe("ZoomInfo licensed signal");
  });

  it("returns a verified no-signal state instead of synthetic fallback data", () => {
    const signal = buildSignalFromToolResults(
      "draftkings",
      { intent: [{ topic: "Generative AI", signalScore: 60, signalDate: "2026-08-01" }] },
      { scoops: [] },
      new Date("2026-08-13T12:00:00.000Z"),
    );

    expect(signal.type).toBe("No current signal");
    expect(signal.relevantIntent).toBe(false);
    expect(signal.activeWithin90Days).toBe(false);
    expect(signal.source.provenance).toBe("verified");
  });

  it("keeps buyer identity fields while excluding email and phone data", () => {
    const buyer = normalizeBuyerFromContact({ fullName: "Jordan Example", jobTitle: "VP, Data", email: "jordan@example.com", phone: "555-0100" }, "123", 1, new Date("2026-08-13T12:00:00.000Z"));

    expect(buyer).toMatchObject({ name: "Jordan Example", title: "VP, Data", warmth: "Unknown", decisionRoleProvenance: "inferred", relationshipProvenance: "unknown" });
    expect(buyer).not.toHaveProperty("email");
    expect(buyer).not.toHaveProperty("phone");
  });

  it("applies one canonical update to duplicate account rows", () => {
    const signal = buildSignalFromToolResults("marriott-vacations", {}, {}, new Date("2026-08-13T12:00:00.000Z"));
    applyZoomInfoUpdates([{ canonicalCompanyId: "marriott-vacations", zoominfoCompanyId: "456", signal, buyers: [] }]);

    const rows = getSessionAccounts().filter((account) => account.canonicalCompanyId === "marriott-vacations");
    expect(rows).toHaveLength(2);
    expect(rows.every((account) => account.providerIds?.zoominfoCompanyId === "456")).toBe(true);
    expect(rows.map((account) => account.signal.accountId).sort()).toEqual(["marriott-vacations", "marriott-vacations-corp"]);
    expect(rows.every((account) => account.signal.type === "No current signal")).toBe(true);
  });
});

describe("ZoomInfo response decoding", () => {
  // Shape observed from the live ZoomInfo MCP server: JSON:API records nested under
  // data[].attributes, with structuredContent delivered as a string rather than an object.
  const companies = { data: [{ id: "345", attributes: { name: "DraftKings", city: "Boston", employeeCount: "5500", website: "https://www.draftkings.com" } }] };

  it("decodes structuredContent delivered as a JSON string", () => {
    const payload = zoomInfoInternalsForTests.extractToolPayload({ structuredContent: JSON.stringify(companies) });
    expect(payload).toEqual(companies);
  });

  it("leaves an already-decoded structuredContent object untouched", () => {
    expect(zoomInfoInternalsForTests.extractToolPayload({ structuredContent: companies })).toEqual(companies);
  });

  it("keeps non-JSON text as text rather than discarding it", () => {
    expect(zoomInfoInternalsForTests.extractToolPayload({ structuredContent: "not json at all" })).toBe("not json at all");
  });

  it("flattens attributes and resolves the company domain and id", () => {
    const payload = zoomInfoInternalsForTests.extractToolPayload({ structuredContent: JSON.stringify(companies) });
    const records = zoomInfoInternalsForTests.findRecords(payload, ["companies", "results", "data", "records"]);

    expect(records).toHaveLength(1);
    expect(recordDomains(records[0])).toContain("draftkings.com");
    expect(records[0].id).toBe("345");
    expect(records[0].name).toBe("DraftKings");
  });

  it("still surfaces a tool error instead of decoding it", () => {
    expect(() => zoomInfoInternalsForTests.extractToolPayload({ isError: true, content: [{ type: "text", text: "quota exceeded" }] })).toThrow("quota exceeded");
  });
});

describe("ZoomInfo rate limit handling", () => {
  const rateLimit = new Error('Error POSTing to endpoint: {"errors":[{"code":"ZI0004","detail":"Too many requests. Please retry after 1 second.","title":"Rate limit exceeded"}]}');

  beforeEach(() => {
    resetZoomInfoStateForTests();
    process.env.ZOOMINFO_MCP_REQUEST_SPACING_MS = "0";
  });

  afterEach(() => { delete process.env.ZOOMINFO_MCP_REQUEST_SPACING_MS; });

  it("recognizes ZoomInfo's quota error and not unrelated failures", () => {
    expect(zoomInfoInternalsForTests.isRateLimited(rateLimit)).toBe(true);
    expect(zoomInfoInternalsForTests.isRateLimited(new Error("No exact ZoomInfo domain match"))).toBe(false);
  });

  it("retries a rate-limited call instead of failing the account", async () => {
    let attempts = 0;
    const client = { callTool: async () => { attempts += 1; if (attempts < 3) throw rateLimit; return { structuredContent: { companies: [{ companyId: "1" }] } }; } };

    const payload = await zoomInfoInternalsForTests.callTool(client as never, "search_companies", {});
    expect(attempts).toBe(3);
    expect(payload).toEqual({ companies: [{ companyId: "1" }] });
  });

  it("gives up after the configured attempts and surfaces the quota error", async () => {
    process.env.ZOOMINFO_MCP_MAX_ATTEMPTS = "2";
    let attempts = 0;
    const client = { callTool: async () => { attempts += 1; throw rateLimit; } };

    await expect(zoomInfoInternalsForTests.callTool(client as never, "search_companies", {})).rejects.toThrow("ZI0004");
    expect(attempts).toBe(2);
    delete process.env.ZOOMINFO_MCP_MAX_ATTEMPTS;
  });

  it("does not retry an error that is not a quota failure", async () => {
    let attempts = 0;
    const client = { callTool: async () => { attempts += 1; throw new Error("company not found"); } };

    await expect(zoomInfoInternalsForTests.callTool(client as never, "search_companies", {})).rejects.toThrow("company not found");
    expect(attempts).toBe(1);
  });

  it("keeps serving queued calls after one of them fails", async () => {
    const client = { callTool: async ({ name }: { name: string }) => { if (name === "bad") throw new Error("boom"); return { structuredContent: { ok: true } }; } };

    await expect(zoomInfoInternalsForTests.callTool(client as never, "bad", {})).rejects.toThrow("boom");
    await expect(zoomInfoInternalsForTests.callTool(client as never, "good", {})).resolves.toEqual({ ok: true });
  });
});

describe("ZoomInfo OAuth client authentication", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetPersistenceForTests();
    process.env.ZOOMINFO_MCP_CLIENT_ID = "  client-abc  ";
    process.env.ZOOMINFO_MCP_CLIENT_SECRET = "  secret-xyz\n";
    delete process.env.ZOOMINFO_MCP_AUTH_METHOD;
  });

  afterEach(() => { process.env = { ...originalEnv }; });

  function authenticate() {
    const provider = new DurableZoomInfoOAuthProvider(appPersistence());
    const headers = new Headers();
    const params = new URLSearchParams();
    return provider.addClientAuthentication(headers, params).then(() => ({ headers, params }));
  }

  it("trims whitespace pasted around the configured credentials", async () => {
    const { params } = await authenticate();
    expect(params.get("client_id")).toBe("client-abc");
    expect(params.get("client_secret")).toBe("secret-xyz");
  });

  it("sends the secret in the request body by default", async () => {
    const { headers, params } = await authenticate();
    expect(params.get("client_secret")).toBe("secret-xyz");
    expect(headers.get("authorization")).toBeNull();
  });

  it("sends the secret as a basic authorization header when configured", async () => {
    process.env.ZOOMINFO_MCP_AUTH_METHOD = "basic";
    const { headers, params } = await authenticate();
    expect(params.get("client_secret")).toBeNull();
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("client-abc:secret-xyz").toString("base64")}`);
  });

  it("omits the secret entirely for a public PKCE client", async () => {
    process.env.ZOOMINFO_MCP_AUTH_METHOD = "none";
    delete process.env.ZOOMINFO_MCP_CLIENT_SECRET;
    const { headers, params } = await authenticate();
    expect(params.get("client_id")).toBe("client-abc");
    expect(params.get("client_secret")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("reports credential shape without revealing the secret", () => {
    const diagnostics = credentialDiagnostics();
    expect(diagnostics).toContain("client_secret_post");
    expect(diagnostics).toContain("client secret 10 chars");
    expect(diagnostics).toContain("trimmed surrounding whitespace from client ID and client secret");
    expect(diagnostics).not.toContain("secret-xyz");
  });
});
