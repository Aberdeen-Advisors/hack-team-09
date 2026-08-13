import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appPersistence, resetPersistenceForTests } from "@/lib/persistence";
import { applyZoomInfoUpdates, getSessionAccounts, resetSessionAccountsForTests } from "@/lib/session-store";
import { DurableZoomInfoOAuthProvider, buildSignalFromToolResults, credentialDiagnostics, normalizeBuyerFromContact, recordDomains, resetZoomInfoStateForTests } from "@/lib/zoominfo-mcp";

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
