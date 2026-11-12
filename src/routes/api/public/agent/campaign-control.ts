import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('permit'), id: z.string().uuid(), approvalRevision: z.string().uuid().optional() }),
  z.object({ action: z.literal('release'), ids: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ action: z.literal('confirm-suppressions'), ids: z.array(z.string().uuid()).min(1).max(200) }),
]);
const noStore = { 'Cache-Control': 'no-store' };

export const Route = createFileRoute('/api/public/agent/campaign-control')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { agentFromRequest } = await import('@/lib/kumo.server');
        const agent = await agentFromRequest(request);
        if (!agent) return new Response('Unauthorized', { status: 401 });
        const args = { _server: agent.serverId };
        const [holds, provider] = await Promise.all([
          agent.db.rpc('agent_campaign_holds', args), agent.db.rpc('agent_provider_holds', args),
        ]);
        if (holds.error) return new Response('Unavailable', { status: 503 });
        if (provider.error && provider.error.code !== 'PGRST202') return new Response('Unavailable', { status: 503 });
        return Response.json({ holds: holds.data, ...(provider.error ? {} : { providerHolds: provider.data }) }, { headers: noStore });
      },
      POST: async ({ request }) => {
        const { agentFromRequest } = await import('@/lib/kumo.server');
        const agent = await agentFromRequest(request);
        if (!agent) return new Response('Unauthorized', { status: 401 });
        if (Number(request.headers.get('content-length')) > 10_000) return new Response('Too large', { status: 413 });
        const text = await request.text();
        if (text.length > 10_000) return new Response('Too large', { status: 413 });
        let raw: unknown;
        try { raw = JSON.parse(text); } catch { return new Response('Bad request', { status: 400 }); }
        const body = input.safeParse(raw);
        if (!body.success) return new Response('Bad request', { status: 400 });
        if (body.data.action === 'permit') {
          const args = { _server: agent.serverId, _id: body.data.id };
          const permit = body.data.approvalRevision
            ? await agent.db.rpc('agent_may_inject_approved', { ...args, _revision: body.data.approvalRevision })
            : await agent.db.rpc('agent_may_inject', args);
          if (permit.error) return new Response('Unavailable', { status: 503 });
          return Response.json({ allowed: permit.data === true }, { headers: noStore });
        }
        if (body.data.action === 'confirm-suppressions') {
          const result = await agent.db.rpc('agent_confirm_suppressions', { _server: agent.serverId, _ids: body.data.ids });
          if (result.error) return new Response('Unavailable', { status: 503 });
          return Response.json({ excluded: result.data }, { headers: noStore });
        }
        const release = await agent.db.rpc('agent_campaign_releases', { _server: agent.serverId, _ids: body.data.ids });
        if (release.error) return new Response('Unavailable', { status: 503 });
        return Response.json({ releases: release.data }, { headers: noStore });
      },
    },
  },
});
