import type { Account, ScoreComponent, ScoreResult } from "@/lib/schemas";
import { ICP_SCORING, SCORE_CATEGORIES } from "@/lib/scoring-config";

function booleanComponent(
  key: string,
  label: string,
  possible: number,
  value: boolean | null,
  yesExplanation: string,
): ScoreComponent {
  if (value === null) {
    return { key, label, possible, earned: 0, verified: false, explanation: "Not verified." };
  }
  return {
    key,
    label,
    possible,
    earned: value ? possible : 0,
    verified: true,
    explanation: value ? yesExplanation : "Evidence does not currently support this criterion.",
  };
}

export function categoryForScore(score: number): ScoreResult["category"] {
  return SCORE_CATEGORIES.find((item) => score >= item.min)!.category;
}

export function scoreAccount(account: Account): ScoreResult {
  const revenue = account.revenueMillions;
  const revenueVerified = revenue !== null;
  const revenueInRange = revenueVerified && revenue >= ICP_SCORING.revenue.minMillions && revenue <= ICP_SCORING.revenue.maxMillions;
  const warm = account.buyers.some((buyer) => buyer.warmth === "Warm");
  const relationshipVerified = account.buyers.some((buyer) => buyer.warmth !== "Unknown");
  // Every explanation names its own source, so a reviewer can tell a live ZoomInfo
  // observation apart from seeded demo research without leaving the score card.
  const live = account.signal.source.provenance === "verified";
  const { intentTopics, scoops } = account.signal.evidence;
  const revenueSource = account.firmographics?.revenueMillions != null ? "ZoomInfo" : "Seeded demo research";
  const topTopics = intentTopics.slice(0, 3).map((item) => `${item.topic} (${item.score})`).join(", ");
  const scoopTypes = [...new Set(scoops.map((item) => item.type))].slice(0, 3).join(", ");

  const components: ScoreComponent[] = [
    {
      key: "revenue",
      label: ICP_SCORING.revenue.label,
      possible: ICP_SCORING.revenue.points,
      earned: revenueInRange ? ICP_SCORING.revenue.points : 0,
      verified: revenueVerified,
      explanation: !revenueVerified
        ? "Not verified."
        : revenueInRange
          ? `${revenueSource}: ${account.revenueRange} is within the Aberdeen ICP band.`
          : `${revenueSource}: ${account.revenueRange} is outside the $50M-$5B ICP band.`,
    },
    booleanComponent("transformation", ICP_SCORING.transformation.label, ICP_SCORING.transformation.points, account.signal.transformationEvidence, scoopTypes ? `ZoomInfo scoops indicate a transformation initiative (${scoopTypes}).` : "The active signal indicates a transformation initiative."),
    booleanComponent("mergerAcquisition", ICP_SCORING.mergerAcquisition.label, ICP_SCORING.mergerAcquisition.points, account.signal.mergerOrAcquisition, "The signal includes current M&A activity."),
    booleanComponent("intent", ICP_SCORING.intent.label, ICP_SCORING.intent.points, account.signal.relevantIntent, topTopics ? `ZoomInfo intent topics scoring above threshold: ${topTopics}.` : "A relevant buying signal is present."),
    booleanComponent("budget", ICP_SCORING.budget.label, ICP_SCORING.budget.points, account.signal.activeWithin90Days, live ? `ZoomInfo observed the trigger on ${account.signal.date}, inside the lookback window.` : "Demo evidence indicates an active initiative inside 90 days."),
    {
      key: "relationship",
      label: ICP_SCORING.relationship.label,
      possible: ICP_SCORING.relationship.points,
      earned: warm ? ICP_SCORING.relationship.points : 0,
      verified: relationshipVerified,
      explanation: !relationshipVerified
        ? "Not verified. ZoomInfo names contacts but holds no Aberdeen relationship history."
        : warm ? "Seeded relationship data includes a warm Aberdeen path." : "No warm relationship is supported by current data.",
    },
  ];

  const total = components.reduce((sum, item) => sum + item.earned, 0);
  const band = SCORE_CATEGORIES.find((item) => total >= item.min)!;
  const verifiedWins = components.filter((item) => item.earned > 0).map((item) => item.label.toLowerCase());
  const missing = components.filter((item) => !item.verified).length;

  return {
    accountId: account.id,
    total,
    category: band.category,
    recommendedAction: band.action,
    explanation: `${verifiedWins.length ? `Fit is driven by ${verifiedWins.slice(0, 3).join(", ")}.` : "No positive criteria are currently verified."}${missing ? ` ${missing} component${missing === 1 ? " is" : "s are"} not verified.` : ""}`,
    components,
  };
}
