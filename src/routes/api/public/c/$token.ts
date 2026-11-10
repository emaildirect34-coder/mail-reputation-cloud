import { createFileRoute } from '@tanstack/react-router';
import { activatedNavigation, isTemplateLink, localForm, messageToken, readTrackingForm, singleFormValue, trackingPageHeaders } from '@/lib/tracking-request';
import { fillClickId, hasClickId } from '@/lib/postback';

const invalid = () => new Response('Lien invalide', { status: 404, headers: { 'Cache-Control': 'no-store' } });
const unavailable = () => new Response('Lien temporairement indisponible', { status: 503, headers: { 'Cache-Control': 'no-store' } });
const confirmation = () => new Response(
  '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ouvrir le lien</title></head><body><h1>Ouvrir le lien</h1><form method="post"><button name="continue" value="yes">Continuer vers le site partenaire</button></form></body></html>',
  { headers: trackingPageHeaders },
);

async function follow(request: Request, token: string) {
  const destination = new URL(request.url).searchParams.get('u') ?? '';
  if (!messageToken.test(token) || destination.length > 2000 || !/^https?:\/\//.test(destination) || /[\x00-\x20\x7f]/.test(destination)) return invalid();
  try {
    const url = new URL(destination);
    if (url.username || url.password) return invalid();
  } catch {
    return invalid();
  }

  const confirm = request.method === 'POST';
  const qualified = confirm
    ? localForm(request.headers) && singleFormValue(await readTrackingForm(request), 'continue', 'yes')
    : request.method === 'GET' && activatedNavigation(request.headers);
  if (confirm && !qualified) return new Response('Confirmation requise', { status: 400, headers: { 'Cache-Control': 'no-store' } });

  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const message = await db.from('campaign_messages').select('id,campaign_id,email,first_name,variant').eq('unsub_token', token).maybeSingle();
  if (message.error) return unavailable();
  if (!message.data) return invalid();
  const campaign = await db.from('campaigns').select('html,subject,from_name,from_email,sponsor_offer_id,ab_variants,ab_winner').eq('id', message.data.campaign_id).maybeSingle();
  if (campaign.error) return unavailable();
  if (!campaign.data) return invalid();
  const { expandCampaignHtml, pickCampaignVariant } = await import('@/lib/sending.server');
  const rendered = pickCampaignVariant(campaign.data, message.data.variant);
  if (!isTemplateLink(expandCampaignHtml(rendered, message.data), destination)) return invalid();

  const sponsored = !!campaign.data.sponsor_offer_id && hasClickId(destination);
  if (sponsored && !qualified) return confirmation();

  let clickId = '';
  if (qualified) {
    const click = await db.rpc('register_verified_campaign_click', { _id: message.data.id });
    if (sponsored && (click.error || !click.data)) return unavailable();
    if (sponsored) clickId = click.data ?? '';
  }

  return new Response(null, { status: confirm ? 303 : 302, headers: {
    Location: fillClickId(destination, clickId), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  } });
}

// Public links are limited to campaign content. Only affirmative navigation
// exposes the independent sponsor click ID.
export const Route = createFileRoute('/api/public/c/$token')({
  server: { handlers: {
    GET: ({ params, request }) => follow(request, params.token),
    POST: ({ params, request }) => follow(request, params.token),
  } },
});
