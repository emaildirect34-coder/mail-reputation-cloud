import { createFileRoute } from '@tanstack/react-router';
import { checkPostbackDiagnostic, parsePostback, postbackReferenceFingerprint, purchasePostbackSignal, sha256Hex } from '@/lib/postback';
import { readTrackingBody } from '@/lib/tracking-request';

const answer = (body: string, status = 200) => new Response(body, { status, headers: { 'Cache-Control': 'no-store' } });

// The path token authenticates the sponsor account. New conversions must
// correlate to an independent click ID issued by the campaign redirect.
async function handle(request: Request, token: string) {
  if (!/^p[bt]_[0-9a-f]{48}$/.test(token)) return answer('unauthorized', 401);
  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const tokenHash = await sha256Hex(token);
  const diagnostic = token.startsWith('pt_');
  const key = diagnostic
    ? await db.from('sponsor_postback_diagnostics').select('account_id,expected_event').eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString()).maybeSingle()
    : await db.from('sponsor_postbacks').select('account_id').eq('token_hash', tokenHash).maybeSingle();
  if (key.error) return answer('service indisponible', 503);
  if (!key.data) return answer('unauthorized', 401);
  const accountId = key.data.account_id;
  let reference = '';
  const refuse = async (reason: string, message: string, status: number) => {
    try {
      await db.rpc('log_sponsor_postback_rejection', { _account: accountId, _reason: reason, _reference_hash: reference });
    } catch { /* Keep the original postback response if diagnostics are unavailable. */ }
    return answer(message, status);
  };
  const params = new URL(request.url).searchParams;
  if (request.method === 'POST') {
    const body = await readTrackingBody(request);
    if (!body) return diagnostic ? answer('requête trop volumineuse', 413) : refuse('body', 'requête trop volumineuse', 413);
    new URLSearchParams(new TextDecoder().decode(body)).forEach((value, key) => { if (!params.has(key)) params.set(key, value); });
  }
  if ('expected_event' in key.data && typeof key.data.expected_event === 'string') {
    const failure = checkPostbackDiagnostic(params, token.slice(3, 39), key.data.expected_event);
    const result = await db.from('sponsor_postback_diagnostics')
      .update({ checked_at: new Date().toISOString(), succeeded: !failure, detail: failure })
      .eq('account_id', accountId).eq('token_hash', tokenHash).gt('expires_at', new Date().toISOString())
      .or('succeeded.is.null,succeeded.eq.false');
    return result.error ? answer('service indisponible', 503) : answer(failure ?? 'test ok', failure ? 400 : 200);
  }
  if (diagnostic) return answer('service indisponible', 503);
  const pb = parsePostback(params);
  if ('error' in pb) return refuse(pb.error === 'click_id invalide' ? 'click' : pb.error === 'payout invalide' ? 'amount' : 'payout', pb.error, 400);

  reference = await postbackReferenceFingerprint(accountId, pb.txid);
  const externalId = 'pb:' + pb.txid;

  const [account, click, existing] = await Promise.all([
    db.from('sponsor_accounts').select('currency,created_by').eq('id', accountId).maybeSingle(),
    db.from('campaign_messages').select('campaign_id').eq('verified_click_id', pb.clickId).maybeSingle(),
    db.from('finance_entries').select('campaign_id').eq('account_id', accountId).eq('external_id', externalId).maybeSingle(),
  ]);
  if (account.error || click.error || existing.error) return refuse('service', 'service indisponible', 503);
  if (!account.data) return answer('unauthorized', 401);

  // Allow status changes for existing transactions issued with historical IDs,
  // without opening a new ledger entry from an unsubscribe token.
  let campaignId = click.data?.campaign_id;
  if (!campaignId && existing.data) {
    const old = await db.from('campaign_messages').select('campaign_id').eq('unsub_token', pb.clickId).maybeSingle();
    if (old.error) return refuse('service', 'service indisponible', 503);
    if (old.data?.campaign_id === existing.data.campaign_id) campaignId = old.data?.campaign_id;
  }
  if (!campaignId) return refuse('unknown_click', 'click inconnu', 404);

  const campaign = await db.from('campaigns').select('name,sponsor_offer_id').eq('id', campaignId).maybeSingle();
  if (campaign.error) return refuse('service', 'service indisponible', 503);
  if (!campaign.data) return refuse('unknown_campaign', 'campagne inconnue', 404);
  const offerId = campaign.data.sponsor_offer_id;
  if (offerId) {
    const offer = await db.from('sponsor_offers').select('account_id').eq('id', offerId).maybeSingle();
    if (offer.error) return refuse('service', 'service indisponible', 503);
    if (offer.data?.account_id !== accountId) return refuse('other_account', 'campagne d’un autre compte', 409);
  } else if (!existing.data) {
    return refuse('no_offer', 'campagne sans offre sponsor', 409);
  }

  const signal = purchasePostbackSignal(params);
  const publicUrl = URL.parse(process.env['PURCHASE_PUBLIC_ORIGIN'] ?? 'https://mail-reputation-cloud.lovable.app');
  const entry = {
    _account: accountId, _campaign: campaignId, _offer: click.data ? offerId : null, _external_id: externalId,
    _status: signal.status === 'rejected' ? signal.status : pb.status,
    _amount: pb.amountCents, _currency: pb.currency ?? account.data.currency,
    _description: ('Postback — ' + campaign.data.name).slice(0, 1000), _by: account.data.created_by,
  };
  let recorded = await db.rpc('record_sponsor_purchase_postback', {
    ...entry, _click_id: pb.clickId, _event: signal.event, _purchase_status: signal.status,
    _public_origin: publicUrl?.protocol === 'https:' && !publicUrl.username && !publicUrl.password ? publicUrl.origin : '',
  });
  if (recorded.error?.code === 'PGRST202' || recorded.error?.code === '42883') {
    recorded = await db.rpc('record_sponsor_postback', entry);
  }
  if (recorded.error) return refuse('service', 'service indisponible', 503);
  if (!recorded.data) return refuse('transaction_conflict', 'transaction d’une autre campagne', 409);
  return answer('ok');
}

export const Route = createFileRoute('/api/public/postback/$token')({
  server: { handlers: { GET: ({ request, params }) => handle(request, params.token), POST: ({ request, params }) => handle(request, params.token) } },
});
