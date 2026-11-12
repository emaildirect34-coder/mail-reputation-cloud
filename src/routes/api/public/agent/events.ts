import { createFileRoute } from '@tanstack/react-router';
import { deliveryBatch } from '@/lib/delivery.schemas';
import { z } from 'zod';

const batch = z.object({
  scanThrough: z.string().datetime({ offset: true }).optional(),
  events: deliveryBatch.shape.events.min(0),
  receptions: z.array(z.object({
    messageId: z.string().uuid(), recipient: z.string().trim().min(1).max(320),
    occurredAt: z.string().datetime({ offset: true }),
  })).max(500).default([]),
}).refine(value => value.scanThrough
  ? value.events.length + value.receptions.length === 0
  : value.events.length + value.receptions.length > 0 && value.events.length + value.receptions.length <= 500);
export const Route = createFileRoute('/api/public/agent/events')({ server:{ handlers:{ POST:async ({request})=>{
  const { agentFromRequest } = await import('@/lib/kumo.server');
  const agent = await agentFromRequest(request);
  if (!agent) return new Response('Unauthorized',{status:401});
  if (Number(request.headers.get('content-length') ?? 0)>1000000) return new Response('Too large',{status:413});
  const body = await request.text();
  if (body.length>1000000) return new Response('Too large',{status:413});
  let raw:unknown; try { raw=JSON.parse(body); } catch { return new Response('Bad request',{status:400}); }
  const parsed = batch.safeParse(raw);
  if (!parsed.success) return new Response('Bad request',{status:400});
  if (parsed.data.scanThrough) {
    const scanned = await agent.db.rpc('record_agent_smtp_scan', { _server: agent.serverId, _through: parsed.data.scanThrough });
    if (scanned.error?.code === 'PGRST202') return new Response('Scan reporting unavailable', { status: 400 });
    if (scanned.error || !scanned.data) return new Response('Scan not acknowledged', { status: 503 });
    return Response.json({ accepted: 0 }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const { acceptedDeliveryEvents } = await import('@/lib/delivery-events.server');
  let events: Awaited<ReturnType<typeof acceptedDeliveryEvents>>;
  try {
    events = await acceptedDeliveryEvents(parsed.data.events, process.env['BOUNCE_HMAC_KEY'], async ids => {
      const recipients = new Map<string, string>();
      for (let offset = 0; offset < ids.length; offset += 100) {
        const result = await agent.db.from('campaign_messages').select('id,email')
          .eq('server_id', agent.serverId).in('id', ids.slice(offset, offset + 100));
        if (result.error) throw new Error('Could not verify DSN recipients');
        for (const row of result.data) recipients.set(row.id, row.email);
      }
      return recipients;
    });
  } catch {
    return new Response('Event verification unavailable', { status: 503 });
  }
  if (parsed.data.receptions.length) {
    const recovery = await agent.db.rpc('reconcile_campaign_injections', { _server: agent.serverId, _receipts: parsed.data.receptions });
    if (recovery.error) return new Response('Injection reconciliation unavailable', { status: 503 });
  }
  if (!events.length) return Response.json({ accepted: 0 }, { headers: { 'Cache-Control': 'no-store' } });
  const args = { _server: agent.serverId, _events: events };
  const result = events.some(event => event.sourceIpv4)
    ? await agent.db.rpc('ingest_attributed_delivery_events', args)
    : await agent.db.rpc('ingest_delivery_events', args);
  if (result.error) return new Response('Event batch rejected',{status:422});
  const { fireWebhooks } = await import('@/lib/webhooks.server');
  const byType = new Map<string, typeof events>();
  for (const e of events) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  await Promise.all([...byType].map(([t, evs]) => fireWebhooks(t as any, { server_id: agent.serverId, events: evs.map(e => ({ message_id: e.messageId, occurred_at: e.occurredAt, smtp_code: e.smtpCode ?? null, detail: e.detail })) })));
  return Response.json({accepted:result.data},{headers:{'Cache-Control':'no-store'}});
} } } });
