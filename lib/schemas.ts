import { z } from "zod";

export const provenanceSchema = z.enum(["verified", "inferred", "demo", "unknown"]);
export type DataProvenance = z.infer<typeof provenanceSchema>;

export const sourceReferenceSchema = z.object({
  label: z.string(),
  url: z.string().url().optional(),
  observedAt: z.string(),
  provenance: provenanceSchema,
});
export type SourceReference = z.infer<typeof sourceReferenceSchema>;

export const relationshipWarmthSchema = z.enum(["Warm", "Indirect", "No known relationship", "Unknown"]);
export type RelationshipWarmth = z.infer<typeof relationshipWarmthSchema>;

export const signalSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  type: z.enum(["AI intent", "Executive hire", "M&A", "Transformation", "Technology modernization", "Funding", "No current signal"]),
  summary: z.string(),
  whyNow: z.string(),
  source: sourceReferenceSchema,
  date: z.string(),
  relevantIntent: z.boolean().nullable(),
  activeWithin90Days: z.boolean().nullable(),
  transformationEvidence: z.boolean().nullable(),
  mergerOrAcquisition: z.boolean().nullable(),
});
export type Signal = z.infer<typeof signalSchema>;

export const buyerSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  decisionRole: z.string(),
  decisionRoleProvenance: provenanceSchema.optional(),
  warmth: relationshipWarmthSchema,
  relationshipSource: z.string(),
  relationshipProvenance: provenanceSchema.optional(),
  suggestedPath: z.string(),
  source: sourceReferenceSchema,
});
export type Buyer = z.infer<typeof buyerSchema>;

export const accountSchema = z.object({
  id: z.string(),
  canonicalCompanyId: z.string(),
  name: z.string(),
  legalName: z.string(),
  industry: z.string(),
  revenueMillions: z.number().nullable(),
  revenueRange: z.string(),
  website: z.string().url(),
  source: sourceReferenceSchema,
  signal: signalSchema,
  buyers: z.array(buyerSchema),
  providerIds: z.object({ zoominfoCompanyId: z.string().optional() }).optional(),
  duplicateOf: z.string().optional(),
});
export type Account = z.infer<typeof accountSchema>;

export const fourECategorySchema = z.enum([
  "Enterprise Endgame",
  "Execute with Confidence",
  "Expedite Modernization",
  "Emphasize Growth",
]);
export type FourECategory = z.infer<typeof fourECategorySchema>;

export const teamStageSchema = z.enum(["Target", "Experiment", "Assemble", "Mobilize"]);
export type TeamStage = z.infer<typeof teamStageSchema>;

export const credentialSchema = z.object({
  id: z.string(),
  statement: z.string(),
  provenance: provenanceSchema,
  replacementRequired: z.boolean(),
});
export type Credential = z.infer<typeof credentialSchema>;

export const offeringSchema = z.object({
  id: z.string(),
  name: z.string(),
  teamStage: teamStageSchema,
  fourECategories: z.array(fourECategorySchema),
  description: z.string(),
  deliverables: z.array(z.string()),
  outcome: z.string(),
  buyerPersonas: z.array(z.string()),
  signalTypes: z.array(signalSchema.shape.type),
  industries: z.array(z.string()),
  businessProblems: z.array(z.string()),
  typicalOutcomes: z.array(z.string()),
  credentials: z.array(credentialSchema),
});
export type Offering = z.infer<typeof offeringSchema>;

export const scoreComponentSchema = z.object({
  key: z.string(),
  label: z.string(),
  earned: z.number(),
  possible: z.number(),
  verified: z.boolean(),
  explanation: z.string(),
});
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;

export const scoreResultSchema = z.object({
  accountId: z.string(),
  total: z.number().min(0).max(100),
  category: z.enum(["Pursue now", "Research and warm", "Monitor", "Low priority"]),
  recommendedAction: z.string(),
  explanation: z.string(),
  components: z.array(scoreComponentSchema),
});
export type ScoreResult = z.infer<typeof scoreResultSchema>;

export const offeringRecommendationSchema = z.object({
  recommendedOffering: z.string(),
  offeringId: z.string(),
  fitRationale: z.string(),
  buyerProblem: z.string(),
  suggestedLeadMessage: z.string(),
  supportingCredential: z.string(),
  confidence: z.number().min(0).max(1),
  evidenceUsed: z.array(z.string()),
  assumptions: z.array(z.string()),
  provenance: provenanceSchema,
});
export type OfferingRecommendation = z.infer<typeof offeringRecommendationSchema>;

export const outreachDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  tone: z.enum(["Direct", "Relationship-led", "Executive"]),
  wordCount: z.number(),
  warnings: z.array(z.string()),
  provenance: provenanceSchema,
});
export type OutreachDraft = z.infer<typeof outreachDraftSchema>;

export const slackAlertSchema = z.object({
  account: z.string(),
  signal: z.string(),
  score: z.number(),
  recommendedBuyer: z.string(),
  recommendedOffering: z.string(),
  reviewUrl: z.string(),
  provenance: provenanceSchema,
});
export type SlackAlert = z.infer<typeof slackAlertSchema>;

export const providerDiagnosticSchema = z.object({
  provider: z.enum(["ZoomInfo", "OpenAI", "Slack"]),
  mode: z.enum(["live", "mock", "fallback"]),
  configured: z.boolean(),
  status: z.enum(["ready", "not-configured", "error"]),
  message: z.string(),
  checkedAt: z.string(),
});
export type ProviderDiagnostic = z.infer<typeof providerDiagnosticSchema>;

export const integrationStatusSchema = z.object({
  demoMode: z.boolean(),
  admin: z.object({ authenticated: z.boolean(), configured: z.boolean() }),
  diagnostics: z.array(providerDiagnosticSchema),
  zoomInfo: z.object({
    state: z.enum(["disabled", "mock", "disconnected", "authorizing", "ready", "error"]),
    requiredToolsReady: z.boolean(),
    liveAccounts: z.number().int().nonnegative(),
    totalCanonicalAccounts: z.number().int().nonnegative(),
    lastSuccessfulRefreshAt: z.string().optional(),
    cacheExpiresAt: z.string().optional(),
    error: z.string().optional(),
  }).optional(),
});
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const workspaceStageSchema = z.enum(["prioritize", "pursuit", "outreach"]);
export type WorkspaceStage = z.infer<typeof workspaceStageSchema>;

export const accountDetailSchema = z.object({
  account: accountSchema,
  score: scoreResultSchema,
  recommendation: offeringRecommendationSchema,
  outreach: outreachDraftSchema,
  slack: slackAlertSchema,
});
export type AccountDetail = z.infer<typeof accountDetailSchema>;
