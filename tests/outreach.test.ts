import { describe, expect, it } from "vitest";
import { accounts, offerings } from "@/lib/data";
import { generateOutreachMock, matchOfferingMock } from "@/lib/recommendations";

describe("outreach", () => {
  it.each(["Direct", "Relationship-led", "Executive"] as const)("creates a constrained %s draft", (tone) => {
    const account = accounts.find((item) => item.id === "draftkings")!;
    const draft = generateOutreachMock(account, matchOfferingMock(account, offerings), tone);
    expect(draft.tone).toBe(tone); expect(draft.wordCount).toBeGreaterThanOrEqual(100); expect(draft.wordCount).toBeLessThanOrEqual(160);
    expect(draft.body).not.toContain("Demo proof point"); expect(draft.warnings.join(" ")).toContain("verify");
  });
});
