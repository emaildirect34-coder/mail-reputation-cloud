import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import type { launchInput } from './sending.schemas';

const duplicateMatch = z.object({
  id: z.string().uuid(), name: z.string(), status: z.string(), created_at: z.string(), scheduled_at: z.string().nullable(),
  same_body: z.boolean(), same_offer: z.boolean(), overlap: z.number(), proof: z.string(),
});
type Match = Omit<z.infer<typeof duplicateMatch>, 'proof'>;
type Draft = z.infer<typeof launchInput>;

function md5(value: string) {
  return createHash('md5').update(value).digest('hex');
}

async function findDuplicates(
  db: SupabaseClient<Database>, criteria: { _body: string; _offer: string | null }, recipients: string[], evidence: ReturnType<typeof createHash>,
) {
  const matches = new Map<string, Match>();
  const asOf = new Date().toISOString();
  let overlap = 0;
  for (let offset = 0; offset < recipients.length; offset += 2500) {
    const result = await db.rpc('find_campaign_duplicates', {
      ...criteria, _recipients: recipients.slice(offset, offset + 2500), _as_of: asOf,
    }).single();
    if (result.error) throw new Error('Vérification des doublons indisponible.');
    if (!result.data) throw new Error('Résultat de vérification des doublons indisponible.');
    overlap += result.data.overlap;
    for (const { proof, ...match } of duplicateMatch.array().parse(result.data.matches)) {
      evidence.update(JSON.stringify([offset, match, proof]));
      match.overlap += matches.get(match.id)?.overlap ?? 0;
      matches.set(match.id, match);
    }
  }
  return { overlap, campaigns: [...matches.values()].sort((a, b) =>
    b.overlap - a.overlap || (b.scheduled_at ?? b.created_at).localeCompare(a.scheduled_at ?? a.created_at) || a.id.localeCompare(b.id)) };
}

export async function withCampaignDuplicateReview<T>(
  db: SupabaseClient<Database>, userId: string, input: Draft, html: string,
  audience: { email: string }[], prepare: (renew: (force?: boolean) => Promise<void>) => Promise<T>,
) {
  const { duplicateConfirmation, ...draft } = input;
  const criteria = { _body: md5(html.replaceAll('\r\n', '\n')), _offer: draft.sponsorOfferId ?? null };
  const lease = { ...criteria, _token: randomUUID() };
  const result = await db.rpc('lease_campaign_duplicate_review', lease);
  if (result.error?.code === 'PGRST202') throw new Error('La vérification des doublons nécessite la migration 0063.');
  if (result.error) throw new Error('Vérification des doublons indisponible.');
  if (!result.data) throw new Error('Une campagne avec ce contenu ou cette offre est en cours de préparation. Réessayez dans un instant.');

  let renewedAt = Date.now();
  async function renew(force = false) {
    if (!force && Date.now() - renewedAt < 60_000) return;
    const refresh = await db.rpc('lease_campaign_duplicate_review', { ...lease, _renew: true });
    if (refresh.error || !refresh.data) throw new Error('La vérification des doublons a expiré. Relancez la préparation.');
    renewedAt = Date.now();
  }

  try {
    const recipients = [...new Set(audience.map(contact => md5(contact.email.trim().toLowerCase())))].sort();
    const evidence = createHash('sha256').update(JSON.stringify([userId, draft])).update(recipients.join(''));
    const review = await findDuplicates(db, criteria, recipients, evidence);
    const token = evidence.digest('hex');
    if (review.overlap && duplicateConfirmation !== token) return { kind: 'duplicate' as const, review: { ...review, token } };
    await renew();
    return await prepare(renew);
  } finally {
    try {
      const released = await db.rpc('release_campaign_duplicate_review', { _token: lease._token });
      if (released.error) console.error('Campaign duplicate lease release failed', released.error.code);
    } catch {
      console.error('Campaign duplicate lease release unavailable');
    }
  }
}
