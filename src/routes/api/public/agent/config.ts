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
        const revision = await a.db.from('server_agents').select('vmta_inventory_revision').eq('server_id', a.serverId).maybeSingle();
        if (revision.error && revision.error.code !== '42703') return new Response('Configuration unavailable', { status: 503 });
        const b = await buildBundle(a.db, a.serverId, true);
        const config = { config_hash: b.hash, last_seen: new Date().toISOString() };
        if (revision.error?.code === '42703') {
          const legacy = await a.db.from('server_agents').update(config).eq('server_id', a.serverId);
          if (legacy.error) return new Response('Configuration unavailable', { status: 503 });
        } else {
          if (!revision.data) return new Response('Configuration unavailable', { status: 503 });
          const stored = await a.db.from('server_agents').update({ ...config, vmta_config_hash: b.hash })
            .eq('server_id', a.serverId).eq('vmta_inventory_revision', revision.data.vmta_inventory_revision).select('server_id').maybeSingle();
          if (stored.error) return new Response('Configuration unavailable', { status: 503 });
          if (!stored.data) return new Response('Inventory changed; retry', { status: 409 });
        }
        return Response.json(b, { headers: { 'Cache-Control': 'no-store' } });
      },
    },
  },
});
