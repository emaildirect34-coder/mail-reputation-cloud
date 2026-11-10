import { z } from 'zod';
import { canOpen, type Access } from './access';
export const deliveryBatch = z.object({ events: z.array(z.object({
  eventKey: z.string().min(1).max(128), messageId: z.string().uuid(),
  type: z.enum(['delivered', 'bounce', 'deferred', 'complaint', 'dsn']),
  occurredAt: z.string().datetime({ offset: true }), smtpCode: z.number().int().min(100).max(599).optional(),
  detail: z.string().max(1000).default(''),
  returnPath: z.string().max(320).optional(),
  sourceIpv4: z.string().ip({ version: 'v4' }).optional(),
  dsn: z.object({
    recipient: z.string().trim().min(1).max(320),
    status: z.string().regex(/^[245]\.\d{1,3}\.\d{1,3}$/),
  }).optional(),
})).min(1).max(500) });
export type DeliveryEvent = z.infer<typeof deliveryBatch>['events'][number];
export const logFilters = z.object({ type: z.enum(['all','delivered','bounce','deferred','complaint']).default('all'), search: z.string().max(200).default(''), page: z.number().int().min(0).max(10000).default(0) });
export const canReadLogs = (access: Access) => canOpen(access, '/dashboard/logs');

export function isExplicitGreylisting(code: number | null, detail: string) {
  return (code === 421 || code === 451) && /\bgr[ae]y[-\s]?list(?:ed|ing)?\b/i.test(detail);
}

export function isMailboxFull(code: number | null, detail: string) {
  return code === 452 && /^4\.2\.2(?:[^\d.]|$)/.test(detail);
}

export function parseMessageReference(value: string) {
  const text = value.trim().replace(/^message-id:\s*/i, '');
  const wrapped = text.startsWith('<');
  if (wrapped !== text.endsWith('>')) return null;
  const match = /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:@([a-z0-9.-]+))?$/i.exec(wrapped ? text.slice(1, -1) : text);
  if (!match || (wrapped && !match[2])) return null;
  return { id: match[1]!.toLowerCase(), domain: match[2]?.toLowerCase() ?? null };
}
export function protectionRules(sample: number, hardBounces: number, ispAccepted: number, complaints: number) {
  return { hardBounce: sample > 0 && hardBounces / sample > 0.03, complaint: ispAccepted > 0 && complaints / ispAccepted > 0.0008 };
}
