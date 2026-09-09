import { evidenceKey, groundedAccount, hasCurrentSignal, verifiedWarmBuyer } from "@/lib/evidence";
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

export function matchOffering(account: Account, offerings: Offering[]): OfferingRecommendation {
  account = groundedAccount(account);
  // Stable sort keeps catalog order as the tiebreak, so an account with no evidence resolves
  // to the same offering the plain signal-type match used to produce.
  const offering = [...offerings].sort((a, b) => rankOffering(account, b) - rankOffering(account, a))[0];
  const credential = offering.credentials.find((item) => item.provenance === "verified" && !item.replacementRequired);
  const live = account.signal.source.provenance === "verified";
  if (!hasCurrentSignal(account)) return {
    recommendedOffering: "Research required", offeringId: "", buyerProblem: "Confirm a current business priority before recommending an offering.",
    fitRationale: live ? "No qualifying current trigger supports an offering recommendation." : "Refresh this account to establish a current signal before matching an offering.",
    suggestedLeadMessage: "Keep this account in research until there is a supported reason to engage.",
    supportingCredential: "No approved proof point selected.", confidence: 0,
    evidenceUsed: live ? [account.signal.summary] : [],
    assumptions: ["Budget, ownership, and timing are unconfirmed.", "A current signal is required before drafting outreach."],
    provenance: live ? "inferred" : "unknown",
  };
  const { intentTopics, scoops } = account.signal.evidence;
  const topics = intentTopics.slice(0, 3).map((item) => item.topic);
  const evidence = evidenceLines(account);
  const firmographicLine = account.firmographics?.source.provenance === "verified"
    ? `ZoomInfo firmographics: ${[account.firmographics.revenueMillions != null ? account.revenueRange : undefined, account.firmographics.employeeCount ? `${account.firmographics.employeeCount.toLocaleString()} employees` : undefined, account.firmographics.hqLocation].filter(Boolean).join(" · ")}`
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
    supportingCredential: credential?.statement || "No approved Aberdeen proof point is available for this offering.",
    // Confidence rises with how much corroborating evidence the refresh actually returned
    // rather than being a fixed pair of constants.
    confidence: Math.min(0.92, (live ? 0.72 : 0.6) + Math.min(evidence.length, 4) * 0.05),
    // Deduplicated because the workspace keys the evidence list by its text; two scoops
    // sharing a summary would otherwise collide.
    evidenceUsed: [...new Set([...evidence, firmographicLine, evidence.length ? undefined : account.signal.summary, account.industry, offering.outcome].filter((item): item is string => Boolean(item)))],
    assumptions: [
      live ? "ZoomInfo observed the trigger; budget, ownership, and timing are still unconfirmed." : "The signal is demo data until ZoomInfo validates it.",
      account.buyers.some((buyer) => buyer.source.provenance === "verified") ? "Buyer identities come from ZoomInfo recommendations; their involvement in this initiative is unconfirmed." : "Buyer names and timing require confirmation.",
      credential ? "The supporting credential is approved." : "No approved proof point is available; synthetic credentials are excluded.",
    ],
    // Rule-derived from verified inputs is an inference, not a verified recommendation.
    provenance: live ? "inferred" : "demo",
  };
}

export function generateOutreachTemplate(account: Account, recommendation: OfferingRecommendation, tone: OutreachDraft["tone"]): OutreachDraft {
  const live = hasCurrentSignal(account);
  const metadata = { generationMethod: "template" as const, evidenceKey: evidenceKey(account), recipientId: account.buyers.find((item) => item.source.provenance === "verified")?.id ?? null };
  if (!live) return {
    ...metadata, subject: "Research required", body: "", tone, wordCount: 0,
    warnings: ["A current observed signal is required before drafting outreach."],
    provenance: account.signal.source.provenance === "demo" ? "demo" : "unknown",
  };
  const buyer = account.buyers.find((item) => item.source.provenance === "verified");
  const scoop = account.signal.evidence.scoops[0];
  const topic = account.signal.evidence.intentTopics[0];
  const clip = (value: string, words: number) => value.split(/\s+/).slice(0, words).join(" ");
  // Keep intent observations internal: they suggest a topic to validate, not proof of
  // a funded project or something the recipient personally researched.
  const hook = scoop
    ? `I saw the ${scoop.date} update about ${account.name}: ${clip(scoop.summary, 24).replace(/[.!?]+$/, "")}. Is this creating new priorities for your team?`
    : `Is ${clip(topic?.topic || account.signal.type, 12)} a current priority at ${account.name}? I wanted to ask rather than assume the timing or scope of any initiative.`;
  const warm = verifiedWarmBuyer(account.buyers);
  const relationship = tone === "Relationship-led" && warm ? "We have an existing connection through our teams and would welcome your perspective. " : "";
  const opener = tone === "Executive" ? "A question about your priorities: " : "";
  const body = `${buyer ? `Hello ${buyer.name},` : "Hello,"}\n\n${opener}${hook}\n\n${relationship}Aberdeen's ${recommendation.recommendedOffering} could offer a focused way to explore ${recommendation.buyerProblem.toLowerCase()}. We would start by understanding the business outcome, the evidence already available, and the constraints your team is working within. The aim would be to identify one practical next step before considering a broader engagement.\n\n${buyer ? `Given your role as ${clip(buyer.title, 8)}, would` : "Would"} a 25-minute conversation next week be useful to compare priorities and see whether there is a fit? If someone else owns this area, I would appreciate being pointed in the right direction.\n\nBest,\nMichael`;
  return { ...metadata, subject: `${account.name}: ${clip(topic?.topic || account.signal.type, 8)} priorities`, body, tone,
    wordCount: body.trim().split(/\s+/).length,
    warnings: ["Please verify recipient details and review the supporting evidence before sending.", ...(!buyer ? ["No verified recipient selected; buyer research is required."] : []), ...(account.enrichment?.warnings || [])], provenance: "inferred" };
}

// Compatibility exports for existing integrations; these are evidence-based rules/templates.
export const matchOfferingMock = matchOffering;
export const generateOutreachMock = generateOutreachTemplate;

export function createSlackAlert(account: Account, score: number, recommendation: OfferingRecommendation): SlackAlert {
  const buyer = account.buyers.find((item) => item.source.provenance === "verified");
  return {
    account: account.name,
    signal: account.signal.source.provenance === "verified" ? account.signal.summary : "Signal research required",
    score,
    recommendedBuyer: buyer ? `${buyer.name} / ${buyer.title}` : "Buyer research required",
    recommendedOffering: recommendation.recommendedOffering,
    reviewUrl: `/?account=${account.id}&stage=prioritize`,
    provenance: account.signal.source.provenance === "verified" ? "inferred" : "unknown",
  };
}
