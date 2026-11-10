import { afterEach, expect, it, vi } from 'vitest';
import { Route } from '@/routes/api/public/agent/dane-publication';

const { agentFromRequest, publishDane } = vi.hoisted(() => ({ agentFromRequest: vi.fn(), publishDane: vi.fn() }));
vi.mock('@/lib/kumo.server', () => ({ agentFromRequest }));
vi.mock('@/lib/domains.server', () => ({ publishDane }));

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it('only publishes a pinned target from its assigned agent with a current superadmin approval', async () => {
  const serverId = 'cceeead6-0d0f-4d0f-865d-c5b589f0d098';
  const approvedBy = '5cc348d0-d510-41e7-882f-f8500f24b953';
  const target = { domain: 'example.org', mx: 'mail.example.org', fingerprint: 'ab'.repeat(32) };
  const db = { rpc: vi.fn() };
  const options = Route.options as unknown as { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } };
  const call = (data = target) => options.server.handlers.POST({ request: new Request('https://app.example.org/api/public/agent/dane-publication', { method: 'POST', body: JSON.stringify(data) }) });
  vi.stubEnv('DANE_AUTOMATION_TARGETS', JSON.stringify([{ ...target, serverId, approvedBy }]));
  agentFromRequest.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(401);
  agentFromRequest.mockResolvedValue({ serverId: approvedBy, db });
  expect((await call()).status).toBe(403);
  agentFromRequest.mockResolvedValue({ serverId, db });
  expect((await call({ ...target, fingerprint: 'cd'.repeat(32) })).status).toBe(403);
  db.rpc.mockResolvedValue({ data: false });
  expect((await call()).status).toBe(403);
  expect(publishDane).not.toHaveBeenCalled();
  db.rpc.mockResolvedValue({ data: true });
  publishDane.mockResolvedValue('published');
  expect(await (await call()).json()).toEqual({ status: 'published' });
  expect(db.rpc).toHaveBeenCalledWith('has_role', { _user_id: approvedBy, _role: 'superadmin' });
  expect(publishDane).toHaveBeenCalledExactlyOnceWith(db, target, serverId);
});
