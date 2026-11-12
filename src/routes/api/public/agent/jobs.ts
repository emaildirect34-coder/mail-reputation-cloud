import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const results = z.object({ results: z.array(z.object({
  id: z.string().uuid(), ok: z.boolean(), uncertain: z.literal(true).optional(), error: z.string().max(300).optional(),
}).refine(row => !row.ok || !row.uncertain)).max(500) });

// Agent pulls messages to inject into its local KumoMTA, then reports the outcome.
export const Route = createFileRoute('/api/public/agent/jobs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { agentFromRequest } = await import('@/lib/kumo.server');
        const a = await agentFromRequest(request);
        if (!a) return new Response('Unauthorized', { status: 401 });
        const requested = new URL(request.url).searchParams.get('limit');
        const count = requested && /^\d+$/.test(requested) ? Math.max(1, Math.min(200, Number(requested))) : 200;
        const claimed = await a.db.rpc('claim_campaign_messages', { _server: a.serverId, _limit: count });
        if (claimed.error) return new Response('Error', { status: 500 });
        const msgs = claimed.data ?? [];
        const ids = [...new Set(msgs.map(m => m.campaign_id))];
        const campaignFields = 'id,from_name,from_email,reply_to,subject,html,ab_variants,ab_winner,list_id';
        const campaigns = async () => {
          if (!ids.length) return [];
          const preflight = await a.db.from('campaigns').select(`${campaignFields},vmta_pool_id,amp_html,purchase_thank_you,placement_probe_token,placement_probe_of`).in('id', ids);
          if (!preflight.error) return preflight.data ?? [];
          if (preflight.error.code !== '42703') throw new Error('Campaign query failed');
          const purchase = await a.db.from('campaigns').select(`${campaignFields},vmta_pool_id,amp_html,purchase_thank_you`).in('id', ids);
          if (!purchase.error) return purchase.data ?? [];
          if (purchase.error.code !== '42703') throw new Error('Campaign query failed');
          const current = await a.db.from('campaigns').select(`${campaignFields},vmta_pool_id,amp_html`).in('id', ids);
          if (current.error?.code !== '42703') {
            if (current.error) throw new Error('Campaign query failed');
            return (current.data ?? []).map(campaign => ({ ...campaign, purchase_thank_you: false }));
          }
          const result = await a.db.from('campaigns').select(`${campaignFields},vmta_pool_id`).in('id', ids);
          if (result.error?.code !== '42703') {
            if (result.error) throw new Error('Campaign query failed');
            return (result.data ?? []).map(campaign => ({ ...campaign, amp_html: null, purchase_thank_you: false }));
          }
          const legacy = await a.db.from('campaigns').select(campaignFields).in('id', ids);
          if (legacy.error) throw new Error('Campaign query failed');
          return (legacy.data ?? []).map(campaign => ({ ...campaign, vmta_pool_id: null, amp_html: null, purchase_thank_you: false }));
        };
        const [camps, codes] = await Promise.all([
          campaigns(),
          msgs.length ? a.db.rpc('read_agent_sender_profile_codes', { _server: a.serverId, _ids: msgs.map(message => message.id) }) : null,
        ]);
        if (codes?.error && codes.error.code !== 'PGRST202') return new Response('Error', { status: 500 });
        const codesByMessage = new Map(codes?.data?.map(item => [item.message_id, item.code]));
        const probeIds = camps.flatMap(c => 'placement_probe_of' in c && typeof c.placement_probe_of === 'string' ? [c.placement_probe_of] : []);
        const probeHeaders = probeIds.length
          ? await a.db.from('campaigns').select('id,list_id').in('id', probeIds) : null;
        if (probeHeaders?.error) throw new Error('Placement campaign headers unavailable');
        const { renderMessage, pickCampaignVariant } = await import('@/lib/sending.server');
        const { bounceAddress } = await import('@/lib/bounce-token.server');
        const origin = new URL(request.url).origin;
        const fromDomains = [...new Set(camps.map((c: any) => String(c.from_email).split('@')[1]))];
        const doms = fromDomains.length ? (await (a.db as any).from('sending_domains').select('domain,tracking_host').in('domain', fromDomains)).data ?? [] : [];
        const trackFor = (email: string) => { const h = doms.find((x: any) => x.domain === email.split('@')[1])?.tracking_host; return h ? `https://${h}` : origin; };
        const jobs = (await Promise.all(msgs.map(async m => {
          const c = camps.find((x: any) => x.id === m.campaign_id);
          if (!c) return null;
          const domain = c.from_email.split('@')[1];
          if (!domain) return null;
          const sender = await bounceAddress(m.id, domain, process.env['BOUNCE_HMAC_KEY']);
          const original = 'placement_probe_of' in c && probeHeaders?.data?.find(row => row.id === c.placement_probe_of);
          const verificationCode = codesByMessage.get(m.id);
          const source = verificationCode && /^[0-9]{8}$/.test(verificationCode)
            ? { ...c, sender_verification: true, html: `<p>Votre code de vérification Email Direct est <strong>${verificationCode}</strong>.</p><p>Ce code expire dans 15 minutes.</p>` }
            : original ? { ...c, ...original } : c;
          const content = renderMessage(pickCampaignVariant(source, m.variant), m, origin, trackFor(c.from_email));
          return { id: m.id, campaignId: c.id, vmtaPoolId: c.vmta_pool_id, sender, rcpt: m.email, content,
            ...(m.claimed_revision ? { approvalRevision: m.claimed_revision } : {}),
          };
        }))).filter(job => job !== null);
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
          const updated = await a.db.from('campaign_messages').update({ status: 'sent', sent_at: now, injection_uncertain_at: null, error: null })
            .in('id', ok).eq('server_id', a.serverId).or('status.eq.claimed,injection_uncertain_at.not.is.null');
          if (updated.error) return new Response('Error',{status:500});
        }
        for (const r of p.data.results.filter(r => !r.ok)) {
          const uncertain = r.uncertain || r.error === 'Injection KumoMTA non confirmée';
          const updated = await a.db.from('campaign_messages').update({
            status: 'failed', error: uncertain ? 'Injection KumoMTA à vérifier' : r.error ?? 'injection refusée',
            ...(uncertain ? { injection_uncertain_at: now } : {}),
          }).eq('id', r.id).eq('server_id', a.serverId).eq('status','claimed');
          if (updated.error) return new Response('Error',{status:500});
        }
        // Close campaigns with nothing left to send
        const touched = await a.db.from('campaign_messages').select('campaign_id').in('id', p.data.results.map(r => r.id)).eq('server_id',a.serverId);
        if (touched.error) return new Response('Error',{status:500});
        for (const cid of new Set((touched.data ?? []).map(t => t.campaign_id))) {
          const close = await a.db.rpc('close_campaign_if_idle', { _campaign: cid, _server: a.serverId });
          if (!close.error) continue;
          if (close.error.code !== 'PGRST202') return new Response('Error', { status: 500 });
          const left = await a.db.from('campaign_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', cid)
            .or('status.in.(queued,claimed),injection_uncertain_at.not.is.null');
          if (left.count === 0) await a.db.from('campaigns').update({ status: 'done' }).eq('id', cid).eq('status', 'queued');
        }
        return Response.json({ ok: true });
      },
    },
  },
});
