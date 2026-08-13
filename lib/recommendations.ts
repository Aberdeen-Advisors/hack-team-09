import type { Account, Offering, OfferingRecommendation, OutreachDraft, SlackAlert } from "@/lib/schemas";

export function matchOfferingMock(account: Account, offerings: Offering[]): OfferingRecommendation {
  const exact = offerings.find((offering) => offering.signalTypes.includes(account.signal.type));
  const offering = exact ?? offerings[0];
  const credential = offering.credentials[0];
  return {
    recommendedOffering: offering.name,
    offeringId: offering.id,
    fitRationale: `${offering.name} matches the ${account.signal.type.toLowerCase()} trigger and provides a pragmatic next step without assuming unverified client facts.`,
    buyerProblem: offering.businessProblems[0],
    suggestedLeadMessage: `Lead with the observed signal, validate the executive priority, and propose a focused ${offering.teamStage.toLowerCase()} conversation.`,
    supportingCredential: credential.statement,
    confidence: account.signal.source.provenance === "verified" ? 0.82 : 0.68,
    evidenceUsed: [account.signal.summary, account.industry, offering.outcome],
    assumptions: ["The signal is demo data until ZoomInfo validates it.", "Buyer names and timing require confirmation.", "The supporting proof point is synthetic and must be replaced."],
    provenance: "demo",
  };
}

const toneOpeners = {
  Direct: "I’m reaching out because",
  "Relationship-led": "I wanted to share a thought after seeing",
  Executive: "A timely question for your leadership team:",
} as const;

export function generateOutreachMock(account: Account, recommendation: OfferingRecommendation, tone: OutreachDraft["tone"]): OutreachDraft {
  const warmBuyer = account.buyers.find((buyer) => buyer.warmth === "Warm");
  const relationshipLine = tone === "Relationship-led" && warmBuyer
    ? `Our team has a seeded demo relationship path through ${warmBuyer.relationshipSource.split(":")[0]}, which may offer helpful context. `
    : "";
  const body = `${toneOpeners[tone]} ${account.name}'s ${account.signal.type.toLowerCase()} activity may create a practical window to turn AI ambition into a measurable next step. ${account.signal.whyNow}\n\n${relationshipLine}Aberdeen's ${recommendation.recommendedOffering} is designed to address ${recommendation.buyerProblem.toLowerCase()} with a focused, senior-led approach. We would begin by validating the priority, the evidence already available, and the smallest useful outcome—not by prescribing a large program.\n\nIf this is on your agenda, would a 25-minute working session next week be useful? We can compare the trigger against a simple opportunity scorecard and decide whether there is enough evidence to act.\n\nBest,\nMichael`;
  const wordCount = body.trim().split(/\s+/).length;
  return {
    subject: `${account.name}: a practical next step on ${account.signal.type.toLowerCase()}`,
    body,
    tone,
    wordCount,
    warnings: ["Demo draft - verify all company facts and recipient details.", "Synthetic proof points are intentionally omitted from the email body."],
    provenance: "demo",
  };
}

export function createSlackAlert(account: Account, score: number, recommendation: OfferingRecommendation): SlackAlert {
  return {
    account: account.name,
    signal: account.signal.summary,
    score,
    recommendedBuyer: account.buyers[0].title,
    recommendedOffering: recommendation.recommendedOffering,
    reviewUrl: `/?account=${account.id}&stage=prioritize`,
    provenance: "demo",
  };
}
