export const sources = ['website', 'call', 'walk_in'] as const;
export const stages = [
  'new',
  'contacted',
  'viewing_scheduled',
  'offer',
  'won',
  'lost',
] as const;
export type DashboardSummary = {
  generatedAt: string;
  scope: 'agency' | 'mine';
  timezone: 'Asia/Dubai';
  weekStart: string;
  weekEndExclusive: string;
  totalLeads: number;
  newLeadsThisWeek: number;
  wonLeads: number;
  conversionRatePercent: number | null;
  leadsBySource: { source: (typeof sources)[number]; count: number }[];
  pipelineByStage: { stage: (typeof stages)[number]; count: number }[];
};
