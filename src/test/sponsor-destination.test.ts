import { afterEach, expect, it, vi } from 'vitest';
import { checkSponsorDestination } from '@/lib/sponsor-destination.server';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('follows an approved HTTPS redirect without disclosing tracking query parameters in the report', async () => {
  vi.stubEnv('SPONSOR_AUDIT_HOSTS', 'tracking.example.org,shop.example.org');
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://shop.example.org/item?secret=abc' } }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const result = await checkSponsorDestination('https://tracking.example.org/?cid={click_id}');
  expect(result).toMatchObject({ status: 'ok', hosts: ['tracking.example.org', 'shop.example.org'] });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD', redirect: 'manual' });
});

it('never fetches an unapproved redirect or an IP literal', async () => {
  vi.stubEnv('SPONSOR_AUDIT_HOSTS', 'tracking.example.org');
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, {
    status: 302, headers: { Location: 'https://unknown.example.org/checkout' },
  }));
  vi.stubGlobal('fetch', fetch);
  expect((await checkSponsorDestination('https://tracking.example.org')).status).toBe('manual');
  expect((await checkSponsorDestination('https://127.0.0.1')).status).toBe('failed');
  expect(fetch).toHaveBeenCalledTimes(1);
});
