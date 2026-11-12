import { expect, it, vi } from 'vitest';
import { inspectSponsorLinks } from '@/lib/sponsor-link-monitor.server';

it('remembers the original destination and detects a change to another approved host', async () => {
  const campaign = {
    html: '<a href="https://track.example.org/item?cid={click_id}&amp;private=secret">Offre</a><a href="https://help.example.org/">Support</a>',
    tracking_url: 'https://track.example.org/new-catalog-url', offer_status: 'active', baseline: {},
  };
  const probe = vi.fn<typeof import('@/lib/sponsor-destination.server').checkSponsorDestination>();
  const detail = 'Destination HTTPS accessible. Vérifiez la cohérence de l’offre avec le message.';
  probe.mockResolvedValueOnce({ status: 'ok', hosts: ['track.example.org', 'shop.example.org'], detail });
  probe.mockResolvedValueOnce({ status: 'ok', hosts: ['track.example.org', 'elsewhere.example.org'], detail });
  const first = await inspectSponsorLinks(campaign, probe);
  expect(first.result.status).toBe('ok');
  const second = await inspectSponsorLinks({ ...campaign, baseline: first.baseline }, probe);
  expect(second.result).toEqual({
    status: 'alert', notes: ['Destination finale modifiée de shop.example.org vers elsewhere.example.org.'],
  });
  expect(second.baseline).toEqual(first.baseline);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(second)).not.toContain('secret');
});

it('keeps manual reviews visible and does not probe a catalogue link missing from the message', async () => {
  const campaign = { html: '<p>Bonjour</p>', tracking_url: 'https://track.example.org/', offer_status: 'active', baseline: {} };
  const probe = vi.fn();
  expect((await inspectSponsorLinks(campaign, probe)).result.status).toBe('review');
  expect((await inspectSponsorLinks({ ...campaign, offer_status: 'paused' }, probe)).result.status).toBe('alert');
  expect(probe).not.toHaveBeenCalled();
});
