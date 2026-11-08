import { createFileRoute } from '@tanstack/react-router';
import { parsePostback, sha256Hex } from '@/lib/postback';

// S2S conversion postback. The path token identifies & authenticates the sponsor account (stored hashed).
async function handle(request: Request, token: string) {
  if (!/^pb_[0-9a-f]{48}$/.test(token)) return new Response('unauthorized', { status: 401 });
  const params = new URL(request.url).searchParams;
  if (request.method === 'POST') { try { const b = new URLSearchParams(await request.text()); b.forEach((v, k) => { if (!params.has(k)) params.set(k, v); }); } catch { /* ignore */ } }
  const pb = parsePostback(params);
  if ('error' in pb) return new Response(pb.error, { status: 400 });
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const db = supabaseAdmin as any;
  const key = await db.from('sponsor_postbacks').select('account_id,hits').eq('token_hash', await sha256Hex(token)).maybeSingle();
  if (!key.data) return new Response('unauthorized', { status: 401 });
  const acc = await db.from('sponsor_accounts').select('id,currency,created_by').eq('id', key.data.account_id).single();
  const msg = await db.from('campaign_messages').select('campaign_id').eq('unsub_token', pb.clickId).maybeSingle();
  if (!msg.data) return new Response('click inconnu', { status: 404 });
  const camp = await db.from('campaigns').select('id,name,sponsor_offer_id').eq('id', msg.data.campaign_id).single();
  let offerId: string | null = null;
  if (camp.data?.sponsor_offer_id) { const o = await db.from('sponsor_offers').select('id,account_id').eq('id', camp.data.sponsor_offer_id).single(); if (o.data && o.data.account_id !== acc.data.id) return new Response('campagne d’un autre compte', { status: 409 }); offerId = o.data?.id ?? null; }
  const row = { account_id: acc.data.id, campaign_id: camp.data?.id ?? null, offer_id: offerId, external_id: 'pb:' + pb.txid, kind: 'revenue', status: pb.status, amount_cents: pb.amountCents, currency: pb.currency ?? acc.data.currency, category: 'Conversion', description: `Postback — ${camp.data?.name ?? ''}`.slice(0, 1000), occurred_on: new Date().toISOString().slice(0, 10), source: 'api', created_by: acc.data.created_by };
  // Same txid replayed: only status/amount update, never a duplicate.
  const r = await db.from('finance_entries').upsert(row, { onConflict: 'account_id,external_id' });
  if (r.error) return new Response('erreur', { status: 500 });
  await db.from('sponsor_postbacks').update({ hits: (key.data.hits ?? 0) + 1, last_at: new Date().toISOString() }).eq('account_id', acc.data.id);
  return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
}
export const Route = createFileRoute('/api/public/postback/$token')({
  server: { handlers: { GET: ({ request, params }) => handle(request, params.token), POST: ({ request, params }) => handle(request, params.token) } },
});
