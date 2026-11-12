import { expect, it, vi } from 'vitest';
import { Route } from '@/routes/apres-achat/$token';
import { purchaseConsentText } from '@/lib/sponsor-buyers';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { rpc } }));

it('allows a buyer to open the review page without opting in and requires explicit choices to subscribe', async () => {
  const token = 'a'.repeat(48);
  const url = 'https://app.example.org/apres-achat/' + token;
  type Handler = (input: { request: Request; params: { token: string } }) => Promise<Response>;
  const { GET, POST } = (Route.options as unknown as { server: { handlers: { GET: Handler; POST: Handler } } }).server.handlers;
  rpc.mockReturnValueOnce({ maybeSingle: async () => ({
    data: { review_url: 'https://reviews.example.org/?lang=fr&campaign=partner', can_subscribe: true, confirmed: false },
  }) }).mockResolvedValueOnce({ data: [{
    id: '10000000-0000-4000-8000-000000000002', name: 'Marque <Test>', blocked: false,
  }] });
  const response = await GET({ request: new Request(url), params: { token } });
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  const html = await response.text();
  expect(html).toContain('https://reviews.example.org/?lang=fr&amp;campaign=partner');
  expect(html).toContain('Marque &lt;Test&gt;');
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(['read_purchase_feedback', 'read_recipient_sponsor_options']);

  const submit = (fields: Record<string, string>, headers: HeadersInit = {}) =>
    POST({ request: new Request(url, { method: 'POST', headers, body: new URLSearchParams(fields) }), params: { token } });
  expect((await submit({ topic: 'offers', rhythm: 'weekly' })).status).toBe(400);
  const preferences = { consent: 'yes', topic: 'offers', rhythm: 'weekly' };
  expect((await submit(preferences, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  expect(rpc.mock.calls).toHaveLength(2);

  rpc.mockResolvedValueOnce({ data: 'confirmed' });
  expect((await submit(preferences)).status).toBe(303);
  expect(rpc).toHaveBeenLastCalledWith('confirm_purchase_offers', {
    _hash: expect.stringMatching(/^[a-f0-9]{64}$/), _topics: ['offers'], _weekly: true, _statement: purchaseConsentText,
  });
  const brand = '10000000-0000-4000-8000-000000000002';
  rpc.mockResolvedValueOnce({ data: 'saved' });
  expect((await submit({ action: 'sponsor', brand, blocked: 'true' })).status).toBe(303);
  expect(rpc).toHaveBeenLastCalledWith('set_recipient_sponsor_option', {
    _token: expect.stringMatching(/^[a-f0-9]{64}$/), _scope: 'purchase', _brand: brand, _blocked: true,
  });
});
