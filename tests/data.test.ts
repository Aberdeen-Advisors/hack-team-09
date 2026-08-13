import { describe, expect, it } from "vitest";
import { accounts, offerings, uniqueCanonicalAccountCount } from "@/lib/data";
import { accountSchema, offeringRecommendationSchema } from "@/lib/schemas";
import { matchOfferingMock } from "@/lib/recommendations";
import { MockSignalProvider } from "@/lib/providers";

describe("seed data and normalization", () => {
  it("contains 20 valid queue rows and 19 canonical accounts", () => {
    expect(accounts).toHaveLength(20); expect(uniqueCanonicalAccountCount()).toBe(19);
    accounts.forEach((account) => expect(accountSchema.safeParse(account).success).toBe(true));
  });

  it("preserves the Marriott duplicate and groups it canonically", () => {
    const rows = accounts.filter((account) => account.canonicalCompanyId === "marriott-vacations");
    expect(rows).toHaveLength(2); expect(rows.some((account) => account.duplicateOf)).toBe(true);
  });

  it("deduplicates signal refreshes", async () => {
    expect(await new MockSignalProvider().refresh(accounts)).toHaveLength(19);
  });

  it("validates the grounded offering response", () => {
    const account = accounts.find((item) => item.id === "draftkings")!;
    expect(offeringRecommendationSchema.safeParse(matchOfferingMock(account, offerings)).success).toBe(true);
  });

  it("rejects unsupported response shapes", () => {
    expect(offeringRecommendationSchema.safeParse({ recommendedOffering: "Invented" }).success).toBe(false);
  });
});
