import type { Account, Buyer, Offering, Signal } from "@/lib/schemas";

const OBSERVED_AT = "2026-08-13";

const companyDefinitions = [
  ["t-mobile", "T-Mobile", "T-Mobile US, Inc.", "Telecommunications", 80000, "$50B+", "https://www.t-mobile.com/"],
  ["moove", "Moove", "Moove Africa B.V.", "Mobility fintech", null, "Not verified", "https://www.moove.io/"],
  ["marriott-vacations", "Marriott Vacations Worldwide", "Marriott Vacations Worldwide Corporation", "Hospitality", 4800, "$1B-$5B", "https://www.marriottvacationsworldwide.com/"],
  ["inspire", "Inspire", "Inspire Brands, Inc.", "Restaurants", null, "Not verified", "https://inspirebrands.com/"],
  ["riot-games", "Riot Games", "Riot Games, Inc.", "Gaming", null, "Not verified", "https://www.riotgames.com/"],
  ["marriott-international", "Marriott International", "Marriott International, Inc.", "Hospitality", 25000, "$20B+", "https://www.marriott.com/"],
  ["marriott-vacations-corp", "Marriott Vacations Worldwide Corporation", "Marriott Vacations Worldwide Corporation", "Hospitality", 4800, "$1B-$5B", "https://www.marriottvacationsworldwide.com/"],
  ["procter-gamble", "Procter & Gamble", "The Procter & Gamble Company", "Consumer packaged goods", 84000, "$50B+", "https://us.pg.com/"],
  ["astrazeneca", "AstraZeneca", "AstraZeneca PLC", "Healthcare", 54000, "$50B+", "https://www.astrazeneca.com/"],
  ["geico", "GEICO", "Government Employees Insurance Company", "Insurance", 43000, "$20B+", "https://www.geico.com/"],
  ["lockheed-martin", "Lockheed Martin", "Lockheed Martin Corporation", "Aerospace & defense", 71000, "$50B+", "https://www.lockheedmartin.com/"],
  ["patterson-uti", "Patterson-UTI", "Patterson-UTI Energy, Inc.", "Energy services", 5400, "$5B-$10B", "https://patenergy.com/"],
  ["bird", "Bird", "Bird CRM, Inc.", "Communications software", null, "Not verified", "https://bird.com/"],
  ["salesforce", "Salesforce", "Salesforce, Inc.", "Technology", 37000, "$20B+", "https://www.salesforce.com/"],
  ["mastercard", "Mastercard", "Mastercard Incorporated", "Financial services", 28000, "$20B+", "https://www.mastercard.com/"],
  ["ford-pro", "Ford Pro", "Ford Motor Company - Ford Pro", "Automotive", null, "Business-unit revenue not verified", "https://www.fordpro.com/"],
  ["meta", "Meta", "Meta Platforms, Inc.", "Technology", 164000, "$100B+", "https://about.meta.com/"],
  ["draftkings", "DraftKings", "DraftKings Inc.", "Gaming & entertainment", 4800, "$1B-$5B", "https://www.draftkings.com/about/"],
  ["controlyne", "Controlyne of New England", "Controlyne of New England", "Building controls", null, "Not verified", "https://www.linkedin.com/company/controlyne-of-new-england/"],
  ["merkle", "Merkle", "Merkle, Inc.", "Business services", null, "Subsidiary revenue not verified", "https://www.merkle.com/"],
] as const;

const scenarioByAccount: Record<string, Partial<Signal> & { type: Signal["type"]; summary: string; whyNow: string }> = {
  "draftkings": { type: "AI intent", summary: "Demo intent spike around AI product experimentation and responsible personalization.", whyNow: "A focused proof-of-value can turn a priority use case into evidence before a broader build.", relevantIntent: true, activeWithin90Days: true, transformationEvidence: true, mergerOrAcquisition: null },
  "marriott-vacations": { type: "Technology modernization", summary: "Demo modernization signal tied to digital owner and guest experiences.", whyNow: "A sequenced AI roadmap could connect service improvements to measurable adoption and value.", relevantIntent: true, activeWithin90Days: true, transformationEvidence: true, mergerOrAcquisition: true },
  "marriott-vacations-corp": { type: "Technology modernization", summary: "Duplicate-row view of the same demo modernization signal.", whyNow: "This row shares a canonical company and signal with Marriott Vacations Worldwide.", relevantIntent: true, activeWithin90Days: true, transformationEvidence: true, mergerOrAcquisition: true },
  "t-mobile": { type: "AI intent", summary: "Demo intent signal around AI-enabled customer and network operations.", whyNow: "The trigger suggests an opportunity to prioritize measurable use cases while managing adoption risk.", relevantIntent: true, activeWithin90Days: null, transformationEvidence: true, mergerOrAcquisition: false },
  "moove": { type: "Funding", summary: "Demo growth signal for AI-enabled mobility operations.", whyNow: "Rapid growth can create a need for prioritized use cases and a scalable operating model.", relevantIntent: true, activeWithin90Days: null, transformationEvidence: true, mergerOrAcquisition: null },
  "inspire": { type: "Transformation", summary: "Demo signal around enterprise AI adoption across shared restaurant capabilities.", whyNow: "Shared platforms create leverage, but adoption needs role-based enablement and governance.", relevantIntent: true, activeWithin90Days: true, transformationEvidence: true, mergerOrAcquisition: false },
  "riot-games": { type: "AI intent", summary: "Demo AI product signal spanning player and developer experiences.", whyNow: "A rapid product studio can validate value and adoption fit before scale.", relevantIntent: true, activeWithin90Days: true, transformationEvidence: true, mergerOrAcquisition: false },
};

function signalFor(id: string): Signal {
  const custom = scenarioByAccount[id];
  const defaults = {
    type: "Transformation" as const,
    summary: "Demo transformation signal requiring confirmation from a licensed signal provider.",
    whyNow: "The account may benefit from a focused discovery conversation, but timing and budget remain unverified.",
    relevantIntent: true,
    activeWithin90Days: null,
    transformationEvidence: true,
    mergerOrAcquisition: null,
  };
  const value = { ...defaults, ...custom };
  return {
    id: `signal-${id}`,
    accountId: id,
    type: value.type,
    summary: value.summary,
    whyNow: value.whyNow,
    source: { label: "Synthetic hackathon signal", observedAt: OBSERVED_AT, provenance: "demo" },
    date: "2026-08-12",
    relevantIntent: value.relevantIntent ?? null,
    activeWithin90Days: value.activeWithin90Days ?? null,
    transformationEvidence: value.transformationEvidence ?? null,
    mergerOrAcquisition: value.mergerOrAcquisition ?? null,
  };
}

const warmAccounts: Record<string, [string, string]> = {
  "draftkings": ["Michael", "Prior working relationship (demo)"],
  "marriott-vacations": ["Adam", "Introduced through a mutual contact (demo)"],
  "t-mobile": ["Ankit", "Prior technology-network connection (demo)"],
};

function buyersFor(id: string): Buyer[] {
  const warm = warmAccounts[id];
  const roles = [
    ["Chief Information Officer", "Economic buyer and transformation sponsor"],
    ["Chief Technology Officer", "Technical decision-maker and delivery sponsor"],
    ["Chief Financial Officer", "Economic buyer and value-case challenger"],
  ] as const;
  return roles.map(([title, decisionRole], index) => ({
    id: `${id}-buyer-${index + 1}`,
    name: `${title} - research required`,
    title,
    decisionRole,
    warmth: index === 0 && warm ? "Warm" : index === 1 && warm ? "Indirect" : "Unknown",
    relationshipSource: index < 2 && warm ? `${warm[0]}: ${warm[1]}` : "No seeded relationship evidence",
    suggestedPath: index === 0 && warm ? `Ask ${warm[0]} for a context-first introduction.` : "Validate the role and identify a credible shared context before outreach.",
    source: { label: index < 2 && warm ? "Seeded relationship data" : "Role hypothesis from Aberdeen ICP", observedAt: OBSERVED_AT, provenance: index < 2 && warm ? "demo" : "inferred" },
  }));
}

export const accounts: Account[] = companyDefinitions.map(([id, name, legalName, industry, revenueMillions, revenueRange, website]) => ({
  id,
  canonicalCompanyId: id === "marriott-vacations-corp" ? "marriott-vacations" : id,
  name,
  legalName,
  industry,
  revenueMillions,
  revenueRange,
  website,
  source: { label: "Official company website; financial fields are demo research", url: website, observedAt: OBSERVED_AT, provenance: revenueMillions === null ? "unknown" : "demo" },
  signal: signalFor(id),
  buyers: buyersFor(id),
  duplicateOf: id === "marriott-vacations-corp" ? "marriott-vacations" : undefined,
}));

export const offerings: Offering[] = [
  {
    id: "target-readiness",
    name: "AI Strategy & Readiness",
    teamStage: "Target",
    fourECategories: ["Enterprise Endgame"],
    description: "Identify where AI can create measurable value and assess whether the organization is ready to execute.",
    deliverables: ["Readiness scorecard", "Use-case prioritization", "12-24-month roadmap"],
    outcome: "A funded, sequenced AI strategy with pilot-ready initiatives.",
    buyerPersonas: ["CIO", "CTO", "CFO", "Head of Strategy"],
    signalTypes: ["Transformation", "Executive hire", "M&A"],
    industries: ["All"],
    businessProblems: ["Unclear AI priorities", "Strategy-to-execution gap", "Readiness risk"],
    typicalOutcomes: ["Prioritized portfolio", "Investment roadmap", "Executive alignment"],
    credentials: [{ id: "demo-target", statement: "Demo proof point: strategy-to-roadmap engagement; replace with an approved Aberdeen credential.", provenance: "demo", replacementRequired: true }],
  },
  {
    id: "experiment-studio",
    name: "Rapid AI Product Studio",
    teamStage: "Experiment",
    fourECategories: ["Enterprise Endgame", "Expedite Modernization"],
    description: "Turn priority use cases into working concepts users can see, test, and refine before scale.",
    deliverables: ["Persona & journey analysis", "Opportunity scorecard", "Interactive prototype / MVP"],
    outcome: "A validated product direction with evidence of value and adoption fit.",
    buyerPersonas: ["CIO", "CTO", "Product leader"],
    signalTypes: ["AI intent", "Funding"],
    industries: ["Technology", "Gaming", "Financial services", "Retail"],
    businessProblems: ["Unproven AI use cases", "Slow experimentation", "Adoption uncertainty"],
    typicalOutcomes: ["Validated direction", "Working prototype", "Evidence-based investment decision"],
    credentials: [{ id: "demo-experiment", statement: "Demo proof point: accelerated proof-of-value sprint; replace with an approved Aberdeen credential.", provenance: "demo", replacementRequired: true }],
  },
  {
    id: "assemble-core-build",
    name: "Core AI Build",
    teamStage: "Assemble",
    fourECategories: ["Expedite Modernization", "Execute with Confidence"],
    description: "Build the solution with client teams, integrating data, model logic, workflows, and handoff.",
    deliverables: ["Product & engineering sprint team", "Data/model integration", "Production-readiness plan"],
    outcome: "A production-ready AI product and in-house capability.",
    buyerPersonas: ["CTO", "CIO", "Data leader", "Operations leader"],
    signalTypes: ["Technology modernization", "AI intent"],
    industries: ["All"],
    businessProblems: ["Stalled AI build", "Fragmented data and workflow", "Production-readiness risk"],
    typicalOutcomes: ["Production-ready product", "Integrated operating workflow", "Capability transfer"],
    credentials: [{ id: "demo-assemble", statement: "Demo proof point: integrated AI build and handoff; replace with an approved Aberdeen credential.", provenance: "demo", replacementRequired: true }],
  },
  {
    id: "mobilize-adoption",
    name: "AI Enablement & Change Management",
    teamStage: "Mobilize",
    fourECategories: ["Execute with Confidence", "Emphasize Growth"],
    description: "Embed new ways of working through training, playbooks, governance, and adoption measurement.",
    deliverables: ["Role-based enablement packs", "Workflow & AI playbooks", "Adoption/value reporting"],
    outcome: "Sustained adoption, governed AI operations, and the next workflow queued.",
    buyerPersonas: ["CIO", "COO", "CHRO", "Transformation leader"],
    signalTypes: ["Transformation", "Executive hire", "Technology modernization"],
    industries: ["All"],
    businessProblems: ["Low adoption", "Governance gaps", "Unclear value realization"],
    typicalOutcomes: ["Sustained adoption", "Governed operations", "Measured value"],
    credentials: [{ id: "demo-mobilize", statement: "Demo proof point: role-based enablement and adoption program; replace with an approved Aberdeen credential.", provenance: "demo", replacementRequired: true }],
  },
];

export function uniqueCanonicalAccountCount(items = accounts): number {
  return new Set(items.map((account) => account.canonicalCompanyId)).size;
}
