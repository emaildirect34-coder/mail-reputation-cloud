import { createFileRoute } from '@tanstack/react-router';
import { parsePostback, sha256Hex } from '@/lib/postback';
import { readTrackingBody } from '@/lib/tracking-request';

const answer = (body: string, status = 200) => new Response(body, { status, headers: { 'Cache-Control': 'no-store' } });

// The path token authenticates the sponsor account. New conversions must
// correlate to an independent click ID issued by the campaign redirect.
async function handle(request: Request, token: string) {
  if (!/^pb_[0-9a-f]{48}$/.test(token)) return answer('unauthorized', 401);
  const params = new URL(request.url).searchParams;
  if (request.method === 'POST') {
    const body = await readTrackingBody(request);
    if (!body) return answer('requête trop volumineuse', 413);
    new URLSearchParams(new TextDecoder().decode(body)).forEach((value, key) => { if (!params.has(key)) params.set(key, value); });
  }
  const pb = parsePostback(params);
  if ('error' in pb) return answer(pb.error, 400);

  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const key = await db.from('sponsor_postbacks').select('account_id').eq('token_hash', await sha256Hex(token)).maybeSingle();
  if (key.error) return answer('service indisponible', 503);
  if (!key.data) return answer('unauthorized', 401);
  const accountId = key.data.account_id;
  const externalId = 'pb:' + pb.txid;

  const [account, click, existing] = await Promise.all([
    db.from('sponsor_accounts').select('currency,created_by').eq('id', accountId).maybeSingle(),
    db.from('campaign_messages').select('campaign_id').eq('verified_click_id', pb.clickId).maybeSingle(),
    db.from('finance_entries').select('campaign_id').eq('account_id', accountId).eq('external_id', externalId).maybeSingle(),
  ]);
  if (account.error || click.error || existing.error) return answer('service indisponible', 503);
  if (!account.data) return answer('unauthorized', 401);

  // Allow status changes for existing transactions issued with historical IDs,
  // without opening a new ledger entry from an unsubscribe token.
  let campaignId = click.data?.campaign_id;
  if (!campaignId && existing.data) {
    const old = await db.from('campaign_messages').select('campaign_id').eq('unsub_token', pb.clickId).maybeSingle();
    if (old.error) return answer('service indisponible', 503);
    if (old.data?.campaign_id === existing.data.campaign_id) campaignId = old.data?.campaign_id;
  }
  if (!campaignId) return answer('click inconnu', 404);

  const campaign = await db.from('campaigns').select('name,sponsor_offer_id').eq('id', campaignId).maybeSingle();
  if (campaign.error) return answer('service indisponible', 503);
  if (!campaign.data) return answer('campagne inconnue', 404);
  const offerId = campaign.data.sponsor_offer_id;
  if (offerId) {
    const offer = await db.from('sponsor_offers').select('account_id').eq('id', offerId).maybeSingle();
    if (offer.error) return answer('service indisponible', 503);
    if (offer.data?.account_id !== accountId) return answer('campagne d’un autre compte', 409);
  } else if (!existing.data) {
    return answer('campagne sans offre sponsor', 409);
  }

  const recorded = await db.rpc('record_sponsor_postback', {
    _account: accountId, _campaign: campaignId, _offer: click.data ? offerId : null, _external_id: externalId,
    _status: pb.status, _amount: pb.amountCents, _currency: pb.currency ?? account.data.currency,
    _description: ('Postback — ' + campaign.data.name).slice(0, 1000), _by: account.data.created_by,
  });
  if (recorded.error) return answer('service indisponible', 503);
  if (!recorded.data) return answer('transaction d’une autre campagne', 409);
  return answer('ok');
}

export const Route = createFileRoute('/api/public/postback/$token')({
  server: { handlers: { GET: ({ request, params }) => handle(request, params.token), POST: ({ request, params }) => handle(request, params.token) } },
});
