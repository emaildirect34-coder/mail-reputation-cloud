import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const results = z.object({ results: z.array(z.object({ id: z.string().uuid(), ok: z.boolean(), error: z.string().max(300).optional() })).max(500) });

// Agent pulls messages to inject into its local KumoMTA, then reports the outcome.
export const Route = createFileRoute('/api/public/agent/jobs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { agentFromRequest } = await import('@/lib/kumo.server');
        const a = await agentFromRequest(request);
        if (!a) return new Response('Unauthorized', { status: 401 });
        const claimed = await a.db.rpc('claim_campaign_messages', { _server: a.serverId, _limit: 200 });
        if (claimed.error) return new Response('Error', { status: 500 });
        const msgs = claimed.data ?? [];
        const ids = [...new Set(msgs.map(m => m.campaign_id))];
        const camps = ids.length ? (await a.db.from('campaigns').select('id,from_name,from_email,reply_to,subject,html,ab_variants,ab_winner').in('id', ids)).data ?? [] : [];
        // A/B: the message's variant overrides subject / sender name.
        const pick = (c: any, v: number | null) => { const x = Array.isArray(c.ab_variants) ? c.ab_variants[v ?? c.ab_winner ?? 0] : null; return x ? { ...c, subject: x.subject || c.subject, from_name: x.fromName || c.from_name } : c; };
        const { renderMessage } = await import('@/lib/sending.server');
        const origin = new URL(request.url).origin;
        const jobs = msgs.flatMap(m => { const c = camps.find(x => x.id === m.campaign_id); return c ? [{ id: m.id, sender: `bounce+${m.id}@${c.from_email.split('@')[1]}`, rcpt: m.email, content: renderMessage(pick(c, (m as any).variant), m, origin) }] : []; });
        return Response.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } });
      },
      POST: async ({ request }) => {
        const { agentFromRequest } = await import('@/lib/kumo.server');
        const a = await agentFromRequest(request);
        if (!a) return new Response('Unauthorized', { status: 401 });
        const p = results.safeParse(await request.json().catch(() => null));
        if (!p.success) return new Response('Bad request', { status: 400 });
        const now = new Date().toISOString();
        const ok = p.data.results.filter(r => r.ok).map(r => r.id);
        if (ok.length) {
          const updated = await a.db.from('campaign_messages').update({ status: 'sent', sent_at: now }).in('id', ok).eq('server_id', a.serverId).eq('status','claimed');
          if (updated.error) return new Response('Error',{status:500});
        }
        for (const r of p.data.results.filter(r => !r.ok)) {
          const updated = await a.db.from('campaign_messages').update({ status: 'failed', error: r.error ?? 'injection refusée' }).eq('id', r.id).eq('server_id', a.serverId).eq('status','claimed');
          if (updated.error) return new Response('Error',{status:500});
        }
        // Close campaigns with nothing left to send
        const touched = await a.db.from('campaign_messages').select('campaign_id').in('id', p.data.results.map(r => r.id)).eq('server_id',a.serverId);
        if (touched.error) return new Response('Error',{status:500});
        for (const cid of new Set((touched.data ?? []).map(t => t.campaign_id))) {
          const left = await a.db.from('campaign_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).in('status', ['queued', 'claimed']);
          if (left.count === 0) await a.db.from('campaigns').update({ status: 'done' }).eq('id', cid).eq('status', 'queued');
        }
        return Response.json({ ok: true });
      },
    },
  },
});
