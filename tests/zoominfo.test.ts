import { beforeEach, describe, expect, it } from "vitest";
import { applyZoomInfoUpdates, getSessionAccounts, resetSessionAccountsForTests } from "@/lib/session-store";
import { buildSignalFromToolResults, normalizeBuyerFromContact, resetZoomInfoStateForTests } from "@/lib/zoominfo-mcp";

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
