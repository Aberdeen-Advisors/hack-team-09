import { describe, expect, it } from "vitest";
import { accounts, offerings } from "@/lib/data";
import { matchOfferingMock } from "@/lib/recommendations";
import { scoreAccount } from "@/lib/scoring";
import { accountSchema, type Account } from "@/lib/schemas";

// A refresh writes ZoomInfo's observations onto the account. These cover the step after
// that: that the prioritize score and the pursuit recommendation actually read them,
// rather than restating seeded demo text while live data sits unused on the record.
function withZoomInfoInsights(id: string, overrides: Partial<Account> = {}): Account {
  const seeded = accounts.find((item) => item.id === id)!;
  return accountSchema.parse({
    ...seeded,
    firmographics: {
      employeeCount: 5500,
      revenueMillions: 4800,
      industry: "Gaming",
      hqLocation: "Boston, MA",
      source: { label: "ZoomInfo company profile", observedAt: "2026-08-13T12:00:00.000Z", provenance: "verified" },
    },
    revenueMillions: 4800,
    revenueRange: "$1B-$5B",
    signal: {
      ...seeded.signal,
      source: { label: "ZoomInfo licensed signal", observedAt: "2026-08-13T12:00:00.000Z", provenance: "verified" },
      date: "2026-08-05",
      evidence: {
        intentTopics: [{ topic: "Generative AI", score: 92, date: "2026-08-01" }, { topic: "Cloud Migration", score: 78, date: "2026-07-28" }],
        scoops: [{ type: "Funding", summary: "Announced a new growth investment.", date: "2026-08-05" }],
      },
    },
    ...overrides,
  });
}

describe("prioritize tab reads ZoomInfo insights", () => {
  it("cites the observed intent topics instead of a generic statement", () => {
    const intent = scoreAccount(withZoomInfoInsights("draftkings")).components.find((item) => item.key === "intent")!;

    expect(intent.explanation).toContain("Generative AI (92)");
    expect(intent.explanation).toContain("Cloud Migration (78)");
  });

  it("attributes the revenue component to ZoomInfo once firmographics exist", () => {
    const revenue = scoreAccount(withZoomInfoInsights("draftkings")).components.find((item) => item.key === "revenue")!;

    expect(revenue.explanation).toContain("ZoomInfo");
    expect(revenue.earned).toBe(20);
  });

  it("still labels a seeded account as demo research", () => {
    const seeded = accountSchema.parse(accounts.find((item) => item.id === "draftkings")!);
    const revenue = scoreAccount(seeded).components.find((item) => item.key === "revenue")!;

    expect(revenue.explanation).toContain("Seeded demo research");
  });

  it("dates the budget component from the observed trigger rather than demo evidence", () => {
    const budget = scoreAccount(withZoomInfoInsights("draftkings")).components.find((item) => item.key === "budget")!;

    expect(budget.explanation).toContain("2026-08-05");
    expect(budget.explanation).not.toContain("Demo evidence");
  });
});

describe("pursuit tab reads ZoomInfo insights", () => {
  it("grounds the recommendation in the topics and scoops that were observed", () => {
    const recommendation = matchOfferingMock(withZoomInfoInsights("draftkings"), offerings);

    expect(recommendation.fitRationale).toContain("Generative AI");
    expect(recommendation.suggestedLeadMessage).toContain("Generative AI");
    expect(recommendation.evidenceUsed).toContain("ZoomInfo intent: Generative AI (signal score 92, 2026-08-01)");
    expect(recommendation.evidenceUsed.some((item) => item.startsWith("ZoomInfo scoop: Funding"))).toBe(true);
    expect(recommendation.evidenceUsed.some((item) => item.startsWith("ZoomInfo firmographics:"))).toBe(true);
  });

  it("stops calling a ZoomInfo-backed recommendation demo data", () => {
    const recommendation = matchOfferingMock(withZoomInfoInsights("draftkings"), offerings);

    expect(recommendation.provenance).toBe("inferred");
    expect(recommendation.assumptions[0]).toContain("ZoomInfo verified the trigger");
    // The proof point is still synthetic and must keep saying so.
    expect(recommendation.assumptions.join(" ")).toContain("synthetic");
  });

  it("leaves a seeded account's recommendation unchanged", () => {
    const seeded = accountSchema.parse(accounts.find((item) => item.id === "draftkings")!);
    const recommendation = matchOfferingMock(seeded, offerings);

    expect(recommendation.provenance).toBe("demo");
    expect(recommendation.recommendedOffering).toBe("Rapid AI Product Studio");
    expect(recommendation.assumptions[0]).toContain("demo data");
  });

  it("lets the observed topics move the match off the plain signal-type default", () => {
    // Same "AI intent" headline, different underlying research: modernization-heavy topics
    // should favour the build offering over the experimentation one.
    const modernization = withZoomInfoInsights("draftkings", {
      signal: {
        ...withZoomInfoInsights("draftkings").signal,
        evidence: {
          intentTopics: [{ topic: "data integration workflow", score: 88, date: "2026-08-01" }, { topic: "production readiness", score: 84, date: "2026-07-30" }],
          scoops: [],
        },
      },
    });

    expect(matchOfferingMock(modernization, offerings).offeringId).toBe("assemble-core-build");
  });
});
