import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../integrations/supabase/types';
import { withCampaignDuplicateReview } from '../lib/campaign-duplicates.server';

const user = '10000000-0000-4000-8000-000000000001';
const campaign = '10000000-0000-4000-8000-000000000002';
const draft = {
  name: 'Campagne', fromName: 'Sender', fromEmail: 'sender@example.org', subject: 'Offre',
  html: '<p>Découvrez nos offres</p>', listId: campaign, serverIds: [user], sunsetDays: 'isp' as const,
};
const audience = [{ email: 'Alice@example.org' }, { email: 'bob@example.org' }];

function fixture() {
  let proof = 'initial-matches';
  const rpc = vi.fn((name: string) => {
    if (name === 'find_campaign_duplicates') return { single: async () => ({
      error: null, data: { overlap: 1, matches: [{
        id: campaign, name: 'Campagne existante', status: 'queued', same_body: true, same_offer: false, overlap: 1,
        proof, created_at: '2027-01-01T00:00:00Z', scheduled_at: '2027-02-01T00:00:00Z',
      }] },
    }) };
    return Promise.resolve({ data: true, error: null });
  });
  return {
    db: { rpc } as unknown as SupabaseClient<Database>, rpc,
    changeMatches: () => { proof = 'changed-matches'; },
  };
}

describe('campaign duplicate review', () => {
  it('waits for confirmation and requests it again if the shared recipients change with the same count', async () => {
    const { db, rpc, changeMatches } = fixture();
    const launch = vi.fn(async (renew: (force?: boolean) => Promise<void>) => {
      await renew(true);
      return { kind: 'launched' as const };
    });
    const check = (duplicateConfirmation?: string) => withCampaignDuplicateReview(
      db, user, { ...draft, duplicateConfirmation }, draft.html, audience, launch,
    );
    const first = await check();
    expect(first.kind).toBe('duplicate');
    if (first.kind !== 'duplicate') throw new Error('Expected a duplicate review');
    expect(first.review.campaigns[0]).not.toHaveProperty('proof');
    expect(launch).not.toHaveBeenCalled();

    changeMatches();
    const second = await check(first.review.token);
    if (second.kind !== 'duplicate') throw new Error('Expected a new duplicate review');
    expect(second.review.token).not.toBe(first.review.token);
    expect(launch).not.toHaveBeenCalled();

    expect(await check(second.review.token)).toEqual({ kind: 'launched' });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.filter(([name]) => name === 'release_campaign_duplicate_review')).toHaveLength(3);
  });
});
