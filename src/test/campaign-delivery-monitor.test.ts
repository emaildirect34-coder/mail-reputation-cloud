import { expect, it } from 'vitest';
import { campaignDeliveryGroups } from '@/lib/campaign-delivery-monitor';

it('groups production SMTP with matching witnesses without treating witnesses as production deliveries', () => {
  const row = {
    queued: 2, claimed: 0, injected: 3, injection_failed: 0, accepted: 2, deferred: 1,
    bounced: 0, complained: 0, oldest_due_at: '2026-11-10T10:00:00Z',
  };
  const groups = campaignDeliveryGroups([
    { ...row, domain: 'hotmail.com' },
    { ...row, domain: 'outlook.com', oldest_due_at: '2026-11-10T09:55:00Z' },
    { ...row, domain: 'free.fr' },
  ], [
    { address: 'seed@outlook.fr', placement: 'spam', received_at: '2026-11-10T10:12:00Z' },
    { address: 'seed@outlook.com', placement: 'inbox', received_at: '2026-11-10T10:10:00Z' },
    { address: 'seed@sfr.fr', placement: 'pending' },
  ]);
  expect(groups[0]).toMatchObject({
    provider: 'Microsoft', queued: 4, accepted: 4, deferred: 2,
    oldestDueAt: '2026-11-10T09:55:00Z', lastReceivedAt: '2026-11-10T10:12:00Z',
    placement: { spam: 1, inbox: 1 },
  });
  expect(groups.find(group => group.provider === 'SFR')).toMatchObject({ accepted: 0, placement: { pending: 1 } });
});
