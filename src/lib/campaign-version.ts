import { z } from 'zod';

export const campaignVersionKey = z.object({ id: z.string().uuid(), version: z.number().int().positive().max(2_147_483_647) });

export const campaignVersionSnapshot = z.object({
  name: z.string(), subject: z.string(), fromName: z.string(), fromEmail: z.string(), replyTo: z.string().nullable(),
  html: z.string(), ampHtml: z.string().nullable(), weeklyDigest: z.boolean(), digestSource: z.string().nullable(),
  sponsorId: z.string().uuid().nullable(), sponsorName: z.string().nullable(), sponsorUrl: z.string().nullable(),
  topic: z.string().nullable(), scheduledAt: z.string().nullable(), sendExpiresAt: z.string().nullable().default(null),
  listId: z.string().uuid().nullable(), listName: z.string().nullable(),
  servers: z.array(z.object({ id: z.string().uuid(), label: z.string() })),
  poolId: z.string().uuid().nullable(), poolName: z.string().nullable(), priority: z.number(),
  windowStart: z.number().nullable(), windowEnd: z.number().nullable(),
  variants: z.unknown().transform(value => value == null ? null : JSON.stringify(value) ?? null),
});

export function changedText(before: string, after: string) {
  let start = 0, end = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start++;
  while (end < shortest - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
  return {
    leading: before.slice(Math.max(0, start - 80), start),
    before: before.slice(start, before.length - end),
    after: after.slice(start, after.length - end),
    trailing: before.slice(before.length - end, before.length - end + 80),
  };
}
