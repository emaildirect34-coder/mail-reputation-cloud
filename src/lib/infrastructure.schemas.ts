import { z } from 'zod';

export const uuidInput = z.object({ id: z.string().uuid() });
export const poolInput = z.object({ name: z.string().trim().min(1).max(80), purpose: z.enum(['transactional', 'marketing', 'quarantine']) });
export const assignmentInput = z.object({ ipId: z.string().uuid(), poolId: z.string().uuid().nullable() });
export const bindingInput = z.object({ serverId: z.string().uuid(), domainId: z.string().uuid() });
export const warmupInput = z.object({ ipId: z.string().uuid(), isp: z.enum(['Gmail','Microsoft','Yahoo','Orange','Free / SFR','Autres']), dailyLimits: z.array(z.number().int().min(1).max(1000000)).min(1).max(90) });
export function plannedQuota(limits: number[], day: number) { return limits[Math.max(0, Math.min(day - 1, limits.length - 1))] ?? 0; }

export const infrastructurePaths = ['/dashboard/servers','/dashboard/ips','/dashboard/pools','/dashboard/warmup'];
export function allowsInfrastructure(role: string | null, paths: string[], target: string) {
  return role === 'superadmin' || (role === 'worker' && paths.includes(target) && infrastructurePaths.includes(target));
}
/** Day of the plan in effect: active plans advance one day every 24h since activation (created_at is reset on activation/resume). */
export function effectiveDay(w: { current_day: number; status: string; created_at: string; daily_limits: number[] }, now = Date.now()) {
  const extra = w.status === 'active' ? Math.floor((now - new Date(w.created_at).getTime()) / 86_400_000) : 0;
  return Math.max(1, Math.min(w.current_day + Math.max(0, extra), w.daily_limits.length));
}
/** Preset curves per mailbox provider (conservative for Microsoft / French ISPs). */
export const warmupPresets: Record<string, number[]> = {
  Gmail: [50, 100, 200, 400, 700, 1000, 1500, 2000, 3000, 4500, 6000, 8000, 10000, 13000, 16000, 20000, 25000, 30000, 40000, 50000],
  Microsoft: [20, 40, 80, 150, 250, 400, 600, 800, 1100, 1500, 2000, 2600, 3300, 4000, 5000, 6500, 8000, 10000, 12000, 15000],
  Yahoo: [50, 100, 200, 350, 550, 800, 1100, 1500, 2000, 2700, 3500, 4500, 6000, 8000, 10000, 13000, 16000, 20000],
  Orange: [20, 40, 70, 120, 200, 300, 450, 650, 900, 1200, 1600, 2100, 2700, 3500, 4500, 6000, 8000, 10000],
  'Free / SFR': [20, 40, 70, 120, 200, 300, 450, 650, 900, 1200, 1600, 2100, 2700, 3500, 4500, 6000, 8000],
  Autres: [100, 200, 400, 800, 1500, 2500, 4000, 6000, 9000, 13000, 18000, 25000],
};
