import { z } from 'zod';

export const operationsWidgetSchema = z.object({
  observedAt: z.string(), openIncidents: z.number(), sponsorAlerts: z.number(), unreviewedInjections: z.number(),
  recentReports: z.number(), reportsWithGaps: z.number(),
  lastSeed: z.string().nullable(),
  queue: z.array(z.object({
    server_id: z.string(), label: z.string(), provider: z.string(), waiting: z.number(), oldest: z.number(), median: z.number(),
  })),
  planner: z.array(z.object({
    id: z.string(), name: z.string(), status: z.string(), auto_pause_reason: z.string().nullable(), next_at: z.string(),
  })),
  servers: z.array(z.object({
    id: z.string(), label: z.string(), last_seen: z.string().nullable(), observed_through: z.string().nullable(),
    applied: z.boolean().nullable(),
  })),
});

export const sponsorWidgetSchema = z.object({
  people: z.object({ buyers: z.number(), repeat_buyers: z.number(), median_repeat_seconds: z.number().nullable() }),
  timing: z.object({ measured: z.number(), median_click_seconds: z.number().nullable(), p90_click_seconds: z.number().nullable() }),
  followup: z.object({ purchases: z.number(), thank_yous_created: z.number(), smtp_accepted: z.number(), consent: z.number() }),
  today: z.number(), limit: z.number().nullable(), resetAt: z.string(),
});

export function formatAge(seconds: number | null) {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}
