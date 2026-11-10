import { z } from 'zod';
import { recipientTimeZone } from './campaign-schedule';
import { recipientDomain } from './email-address';
import { campaignTopics } from './campaign-topics';

export const listInput = z.object({ name: z.string().trim().min(1).max(80) });
export const importInput = z.object({ listId: z.string().uuid(), text: z.string().max(5_000_000), withTimeZones: z.boolean().optional(), reviewedBatch: z.string().regex(/^[a-f0-9]{64}$/).optional() });

export function concentratedImport(rows: { email: string }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const domain = recipientDomain(row.email);
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  for (const [domain, count] of counts) {
    if (count >= 200 && count / rows.length >= 0.8) return { domain, count, total: rows.length };
  }
  return null;
}
export const suppressionInput = z.object({ text: z.string().max(5_000_000), source: z.string().trim().max(80).default('manuel') });
export const launchInput = z.object({
  name: z.string().trim().min(1).max(120),
  fromName: z.string().trim().min(1).max(120),
  fromEmail: z.string().trim().email(),
  replyTo: z.string().trim().email().or(z.literal('')).optional(),
  subject: z.string().trim().min(1).max(300),
  html: z.string().min(20).max(500_000),
  ampHtml: z.string().trim().max(200_000).optional(),
  digestText: z.string().trim().min(1).max(20_000).optional(),
  fatigueProtection: z.boolean().optional(),
  monitorPlacement: z.boolean().optional(),
  listId: z.string().uuid(),
  serverIds: z.array(z.string().uuid()).min(1).max(100),
  vmtaPoolId: z.string().uuid().optional(),
  topic: z.enum(campaignTopics).optional(),
  sponsorOfferId: z.string().uuid().optional(),
  schedule: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  scheduleTimeZone: z.string().max(80).optional(),
  sunsetDays: z.union([z.literal('isp'), z.literal('off'), z.literal(30), z.literal(60), z.literal(90), z.literal(365)]).default('isp'),
  acceptTypoExclusions: z.boolean().optional(),
  sendWindowHours: z.union([z.literal(2), z.literal(4), z.literal(8)]).optional(),
  recipientLocalTime: z.boolean().optional(),
});
export const campaignStatusInput = z.object({ id: z.string().uuid(), status: z.enum(['queued', 'paused', 'cancelled']) });

/** Parse email and first name, with an optional third column for the IANA time zone. */
export function parseContacts(text: string, withTimeZones = false) {
  const seen = new Set<string>();
  const zones = new Map<string, string>();
  const out: { email: string; first_name: string | null; time_zone?: string }[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const [rawEmail, ...rest] = line.split(/[,;\t]/);
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!recipientDomain(email) || seen.has(email)) continue;
    const rawZone = withTimeZones ? rest[1]?.trim() : undefined;
    let timeZone: string | undefined;
    if (rawZone) {
      try {
        timeZone = zones.get(rawZone) ?? recipientTimeZone(rawZone);
        zones.set(rawZone, timeZone);
      } catch {
        throw new Error(`Fuseau horaire invalide à la ligne ${index + 1}. Utilisez un fuseau IANA comme Europe/Paris.`);
      }
    }
    seen.add(email);
    out.push({ email, first_name: rest[0]?.trim() || null, ...(timeZone ? { time_zone: timeZone } : {}) });
  }
  return out;
}

/** Round-robin assignment of recipients to servers. */
export function assignServers<T>(items: T[], servers: string[]) {
  return items.map((item, i) => ({ item, server: servers[i % servers.length]! }));
}
