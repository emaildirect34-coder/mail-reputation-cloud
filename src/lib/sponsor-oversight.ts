import { z } from 'zod';

export const linkCheckSchema = z.object({
  status: z.enum(['ok', 'review', 'alert']),
  notes: z.array(z.string()),
});

const reasons = ['missing', 'attribution', 'unverified', 'status', 'local_only'] as const;
export const reconciliationSchema = z.object({
  importedAt: z.string(),
  reported: z.number(),
  counts: z.object({
    matched: z.number(), missing: z.number(), attribution: z.number(),
    unverified: z.number(), status: z.number(), local_only: z.number(),
  }),
  issues: z.array(z.object({
    transaction_id: z.string(), reason: z.enum(reasons), local_status: z.string().nullable(),
  })),
});
