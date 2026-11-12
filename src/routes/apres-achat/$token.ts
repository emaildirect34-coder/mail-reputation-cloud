import { createFileRoute } from '@tanstack/react-router';
import { campaignTopics, campaignTopicLabels, isCampaignTopic } from '@/lib/campaign-topics';
import { sha256Hex } from '@/lib/postback';
import { purchaseConsentText, purchaseReviewUrl } from '@/lib/sponsor-buyers';
import { parseSponsorPreference, sponsorPreferenceForms } from '@/lib/sponsor-preferences';
import { localForm, readTrackingForm, singleFormValue, trackingPageHeaders } from '@/lib/tracking-request';

const headers = { ...trackingPageHeaders, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const escapeAttr = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function page(content: string, status = 200) {
  return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>Après votre achat · Email Direct</title>
  <style>
    *{box-sizing:border-box}body{font:16px/1.55 system-ui,sans-serif;background:#eff5ff;color:#17294a;margin:0}
    main{max-width:660px;margin:7vh auto;padding:32px;background:white;border:1px solid #d8e5f6;border-radius:20px}
    h1,h2{line-height:1.2}section+section{margin-top:28px;border-top:1px solid #d8e5f6;padding-top:14px}
    fieldset{border:1px solid #d8e5f6;border-radius:8px;margin:14px 0;padding:10px 14px}
    label{display:block;padding:3px 0}a{color:#164bb2}button{background:#164bb2;color:white;border:0;border-radius:8px;padding:12px 16px;font:inherit;cursor:pointer}
    @media(max-width:700px){main{margin:16px;padding:22px}}
  </style><main><h1>Merci pour votre achat</h1>${content}</main></html>`, { headers, status });
}

const unavailable = () => page('<p>Ce lien est indisponible ou a expiré.</p>', 404);

async function handle(request: Request, token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return unavailable();
  const hash = await sha256Hex(token);
  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const back = () => new Response(null, { status: 303, headers: { Location: '/apres-achat/' + token, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  if (request.method === 'POST') {
    if (!localForm(request.headers)) return page('<p>Requête refusée.</p>', 403);
    const form = await readTrackingForm(request);
    if (singleFormValue(form, 'action', 'review')) {
      const ratings = form?.getAll('rating') ?? [];
      const comments = form?.getAll('comment') ?? [];
      const rating = ratings[0];
      const comment = comments[0] ?? '';
      if (ratings.length !== 1 || typeof rating !== 'string' || !/^[1-5]$/.test(rating)
        || comments.length > 1 || typeof comment !== 'string' || comment.length > 500) {
        return page('<p>Choisissez une note de 1 à 5 et saisissez au maximum 500 caractères.</p><p><a href="">Revenir à la page</a></p>', 400);
      }
      const result = await db.rpc('record_sponsor_purchase_review', { _hash: hash, _rating: Number(rating), _comment: comment });
      if (result.error) return page('<p>L’enregistrement de l’avis est momentanément indisponible.</p>', 503);
      return result.data ? page('<p>Votre avis a été enregistré.</p><p><a href="">Revenir à vos préférences</a></p>') : unavailable();
    }
    if (singleFormValue(form, 'action', 'sponsor')) {
      const sponsor = parseSponsorPreference(form);
      if (!sponsor) return page('<p>Choix de marque invalide.</p><p><a href="">Revenir à la page</a></p>', 400);
      const result = await db.rpc('set_recipient_sponsor_option', { _token: hash, _scope: 'purchase', _brand: sponsor.id, _blocked: sponsor.blocked });
      if (result.error) return page('<p>Le service est temporairement indisponible. Vous pourrez réessayer.</p>', 503);
      return result.data === 'saved' ? back() : unavailable();
    }
    const topics = form?.getAll('topic') ?? [];
    const weekly = singleFormValue(form, 'rhythm', 'weekly');
    if (!singleFormValue(form, 'consent', 'yes') || !topics.length || !topics.every(isCampaignTopic) ||
        new Set(topics).size !== topics.length || (!weekly && !singleFormValue(form, 'rhythm', 'standard'))) {
      return page('<p>Cochez votre accord, puis choisissez au moins une catégorie et un rythme.</p><p><a href="">Revenir à la page</a></p>', 400);
    }
    const result = await db.rpc('confirm_purchase_offers', { _hash: hash, _topics: topics, _weekly: weekly, _statement: purchaseConsentText });
    if (result.error) return page('<p>Le service est temporairement indisponible. Vous pourrez réessayer.</p>', 503);
    if (result.data !== 'confirmed') return unavailable();
    return back();
  }

  const result = await db.rpc('read_purchase_feedback', { _hash: hash }).maybeSingle();
  if (result.error) return page('<p>Le service est temporairement indisponible.</p>', 503);
  if (!result.data) return unavailable();
  const review = result.data.review_url && purchaseReviewUrl(result.data.review_url);
  const feedback = `<section><h2>Votre avis sur l’achat</h2>
    ${review ? `<p><a href="${escapeAttr(review)}" rel="noreferrer">Raconter mon expérience sur la page du partenaire</a></p>` : ''}
    <form method="post"><input type="hidden" name="action" value="review">
    <label>Note sur 5 <select required name="rating"><option value="">Choisir une note</option>
    <option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
    <label>Commentaire (facultatif)<textarea name="comment" maxlength="500" rows="3"></textarea></label>
    <button type="submit">Enregistrer mon avis</button></form></section>`;
  const preferences = result.data.confirmed ? '<p>Votre inscription et vos préférences ont été enregistrées.</p>' :
    result.data.can_subscribe ? `<section><h2>Recevoir les prochaines offres</h2><form method="post">
      <label><input type="checkbox" name="consent" value="yes" required> ${purchaseConsentText}</label>
      <fieldset><legend>Les catégories qui m’intéressent</legend>
      ${campaignTopics.map(topic => `<label><input type="checkbox" name="topic" value="${topic}"> ${campaignTopicLabels[topic]}</label>`).join('')}</fieldset>
      <fieldset><legend>Mon rythme</legend>
        <label><input type="radio" name="rhythm" value="weekly" required> Au maximum un e-mail par semaine</label>
        <label><input type="radio" name="rhythm" value="standard" required> Au rythme habituel des offres</label>
      </fieldset><button>Confirmer mon inscription</button></form></section>` : '';
  const sponsors = await db.rpc('read_recipient_sponsor_options', { _token: hash, _scope: 'purchase' });
  return page(feedback + preferences + sponsorPreferenceForms(sponsors.data ?? []) || '<p>Nous vous remercions pour votre confiance.</p>');
}

export const Route = createFileRoute('/apres-achat/$token')({
  server: { handlers: {
    GET: ({ request, params }) => handle(request, params.token),
    POST: ({ request, params }) => handle(request, params.token),
  } },
});
