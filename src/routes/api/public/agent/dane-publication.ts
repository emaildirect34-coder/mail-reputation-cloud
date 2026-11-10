import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { readTrackingBody } from '@/lib/tracking-request';

const submission = z.object({
  domain: z.string().min(1).max(253), mx: z.string().min(1).max(244), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
const target = submission.extend({ serverId: z.string().uuid(), approvedBy: z.string().uuid() });
const noStore = { 'Cache-Control': 'no-store' };

export const Route = createFileRoute('/api/public/agent/dane-publication')({
  server: { handlers: {
    POST: async ({ request }) => {
      const { agentFromRequest } = await import('@/lib/kumo.server');
      const agent = await agentFromRequest(request);
      if (!agent) return new Response('Unauthorized', { status: 401, headers: noStore });
      const bytes = await readTrackingBody(request);
      if (!bytes) return new Response('Invalid submission', { status: 400, headers: noStore });
      let payload: unknown, config: unknown;
      try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return new Response('Invalid submission', { status: 400, headers: noStore }); }
      try { config = JSON.parse(process.env['DANE_AUTOMATION_TARGETS'] ?? '[]'); }
      catch { return new Response('Invalid automation configuration', { status: 503, headers: noStore }); }
      const data = submission.safeParse(payload);
      const targets = z.array(target).max(20).safeParse(config);
      if (!data.success) return new Response('Invalid submission', { status: 400, headers: noStore });
      if (!targets.success) return new Response('Invalid automation configuration', { status: 503, headers: noStore });
      const approved = targets.data.find(item => item.serverId === agent.serverId && item.domain === data.data.domain &&
        item.mx === data.data.mx && item.fingerprint === data.data.fingerprint);
      if (!approved) return new Response('Forbidden', { status: 403, headers: noStore });
      const role = await agent.db.rpc('has_role', { _user_id: approved.approvedBy, _role: 'superadmin' });
      if (role.error) return new Response('Role check unavailable', { status: 503, headers: noStore });
      if (!role.data) return new Response('Forbidden', { status: 403, headers: noStore });
      const { publishDane } = await import('@/lib/domains.server');
      try {
        const status = await publishDane(agent.db, data.data, agent.serverId);
        return Response.json({ status }, { headers: noStore });
      } catch {
        return new Response('Publication preconditions not met', { status: 409, headers: noStore });
      }
    },
  } },
});
