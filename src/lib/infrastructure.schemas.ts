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