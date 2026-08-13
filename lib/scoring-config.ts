export const ICP_SCORING = {
  revenue: { label: "Revenue between $50M and $5B", points: 20, minMillions: 50, maxMillions: 5000 },
  transformation: { label: "Transformation roadmap or active initiative", points: 20 },
  mergerAcquisition: { label: "Recent merger or acquisition activity", points: 15 },
  intent: { label: "Relevant intent or buying signal", points: 20 },
  budget: { label: "Budget or active initiative within 90 days", points: 15 },
  relationship: { label: "Warm Aberdeen relationship", points: 10 },
} as const;

export const SCORE_CATEGORIES = [
  { min: 80, category: "Pursue now", action: "Contact the recommended buyer today" },
  { min: 60, category: "Research and warm", action: "Validate gaps and activate a relationship path" },
  { min: 40, category: "Monitor", action: "Track the signal and add missing evidence" },
  { min: 0, category: "Low priority", action: "Hold until a stronger trigger appears" },
] as const;
