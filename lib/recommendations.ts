import type { Account, Offering, OfferingRecommendation, OutreachDraft, SlackAlert } from "@/lib/schemas";

const STOPWORDS = new Set(["and", "the", "for", "with", "a", "an", "of", "to", "in", "on", "ai"]);

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function offeringText(offering: Offering): string {
  return [offering.name, offering.description, ...offering.deliverables, ...offering.businessProblems, ...offering.typicalOutcomes].join(" ");
}

// The signal type alone collapses many different triggers onto one offering. Ranking also on
// the intent topics ZoomInfo actually observed lets two accounts with the same headline type
// land on different offerings when their underlying research differs. With no live evidence
// the topic and industry terms contribute nothing, so seeded rows keep their prior match.
function rankOffering(account: Account, offering: Offering): number {
  const text = new Set(tokenize(offeringText(offering)));
  const topicHits = account.signal.evidence.intentTopics.filter((item) => tokenize(item.topic).some((word) => text.has(word))).length;
  const industryHit = offering.industries.includes(account.industry) ? 1 : 0;
  return (offering.signalTypes.includes(account.signal.type) ? 3 : 0) + topicHits + industryHit;
}

function evidenceLines(account: Account): string[] {
  const { intentTopics, scoops } = account.signal.evidence;
  return [
    ...intentTopics.slice(0, 4).map((item) => `ZoomInfo intent: ${item.topic} (signal score ${item.score}, ${item.date})`),
    ...scoops.slice(0, 4).map((item) => `ZoomInfo scoop: ${item.type} — ${item.summary} (${item.date})`),
  ];
}

export function matchOfferingMock(account: Account, offerings: Offering[]): OfferingRecommendation {
  // Stable sort keeps catalog order as the tiebreak, so an account with no evidence resolves
  // to the same offering the plain signal-type match used to produce.
  const offering = [...offerings].sort((a, b) => rankOffering(account, b) - rankOffering(account, a))[0];
  const credential = offering.credentials[0];
  const live = account.signal.source.provenance === "verified";
  const { intentTopics, scoops } = account.signal.evidence;
  const topics = intentTopics.slice(0, 3).map((item) => item.topic);
  const evidence = evidenceLines(account);
  const firmographicLine = account.firmographics
    ? `ZoomInfo firmographics: ${[account.revenueRange, account.firmographics.employeeCount ? `${account.firmographics.employeeCount.toLocaleString()} employees` : undefined, account.firmographics.hqLocation].filter(Boolean).join(" · ")}`
    : undefined;

  const fitRationale = topics.length
    ? `${offering.name} lines up with the research ZoomInfo observed at ${account.name} (${topics.join(", ")}) and gives that activity a pragmatic next step without assuming unverified client facts.`
    : `${offering.name} matches the ${account.signal.type.toLowerCase()} trigger and provides a pragmatic next step without assuming unverified client facts.`;

  const suggestedLeadMessage = topics.length
    ? `Open on the ${topics[0]} research ZoomInfo picked up, confirm whether it reflects a funded executive priority, and propose a focused ${offering.teamStage.toLowerCase()} conversation.`
    : scoops.length
      ? `Open on the recent ${scoops[0].type.toLowerCase()} activity, confirm the executive priority behind it, and propose a focused ${offering.teamStage.toLowerCase()} conversation.`
      : `Lead with the observed signal, validate the executive priority, and propose a focused ${offering.teamStage.toLowerCase()} conversation.`;

  return {
    recommendedOffering: offering.name,
    offeringId: offering.id,
    fitRationale,
    buyerProblem: offering.businessProblems[0],
    suggestedLeadMessage,
    supportingCredential: credential.statement,
    // Confidence rises with how much corroborating evidence the refresh actually returned
    // rather than being a fixed pair of constants.
    confidence: Math.min(0.92, (live ? 0.72 : 0.6) + Math.min(evidence.length, 4) * 0.05),
    // Deduplicated because the workspace keys the evidence list by its text; two scoops
    // sharing a summary would otherwise collide.
    evidenceUsed: [...new Set([...evidence, firmographicLine, evidence.length ? undefined : account.signal.summary, account.industry, offering.outcome].filter((item): item is string => Boolean(item)))],
    assumptions: [
      live ? "ZoomInfo verified the trigger; budget, ownership, and timing are still unconfirmed." : "The signal is demo data until ZoomInfo validates it.",
      account.buyers.some((buyer) => buyer.source.provenance === "verified") ? "Buyer identities come from ZoomInfo recommendations; their involvement in this initiative is unconfirmed." : "Buyer names and timing require confirmation.",
      "The supporting proof point is synthetic and must be replaced.",
    ],
    // Rule-derived from verified inputs is an inference, not a verified recommendation.
    provenance: live ? "inferred" : "demo",
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
    recommendedBuyer: account.buyers[0] ? (account.buyers[0].source.provenance === "verified" ? `${account.buyers[0].name} — ${account.buyers[0].title}` : account.buyers[0].title) : "Buyer research required",
    recommendedOffering: recommendation.recommendedOffering,
    reviewUrl: `/?account=${account.id}&stage=prioritize`,
    provenance: "demo",
  };
}
