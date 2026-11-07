import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const body = z.object({
  agentVersion: z.string().max(40).optional(),
  kumoVersion: z.string().max(40).optional(),
  appliedHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  installed: z.array(z.string().uuid()).max(500).default([]),
  failed: z.array(z.object({ bindingId: z.string().uuid(), error: z.string().max(300) })).max(500).default([]),
  error: z.string().max(500).nullable().optional(),
  metrics: z.object({ cpu: z.number().min(0).max(100).optional(), ram: z.number().min(0).max(100).optional(), queued: z.number().int().min(0).optional(), delivered1h: z.number().int().min(0).optional(), bounced1h: z.number().int().min(0).optional() }).default({}),
});

export const Route = createFileRoute('/api/public/agent/report')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { agentFromRequest } = await import('@/lib/kumo.server');
        const a = await agentFromRequest(request);
        if (!a) return new Response('Unauthorized', { status: 401 });
        const p = body.safeParse(await request.json().catch(() => null));
        if (!p.success) return new Response('Bad request', { status: 400 });
        const d = p.data, now = new Date().toISOString();
        await a.db.from('server_agents').update({ status: d.error ? 'error' : 'online', agent_version: d.agentVersion ?? null, kumo_version: d.kumoVersion ?? null, applied_hash: d.appliedHash ?? null, metrics: d.metrics, last_error: d.error ?? null, last_seen: now }).eq('server_id', a.serverId);
        if (d.installed.length) await a.db.from('server_domain_bindings').update({ status: 'installed', installed_at: now, last_error: null }).in('id', d.installed).eq('server_id', a.serverId);
        for (const f of d.failed) await a.db.from('server_domain_bindings').update({ status: 'error', last_error: f.error }).eq('id', f.bindingId).eq('server_id', a.serverId);
        return Response.json({ ok: true });
      },
    },
  },
});
