import { createFileRoute } from '@tanstack/react-router';
import { deliveryBatch } from '@/lib/delivery.schemas';
export const Route = createFileRoute('/api/public/agent/events')({ server:{ handlers:{ POST:async ({request})=>{
  const { agentFromRequest } = await import('@/lib/kumo.server');
  const agent = await agentFromRequest(request);
  if (!agent) return new Response('Unauthorized',{status:401});
  if (Number(request.headers.get('content-length') ?? 0)>1000000) return new Response('Too large',{status:413});
  const body = await request.text();
  if (body.length>1000000) return new Response('Too large',{status:413});
  let raw:unknown; try { raw=JSON.parse(body); } catch { return new Response('Bad request',{status:400}); }
  const parsed = deliveryBatch.safeParse(raw);
  if (!parsed.success) return new Response('Bad request',{status:400});
  const result = await agent.db.rpc('ingest_delivery_events',{_server:agent.serverId,_events:parsed.data.events});
  if (result.error) return new Response('Event batch rejected',{status:422});
  const { fireWebhooks } = await import('@/lib/webhooks.server');
  const byType = new Map<string, typeof parsed.data.events>();
  for (const e of parsed.data.events) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  await Promise.all([...byType].map(([t, evs]) => fireWebhooks(t as any, { server_id: agent.serverId, events: evs.map(e => ({ message_id: e.messageId, occurred_at: e.occurredAt, smtp_code: e.smtpCode ?? null, detail: e.detail })) })));
  return Response.json({accepted:result.data},{headers:{'Cache-Control':'no-store'}});
} } } });