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
        const [revision, maintenance] = await Promise.all([
          a.db.from('server_agents').select('vmta_inventory_revision').eq('server_id', a.serverId).maybeSingle(),
          a.db.from('managed_servers').select('maintenance_since').eq('id', a.serverId).maybeSingle(),
        ]);
        if (revision.error && revision.error.code !== '42703') return new Response('Configuration unavailable', { status: 503 });
        if (maintenance.error && maintenance.error.code !== '42703') return new Response('Configuration unavailable', { status: 503 });
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
        const revisionHistory = await a.db.rpc('record_server_config_revision', { _server: a.serverId, _hash: b.hash });
        if (revisionHistory.error && revisionHistory.error.code !== 'PGRST202') return new Response('Configuration history unavailable', { status: 503 });
        return Response.json({ ...b, maintenanceSince: maintenance.data?.maintenance_since ?? null }, { headers: { 'Cache-Control': 'no-store' } });
      },
    },
  },
});
