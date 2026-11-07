import { z } from 'zod';
import { canOpen, type Access } from './access';
export const deliveryBatch = z.object({ events: z.array(z.object({
  eventKey: z.string().min(1).max(128), messageId: z.string().uuid(),
  type: z.enum(['delivered', 'bounce', 'deferred', 'complaint']),
  occurredAt: z.string().datetime({ offset: true }), smtpCode: z.number().int().min(100).max(599).optional(),
  detail: z.string().max(1000).default(''),
})).min(1).max(500) });
export const logFilters = z.object({ type: z.enum(['all','delivered','bounce','deferred','complaint']).default('all'), search: z.string().max(200).default(''), page: z.number().int().min(0).max(10000).default(0) });
export const canReadLogs = (access: Access) => canOpen(access, '/dashboard/logs');
export function protectionRules(sample: number, hardBounces: number, ispAccepted: number, complaints: number) {
  return { hardBounce: sample > 0 && hardBounces / sample > 0.03, complaint: ispAccepted > 0 && complaints / ispAccepted > 0.0008 };
}