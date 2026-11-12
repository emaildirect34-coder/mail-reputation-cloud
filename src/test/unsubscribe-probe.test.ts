import { expect, it, vi } from 'vitest';
import { Route } from '@/routes/api/public/unsub/$token';

const { rpc, fireWebhooks } = vi.hoisted(() => ({ rpc: vi.fn(), fireWebhooks: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { rpc } }));
vi.mock('@/lib/webhooks.server', () => ({ fireWebhooks }));

it('processes a synthetic one-click request through the normal unsubscribe path without a sponsor webhook', async () => {
  const token = 'a'.repeat(36);
  const url = 'https://app.example.org/api/public/unsub/' + token;
  type Handler = (input: { request: Request; params: { token: string } }) => Promise<Response>;
  const { GET, POST } = (Route.options as unknown as { server: { handlers: { GET: Handler; POST: Handler } } }).server.handlers;
  const params = { token };
  expect((await GET({ request: new Request(url), params })).status).toBe(200);
  expect(rpc).not.toHaveBeenCalled();

  rpc.mockResolvedValue({ data: [{
    email: 'email-direct-unsub-10000000-0000-4000-8000-000000000001@example.invalid',
    campaign_id: 'test-campaign', newly_suppressed: true,
  }] });
  const response = await POST({
    request: new Request(url, { method: 'POST', body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }) }), params,
  });
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('unsubscribe_campaign_message', { _token: token });
  expect(fireWebhooks).not.toHaveBeenCalled();
});
