import { afterEach, expect, it, vi } from 'vitest';
import { issueSubscriptionToken, readSubscriptionToken } from '@/lib/subscription-confirmation.server';
import { verifySubscriptionProof } from '@/lib/subscription-proof.server';
import { Route } from '@/routes/confirm-subscription/$token';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { rpc } }));

afterEach(() => { vi.unstubAllEnvs(); rpc.mockReset(); });

it('binds an opaque confirmation to its address and list, rejecting changes, expiry and wrong keys', async () => {
  const email = 'contact@example.org', list = 'c30d9512-234c-4f27-baf5-8f0935a949d5', listName = 'Newsletter';
  vi.stubEnv('SUBSCRIPTION_CONFIRMATION_KEY', 'ab'.repeat(32));
  const { token, expires } = await issueSubscriptionToken(email, list, listName, 1000);
  expect(token).not.toContain(email);
  expect(await readSubscriptionToken(token, 1000)).toEqual({ email, list, listName, expires });
  expect(await readSubscriptionToken(token, expires)).toBeNull();
  expect(await readSubscriptionToken((token[0] === 'A' ? 'B' : 'A') + token.slice(1), 1000)).toBeNull();
  vi.stubEnv('SUBSCRIPTION_CONFIRMATION_KEY', 'cd'.repeat(32));
  expect(await readSubscriptionToken(token, 1000)).toBeNull();
});

it('registers consent only after the explicit POST', async () => {
  const email = 'contact@example.org', list = 'c30d9512-234c-4f27-baf5-8f0935a949d5';
  vi.stubEnv('SUBSCRIPTION_CONFIRMATION_KEY', 'ab'.repeat(32));
  vi.stubEnv('SUBSCRIPTION_PROOF_KEY', 'cd'.repeat(32));
  const { token } = await issueSubscriptionToken(email, list, '<Newsletter>');
  type Handler = (input: { request: Request; params: { token: string } }) => Promise<Response>;
  const { GET, POST } = (Route.options as unknown as { server: { handlers: { GET: Handler; POST: Handler } } }).server.handlers;
  const url = 'https://app.example.org/confirm-subscription/' + token;
  const response = await GET({ request: new Request(url), params: { token } });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('&#60;Newsletter&#62;');
  expect(rpc).not.toHaveBeenCalled();
  expect((await POST({ request: new Request(url, { method: 'POST' }), params: { token } })).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: 'confirmed' });
  expect((await POST({ request: new Request(url, { method: 'POST', body: new URLSearchParams({ confirm: 'yes' }) }), params: { token } })).status).toBe(200);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('confirm_contact_subscription', {
    _list: list, _email: email, _token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    _proof_payload: expect.any(String), _proof_signature: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const { _proof_payload: payload, _proof_signature: signature, _token_hash: tokenHash } = rpc.mock.calls[0]![1];
  expect(JSON.parse(payload)).toMatchObject({
    form: 'https://app.example.org/confirm-subscription',
    statement: 'Confirmez si vous souhaitez recevoir les e-mails de la liste <Newsletter>.',
  });
  expect(payload).not.toContain(token);
  expect(await verifySubscriptionProof(payload, signature, tokenHash, list, email)).toBe(true);
  expect(await verifySubscriptionProof(payload + ' ', signature, tokenHash, list, email)).toBe(false);
  expect(await verifySubscriptionProof(payload, signature, tokenHash, list, 'other@example.org')).toBe(false);
});
