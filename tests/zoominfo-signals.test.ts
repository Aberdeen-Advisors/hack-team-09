import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appPersistence } from "@/lib/persistence";
import { buildSignalFromCompanySignals, resetZoomInfoStateForTests, zoomInfoInternalsForTests } from "@/lib/zoominfo-mcp";
import { liveAccount } from "./fixtures";

const core = ["lookup", "search_companies", "get_recommended_contacts", "search_contacts"];
const toolList = (names: string[]) => names.map((name) => ({ name, inputSchema: { type: "object" as const } }));
const now = new Date("2026-09-09T12:00:00Z");
const topics = ["AI Copilot"];
const payload = () => ({ results: [{
  company: { zoominfoCompanyId: "123", name: "Example Company" }, status: "success",
  signals: [
    { signalType: "intent", date: "2026-09-05T00:00:00Z", details: { topic: "AI Copilot", signalScore: 95 } },
    { signalType: "intent", date: "2026-09-05T00:00:00Z", details: { topic: "Electronic Health Records", signalScore: 99 } },
    { signalType: "scoop", date: "2026-09-02T00:00:00Z", summary: "A leadership change was announced.", details: { types: [{ type: "Left Company" }, { type: "Executive Move" }], link: "https://example.com/leadership" } },
    { signalType: "scoop", date: "2026-09-02T00:00:00Z", summary: "A platform modernization project was announced.", details: { types: [{ type: "Project" }] } },
  ], signalCounts: { intent: { available: 2, returned: 2 }, scoop: { available: 2, returned: 2 } },
}] });

beforeEach(() => { resetZoomInfoStateForTests(); vi.stubEnv("ZOOMINFO_MCP_REQUEST_SPACING_MS", "0"); });
afterEach(() => vi.unstubAllEnvs());

describe("ZoomInfo tool compatibility", () => {
  it("accepts the replacement tool without requiring the removed legacy pair", async () => {
    const client = { listTools: vi.fn().mockResolvedValue({ tools: toolList([...core, "enrich_company_signals"]) }) };
    await appPersistence().updateZoomInfoMeta({ error: "ZoomInfo account is missing required MCP tools: enrich_intent, enrich_scoops" });
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    expect((await appPersistence().getZoomInfoMeta()).requiredToolsReady).toBe(true);
    expect((await appPersistence().getZoomInfoMeta()).error).toBeUndefined();
  });
  it("retains compatibility with the legacy tool pair", async () => {
    const client = { listTools: vi.fn().mockResolvedValue({ tools: toolList([...core, "enrich_intent", "enrich_scoops"]) }) };
    await appPersistence().updateZoomInfoMeta({ error: "ZoomInfo account is missing required MCP tools: enrich_intent, enrich_scoops" });
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    expect((await appPersistence().getZoomInfoMeta()).requiredToolsReady).toBe(true);
    expect((await appPersistence().getZoomInfoMeta()).error).toBeUndefined();
  });
  it("discovers tools on subsequent list pages", async () => {
    const client = { listTools: vi.fn().mockResolvedValueOnce({ tools: toolList(core), nextCursor: "page-2" }).mockResolvedValueOnce({ tools: toolList(["enrich_company_signals"]) }) };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    expect(client.listTools).toHaveBeenLastCalledWith({ cursor: "page-2" });
  });
  it("rejects unsupported signal capabilities with an actionable error", async () => {
    const client = { listTools: vi.fn().mockResolvedValue({ tools: toolList([...core, "search_intent", "search_scoops"]) }) };
    await expect(zoomInfoInternalsForTests.discoverRequiredTools(client as never)).rejects.toThrow("enrich_company_signals (or both legacy");
    expect((await appPersistence().getZoomInfoMeta()).requiredToolsReady).toBe(false);
  });
  it("rejects contact tools whose discovered schemas have no supported identifiers", async () => {
    const tools = [
      ...toolList(["lookup", "search_companies", "enrich_company_signals"]),
      { name: "get_recommended_contacts", inputSchema: { type: "object" as const, properties: { unsupportedCompanyKey: { type: "string" } } } },
      { name: "search_contacts", inputSchema: { type: "object" as const, properties: { unsupportedPersonKey: { type: "string" } } } },
    ];
    const client = { listTools: vi.fn().mockResolvedValue({ tools }) };
    await expect(zoomInfoInternalsForTests.discoverRequiredTools(client as never)).rejects.toThrow("supported contact tool schema");
    expect((await appPersistence().getZoomInfoMeta()).requiredToolsReady).toBe(false);
  });
  it("stops repeated pagination cursors", async () => {
    const client = { listTools: vi.fn().mockResolvedValue({ tools: toolList(core), nextCursor: "same" }) };
    await expect(zoomInfoInternalsForTests.discoverRequiredTools(client as never)).rejects.toThrow("repeated page cursor");
  });
  it("routes refresh to the unified endpoint with numeric company IDs and supported parameters", async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: toolList([...core, "enrich_company_signals", "enrich_intent", "enrich_scoops"]) }),
      callTool: vi.fn(async ({ name }: { name: string }) => {
        if (name === "search_companies") return { structuredContent: { companies: [{ companyId: "123", website: "draftkings.com", name: "DraftKings" }] } };
        if (name === "enrich_company_signals") return { content: [{ type: "text", text: JSON.stringify(payload()) }] };
        if (name === "get_recommended_contacts") return { structuredContent: { recommendations: [] } };
        throw new Error(`Unexpected tool ${name}`);
      }),
    };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const update = await zoomInfoInternalsForTests.refreshOneAccount(client as never, liveAccount(), topics);
    expect(update.signal.source.provenance).toBe("verified");
    expect(update.signal.evidence.intentTopics[0].topic).toBe("AI Copilot");
    expect(update.signal.evidence.scoops).toHaveLength(2);
    expect(client.callTool).toHaveBeenCalledWith({ name: "enrich_company_signals", arguments: { zoominfoCompanyIds: [123], signalTypes: ["INTENT", "SCOOP"], userIntent: expect.any(String) } }, expect.anything());
    expect(client.callTool.mock.calls.map(([call]) => call.name)).not.toContain("enrich_intent");
  });
});

describe("buyer contact resolution", () => {
  function contactTools(resolverName: "enrich_contacts" | "search_contacts" = "search_contacts", resolverProperties: Record<string, unknown> = { personId: { type: "string" }, pageSize: { type: "number" }, userIntent: { type: "string" } }) {
    return [
      ...toolList(["lookup", "search_companies"]),
      { name: "get_recommended_contacts", inputSchema: { type: "object" as const, properties: { ziCompanyId: { type: "number" }, useCaseType: { type: "string" }, pageSize: { type: "number" } }, required: ["ziCompanyId"] } },
      { name: resolverName, inputSchema: { type: "object" as const, properties: resolverProperties } },
      ...toolList(["enrich_company_signals"]),
    ];
  }

  it("uses complete recommendation identity without an unnecessary contact call", async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: contactTools() }),
      callTool: vi.fn().mockResolvedValue({ structuredContent: { recommendations: [{ personId: "11", fullName: "Jordan Example", jobTitle: "VP, Data" }] } }),
    };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const result = await zoomInfoInternalsForTests.fetchBuyers(client as never, "123");
    expect(result.buyers).toHaveLength(1);
    expect(result.diagnostic).toMatchObject({ status: "verified", recommendationsReturned: 1, usableContactIds: 1, contactsHydrated: 1, contactsRejected: 0 });
    expect(client.callTool).toHaveBeenCalledTimes(1);
  });

  it("prefers enrich_contacts and shapes an array identifier from its discovered schema", async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: contactTools("enrich_contacts", { personIds: { type: "array", items: { type: "number" } } }) }),
      callTool: vi.fn(async ({ name }: { name: string }) => name === "get_recommended_contacts"
        ? { structuredContent: { recommendations: [{ zoominfoContactId: 22 }] } }
        : { structuredContent: { data: [{ person: { fullName: "Taylor Example", jobTitle: "Chief Data Officer" } }] } }),
    };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const result = await zoomInfoInternalsForTests.fetchBuyers(client as never, "123");
    expect(result.buyers[0]).toMatchObject({ name: "Taylor Example", title: "Chief Data Officer" });
    expect(client.callTool).toHaveBeenCalledWith({ name: "enrich_contacts", arguments: { personIds: [22] } }, expect.anything());
  });

  it("preserves the current recommendation ID and requests available business contact fields", async () => {
    const currentEnrichSchema = {
      contacts: { type: "array", items: { type: "object" } },
      requiredFields: { type: "array", items: { type: "string" } },
      userIntent: { type: "string" },
    };
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: contactTools("enrich_contacts", currentEnrichSchema) }),
      callTool: vi.fn(async ({ name }: { name: string }) => name === "get_recommended_contacts"
        ? { structuredContent: { recommendations: [{ zoominfoContactId: 13728122400, attributes: { rank: 1, score: 0.84, recommendedPersonBrief: "Director, Data" } }] } }
        : { structuredContent: { data: [{ status: "success", data: { person: { personId: "13728122400", firstName: "Casey", lastName: "Example", jobTitle: "Director, Data", email: "casey@example.com", phone: "+1 555-0134", externalUrls: [{ url: "https://www.linkedin.com/in/casey-example" }] } } }] } }),
    };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const result = await zoomInfoInternalsForTests.fetchBuyers(client as never, "123");
    expect(result.buyers[0]).toMatchObject({ name: "Casey Example", title: "Director, Data", email: "casey@example.com", phone: "+1 555-0134", linkedinUrl: "https://www.linkedin.com/in/casey-example" });
    expect(client.callTool).toHaveBeenCalledWith({ name: "enrich_contacts", arguments: {
      contacts: [{ personId: "13728122400" }],
      requiredFields: ["firstName", "lastName", "jobTitle", "jobFunction", "managementLevel", "zoominfoCompanyId", "email", "phone", "mobilePhone", "externalUrls"],
      userIntent: expect.any(String),
    } }, expect.anything());
  });

  it("falls back to search_contacts when the available enrich schema is incompatible", async () => {
    const tools = [...contactTools(), { name: "enrich_contacts", inputSchema: { type: "object" as const, properties: { matchPersonInput: { type: "array" } } } }];
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools }),
      callTool: vi.fn(async ({ name }: { name: string }) => name === "get_recommended_contacts"
        ? { structuredContent: { recommendations: [{ personId: "23" }] } }
        : { structuredContent: { contacts: [{ personId: "23", fullName: "Morgan Example", jobTitle: "VP, Technology" }] } }),
    };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const result = await zoomInfoInternalsForTests.fetchBuyers(client as never, "123");
    expect(result.buyers[0].name).toBe("Morgan Example");
    expect(client.callTool).toHaveBeenCalledWith({ name: "search_contacts", arguments: { personId: "23", pageSize: 1, userIntent: expect.any(String) } }, expect.anything());
  });

  it("reports an explicit empty recommendation result", async () => {
    const client = { listTools: vi.fn().mockResolvedValue({ tools: contactTools() }), callTool: vi.fn().mockResolvedValue({ structuredContent: { recommendations: [] } }) };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const result = await zoomInfoInternalsForTests.fetchBuyers(client as never, "123");
    expect(result).toMatchObject({ buyers: [], preserveExisting: false, diagnostic: { status: "empty", recommendationsReturned: 0, contactsRejected: 0 } });
  });

  it("counts recommendations that cannot supply a stable ID or complete identity", async () => {
    const responses = [
      { structuredContent: { recommendations: [{ fullName: "No Identifier", jobTitle: "VP" }, { personId: "33" }] } },
      { structuredContent: { contacts: [{ personId: "33", fullName: "Missing Title" }] } },
    ];
    const client = { listTools: vi.fn().mockResolvedValue({ tools: contactTools() }), callTool: vi.fn().mockImplementation(async () => responses.shift()) };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const result = await zoomInfoInternalsForTests.fetchBuyers(client as never, "123");
    expect(result).toMatchObject({ buyers: [], preserveExisting: true, diagnostic: { status: "partial", recommendationsReturned: 2, usableContactIds: 1, contactsHydrated: 0, contactsRejected: 2 } });
  });

  it("distinguishes a failed resolver from a valid empty result", async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: contactTools() }),
      callTool: vi.fn(async ({ name }: { name: string }) => {
        if (name === "get_recommended_contacts") return { structuredContent: { recommendations: [{ personId: "44" }] } };
        throw new Error("provider unavailable");
      }),
    };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const result = await zoomInfoInternalsForTests.fetchBuyers(client as never, "123");
    expect(result).toMatchObject({ buyers: [], preserveExisting: true, diagnostic: { status: "failed", recommendationsReturned: 1, usableContactIds: 1, contactsHydrated: 0, contactsRejected: 1 } });
  });
});

describe("intent topic lookup", () => {
  function compatibleTools(lookupProperties: Record<string, unknown>) {
    return [
      { name: "lookup", inputSchema: { type: "object" as const, properties: lookupProperties } },
      ...toolList(["search_companies", "get_recommended_contacts", "search_contacts", "enrich_company_signals"]),
    ];
  }

  it("extracts IDs from the current intent-topics response envelope", async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: compatibleTools({ fields: { type: "array" }, userIntent: { type: "string" } }) }),
      callTool: vi.fn().mockResolvedValue({ structuredContent: { "intent-topics": [
        { fuzzyMatch: "AI", data: [
          { id: "AI Copilot", type: "IntentTopic", attributes: { name: "AI Copilot", category: "Artificial Intelligence" } },
          { id: "AI Governance", type: "IntentTopic", attributes: { name: "AI Governance", category: "Artificial Intelligence" } },
        ] },
        { fuzzyMatch: "data", data: [{ id: "Data Transformation", type: "IntentTopic", attributes: { name: "Data Transformation" } }] },
      ] } }),
    };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const result = await zoomInfoInternalsForTests.resolveIntentTopics(client as never);
    expect(result).toEqual({ topics: ["AI Copilot", "AI Governance", "Data Transformation"] });
    expect(client.callTool).toHaveBeenCalledWith({ name: "lookup", arguments: {
      fields: [
        { fieldName: "intent-topics", fuzzyMatch: "AI" },
        { fieldName: "intent-topics", fuzzyMatch: "digital transformation" },
        { fieldName: "intent-topics", fuzzyMatch: "data" },
      ],
      userIntent: expect.any(String),
    } }, expect.anything());
  });

  it("adapts to a singular lookup schema", async () => {
    vi.stubEnv("ZOOMINFO_INTENT_TOPIC_QUERIES", "AI,data");
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: compatibleTools({ fieldName: { type: "string" }, fuzzyMatch: { type: "string" } }) }),
      callTool: vi.fn(async ({ arguments: args }: { arguments: { fuzzyMatch: string } }) => ({ structuredContent: { topics: [args.fuzzyMatch === "AI" ? "AI Copilot" : "Data Transformation"] } })),
    };
    await zoomInfoInternalsForTests.discoverRequiredTools(client as never);
    const result = await zoomInfoInternalsForTests.resolveIntentTopics(client as never);
    expect(result.topics).toEqual(["AI Copilot", "Data Transformation"]);
    expect(client.callTool).toHaveBeenCalledTimes(2);
  });
});

describe("unified signal normalization", () => {
  it("maps the observed response format and filters unrelated intent topics", () => {
    const { signal, warnings } = buildSignalFromCompanySignals("account", "123", payload(), topics, now);
    expect(signal.type).toBe("AI intent");
    expect(signal.evidence.intentTopics.map((item) => item.topic)).toEqual(topics);
    expect(signal.evidence.scoops).toHaveLength(2);
    expect(signal.evidence.scoops.find((scoop) => scoop.type === "Executive Move")?.url).toBe("https://example.com/leadership");
    expect(warnings).toEqual([]);
  });
  it("does not claim complete coverage for truncated results", () => {
    const data = payload();
    data.results[0].signalCounts.scoop.available = 163;
    const { signal, warnings } = buildSignalFromCompanySignals("account", "123", data, topics, now);
    expect(warnings.join(" ")).toContain("limited scoop snapshot");
    expect(signal.mergerOrAcquisition).toBeNull();
  });
  it("rejects a mismatched company rather than attributing its signals to the target", () => {
    expect(() => buildSignalFromCompanySignals("account", "999", payload(), topics, now)).toThrow("exactly one result");
  });
  it("rejects failed or malformed responses rather than reporting no signal", () => {
    const data = payload();
    data.results[0].status = "error";
    expect(() => buildSignalFromCompanySignals("account", "123", data, topics, now)).toThrow("status error");
    expect(() => buildSignalFromCompanySignals("account", "123", { results: [{ company: { zoominfoCompanyId: "123" } }] }, topics, now)).toThrow("signals array");
  });
  it("recognizes an explicit complete empty result", () => {
    const data = payload();
    data.results[0].signals = [];
    data.results[0].signalCounts = { intent: { available: 0, returned: 0 }, scoop: { available: 0, returned: 0 } };
    const { signal, warnings } = buildSignalFromCompanySignals("account", "123", data, topics, now);
    expect(signal.type).toBe("No current signal");
    expect(signal.relevantIntent).toBe(false);
    expect(warnings).toEqual([]);
  });
  it("does not interpret a failed topic lookup as verified absence of intent", () => {
    const { signal, warnings } = buildSignalFromCompanySignals("account", "123", payload(), [], now);
    expect(signal.relevantIntent).toBeNull();
    expect(warnings.join(" ")).toContain("topic lookup unavailable");
  });
});
