import { accounts } from "@/lib/data";
import { accountSchema, type Account } from "@/lib/schemas";

export function liveAccount(id = "draftkings"): Account {
  const seeded = structuredClone(accounts.find((account) => account.id === id)!);
  return accountSchema.parse({ ...seeded,
    revenueMillions: 4800, revenueRange: "$1B-$5B", industry: "Gaming",
    source: { label: "ZoomInfo company profile", observedAt: "2026-09-08T12:00:00Z", provenance: "verified" },
    firmographics: { revenueMillions: 4800, industry: "Gaming", employeeCount: 5500, source: { label: "ZoomInfo company profile", observedAt: "2026-09-08T12:00:00Z", provenance: "verified" } },
    signal: { ...seeded.signal, type: "Funding", summary: "Announced a new growth investment.", whyNow: "Confirm whether the investment changes current priorities.", date: "2026-09-01", relevantIntent: true, activeWithin90Days: true, transformationEvidence: false, mergerOrAcquisition: false,
      source: { label: "ZoomInfo licensed signal", observedAt: "2026-09-08T12:00:00Z", provenance: "verified" },
      evidence: { intentTopics: [{ topic: "Generative AI", score: 92, date: "2026-09-01" }], scoops: [{ type: "Funding", summary: "Announced a new growth investment.", date: "2026-09-01" }] } },
    buyers: [{ id: "zoominfo-person-123", name: "Jordan Example", title: "Chief Technology Officer", email: "jordan@example.com", phone: "+1 555-0100", linkedinUrl: "https://www.linkedin.com/in/jordan-example", decisionRole: "Likely technical sponsor", decisionRoleProvenance: "inferred", warmth: "Unknown", relationshipProvenance: "unknown", relationshipSource: "No verified relationship", suggestedPath: "Validate relevance before outreach.", source: { label: "ZoomInfo recommended contact", observedAt: "2026-09-08T12:00:00Z", provenance: "verified" } }],
  });
}
