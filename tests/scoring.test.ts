import { describe, expect, it } from "vitest";
import { accounts } from "@/lib/data";
import { categoryForScore, scoreAccount } from "@/lib/scoring";

describe("ICP scoring", () => {
  it.each([[80, "Pursue now"], [79, "Research and warm"], [60, "Research and warm"], [59, "Monitor"], [40, "Monitor"], [39, "Low priority"]] as const)("maps %i to %s", (score, category) => expect(categoryForScore(score)).toBe(category));

  it("awards zero and labels unknown values", () => {
    const moove = accounts.find((account) => account.id === "moove")!;
    const result = scoreAccount(moove);
    const revenue = result.components.find((item) => item.key === "revenue")!;
    const budget = result.components.find((item) => item.key === "budget")!;
    expect(revenue.earned).toBe(0); expect(revenue.verified).toBe(false); expect(revenue.explanation).toBe("Not verified.");
    expect(budget.earned).toBe(0); expect(budget.verified).toBe(false);
  });

  it("awards zero revenue points outside the ICP band", () => {
    const meta = accounts.find((account) => account.id === "meta")!;
    expect(scoreAccount(meta).components.find((item) => item.key === "revenue")?.earned).toBe(0);
  });

  it("awards warm relationship points only when supported", () => {
    const draftKings = scoreAccount(accounts.find((account) => account.id === "draftkings")!);
    const riot = scoreAccount(accounts.find((account) => account.id === "riot-games")!);
    expect(draftKings.components.find((item) => item.key === "relationship")?.earned).toBe(10);
    expect(riot.components.find((item) => item.key === "relationship")?.earned).toBe(0);
  });
});
