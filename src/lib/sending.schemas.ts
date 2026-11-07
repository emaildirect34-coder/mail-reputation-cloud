import { z } from 'zod';

export const listInput = z.object({ name: z.string().trim().min(1).max(80) });
export const importInput = z.object({ listId: z.string().uuid(), text: z.string().max(5_000_000) });
export const suppressionInput = z.object({ text: z.string().max(5_000_000), source: z.string().trim().max(80).default('manuel') });
export const launchInput = z.object({
  name: z.string().trim().min(1).max(120),
  fromName: z.string().trim().min(1).max(120),
  fromEmail: z.string().trim().email(),
  replyTo: z.string().trim().email().or(z.literal('')).optional(),
  subject: z.string().trim().min(1).max(300),
  html: z.string().min(20).max(500_000),
  listId: z.string().uuid(),
  serverIds: z.array(z.string().uuid()).min(1).max(100),
});
export const campaignStatusInput = z.object({ id: z.string().uuid(), status: z.enum(['queued', 'paused', 'cancelled']) });

/** Parse "email[,first_name]" lines; drops invalid emails and duplicates. */
export function parseContacts(text: string) {
  const seen = new Set<string>(); const out: { email: string; first_name: string | null }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [rawEmail, ...rest] = line.split(/[,;\t]/);
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || seen.has(email)) continue;
    seen.add(email); out.push({ email, first_name: rest[0]?.trim() || null });
  }
  return out;
}

/** Round-robin assignment of recipients to servers. */
export function assignServers<T>(items: T[], servers: string[]) {
  return items.map((item, i) => ({ item, server: servers[i % servers.length]! }));
}
