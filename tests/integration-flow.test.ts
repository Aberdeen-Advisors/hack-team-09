import { afterEach, describe, expect, it } from "vitest";
import { accounts, offerings } from "@/lib/data";
import { refreshCandidates } from "@/lib/zoominfo-mcp";
import { mergeBuyers } from "@/lib/session-store";
import { scoreAccount } from "@/lib/scoring";
import { groundedAccount, evidenceKey } from "@/lib/evidence";
import { createSlackAlert, generateOutreachTemplate, matchOffering } from "@/lib/recommendations";
import { liveAccount } from "./fixtures";

const previousLimit = process.env.ZOOMINFO_REFRESH_ACCOUNT_LIMIT;
afterEach(() => { if (previousLimit === undefined) delete process.env.ZOOMINFO_REFRESH_ACCOUNT_LIMIT; else process.env.ZOOMINFO_REFRESH_ACCOUNT_LIMIT = previousLimit; });

describe("research queue coverage", () => {
  it("reaches all canonical accounts across four batches, including failed attempts", () => {
    process.env.ZOOMINFO_REFRESH_ACCOUNT_LIMIT = "5";
    let items = structuredClone(accounts);
    const visited: string[] = [];
    for (let batch = 0; batch < 4; batch++) {
      const candidates = refreshCandidates(items);
      const fresh = candidates.filter((item) => !visited.includes(item.canonicalCompanyId));
      expect(fresh.length).toBe(batch === 3 ? 4 : 5);
      visited.push(...fresh.map((item) => item.canonicalCompanyId));
      const ids = new Set(candidates.map((item) => item.canonicalCompanyId));
      items = items.map((item) => ids.has(item.canonicalCompanyId) ? { ...item, enrichment: { lastAttemptedAt: `2026-09-08T12:0${batch}:00Z`, error: "Lookup failed", warnings: [] } } : item);
    }
    expect(new Set(visited).size).toBe(19);
  });
  it("targets the canonical company when a duplicate row is selected", () => {
    expect(refreshCandidates(accounts, "marriott-vacations-corp").map((item) => item.id)).toEqual(["marriott-vacations"]);
    expect(() => refreshCandidates(accounts, "missing")).toThrow("Account not found");
  });
  it("chooses untouched accounts ahead of cached live records", () => {
    const live = liveAccount();
    expect(refreshCandidates([live, accounts[0]])[0].id).toBe(accounts[0].id);
  });
});

describe("evidence boundaries", () => {
  it("awards no points to any seeded scenario", () => {
    expect(accounts.map((account) => scoreAccount(account).total).every((score) => score === 0)).toBe(true);
  });
  it("awards relationship points only for independently verified relationship evidence", () => {
    const account = liveAccount();
    account.buyers[0].warmth = "Warm";
    expect(scoreAccount(account).components.find((item) => item.key === "relationship")?.earned).toBe(0);
    account.buyers[0].relationshipProvenance = "verified";
    expect(scoreAccount(account).components.find((item) => item.key === "relationship")?.earned).toBe(10);
  });
  it("clears contacts on an empty success but retains observed contacts on failure", () => {
    const account = liveAccount();
    account.buyers.push(...accounts[0].buyers);
    expect(mergeBuyers(account, [])).toEqual([]);
    expect(mergeBuyers(account, [], true).map((buyer) => buyer.name)).toEqual(["Jordan Example"]);
  });
  it("keeps an internally verified relationship by provider identity", () => {
    const account = liveAccount();
    account.buyers[0].warmth = "Warm";
    account.buyers[0].relationshipProvenance = "verified";
    const incoming = liveAccount().buyers[0];
    incoming.name = "Jordan Newname";
    const merged = mergeBuyers(account, [incoming]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Jordan Newname");
    expect(merged[0].warmth).toBe("Warm");
  });
  it("never replaces missing live revenue with seed revenue in model input", () => {
    const account = liveAccount();
    account.firmographics!.revenueMillions = null;
    expect(groundedAccount(account).revenueMillions).toBeNull();
    expect(scoreAccount(account).components.find((item) => item.key === "revenue")?.earned).toBe(0);
  });
});

describe("grounded recommendations and outreach", () => {
  it("uses observed events and a verified recipient without synthetic claims", () => {
    const account = liveAccount();
    const recommendation = matchOffering(account, offerings);
    const draft = generateOutreachTemplate(account, recommendation, "Direct");
    expect(draft.body).toContain("2026-09-01");
    expect(draft.body).toContain("Announced a new growth investment");
    expect(draft.body).toContain("Jordan Example");
    expect(draft.body).not.toContain("demo");
    expect(draft.provenance).toBe("inferred");
    expect(draft.generationMethod).toBe("template");
    expect(draft.evidenceKey).toBe(evidenceKey(account));
    expect(recommendation.supportingCredential).not.toContain("Demo proof point");
    expect(createSlackAlert(account, 55, recommendation).provenance).toBe("inferred");
  });
  it("does not infer an initiative from an empty verified signal result", () => {
    const account = liveAccount();
    account.signal.type = "No current signal";
    account.signal.evidence = { intentTopics: [], scoops: [] };
    const recommendation = matchOffering(account, offerings);
    expect(recommendation.confidence).toBe(0);
    expect(recommendation.recommendedOffering).toBe("Research required");
    expect(generateOutreachTemplate(account, recommendation, "Direct").body).toBe("");
  });
  it("treats intent as a topic to validate, never personal research or confirmed budget", () => {
    const account = liveAccount();
    account.signal.evidence.scoops = [];
    const draft = generateOutreachTemplate(account, matchOffering(account, offerings), "Direct");
    expect(draft.body).toContain("Is Generative AI a current priority");
    expect(draft.body).not.toContain("ZoomInfo");
  });
});
