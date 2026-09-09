import type { Account, Buyer } from "@/lib/schemas";

export function verifiedWarmBuyer(buyers: Buyer[]): Buyer | undefined {
  return buyers.find((buyer) => buyer.warmth === "Warm" && buyer.relationshipProvenance === "verified");
}

export function hasCurrentSignal(account: Account): boolean {
  return account.signal.source.provenance === "verified" && account.signal.type !== "No current signal";
}

export function evidenceKey(account: Account): string {
  return JSON.stringify([account.signal, account.buyers, account.firmographics, account.revenueMillions, account.industry, account.enrichment?.warnings || []]);
}

// Only grounded fields reach the model; seeded warmth and company facts are excluded.
export function groundedAccount(account: Account): Account {
  const revenueSource = account.firmographics?.source ?? account.source;
  return {
    ...account,
    revenueMillions: revenueSource.provenance === "verified" ? (account.firmographics ? account.firmographics.revenueMillions ?? null : account.revenueMillions) : null,
    revenueRange: revenueSource.provenance === "verified" ? account.revenueRange : "Not verified",
    industry: account.firmographics?.industry || (account.source.provenance === "verified" ? account.industry : "Not verified"),
    buyers: account.buyers.filter((buyer) => buyer.source.provenance === "verified").map((buyer) => buyer.relationshipProvenance === "verified" ? buyer : { ...buyer, warmth: "Unknown", relationshipSource: "No verified Aberdeen relationship", relationshipProvenance: "unknown", suggestedPath: "Validate relevance before outreach." }),
  };
}
