import { createFileRoute } from '@tanstack/react-router';

// Called by the KumoMTA agent on each server (bearer agent token). Returns config + DKIM keys for this server only.
export const Route = createFileRoute('/api/public/agent/config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { agentFromRequest, buildBundle } = await import('@/lib/kumo.server');
        const a = await agentFromRequest(request);
        if (!a) return new Response('Unauthorized', { status: 401 });
        const { healServerIps } = await import('@/lib/ip-health.server');
        await healServerIps(a.db, a.serverId).catch(() => []);
        const b = await buildBundle(a.db, a.serverId, true);
        await a.db.from('server_agents').update({ config_hash: b.hash, last_seen: new Date().toISOString() }).eq('server_id', a.serverId);
        return Response.json(b, { headers: { 'Cache-Control': 'no-store' } });
      },
    },
  },
});
