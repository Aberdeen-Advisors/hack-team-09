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
