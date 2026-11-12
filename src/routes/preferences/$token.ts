import { createFileRoute } from '@tanstack/react-router';
import { campaignTopics, campaignTopicLabels, isCampaignTopic, parseTopicPreferences } from '@/lib/campaign-topics';
import { parseSponsorPreference, sponsorPreferenceForms } from '@/lib/sponsor-preferences';

const tokenPattern = /^[a-f0-9]{36}$/;
const noncePattern = /^[a-f0-9]{32}$/;
const cookieName = 'ed_preference_form';
const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));
}

function page(title: string, body: string, status = 200, cookie?: string) {
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:1rem/1.55 system-ui,sans-serif;background:#f5f7fa;color:#17263d;margin:0}main{max-width:34rem;margin:8vh auto;padding:2rem;background:white;border:1px solid #dbe2ee;border-radius:1rem}h1{font-size:1.5rem}fieldset{margin:1.5rem 0;border:1px solid #dbe2ee}label{display:block;padding:.45rem}button{padding:.65rem 1rem;border:0;border-radius:.5rem;background:#193b75;color:white;font:inherit;cursor:pointer}a{color:#14376f}small{display:block;margin-top:1rem}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`, {
    status, headers: cookie ? { ...headers, 'Set-Cookie': cookie } : headers,
  });
}

const invalid = () => page('Lien invalide', '<p>Ce lien de préférences est indisponible.</p>', 404);
const unavailable = () => page('Préférences indisponibles', '<p>Veuillez réessayer plus tard.</p>', 503);

async function limitedForm(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let bytes = 0;
  let body = '';
  const decode = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1024) { await reader.cancel(); return null; }
      body += decode.decode(next.value, { stream: true });
    }
    return new URLSearchParams(body + decode.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export const Route = createFileRoute('/preferences/$token')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { token } = params;
        if (!tokenPattern.test(token)) return invalid();
        const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
        const { data, error } = await db.rpc('read_recipient_preferences', { _token: token });
        if (error) return unavailable();
        if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
        if (data['suppressed'] === true) return page('Adresse exclue des campagnes', '<p>Cette adresse ne reçoit plus d’envois de campagne.</p>');
        const brand = typeof data['brand'] === 'string' ? escapeHtml(data['brand']) : '';
        const current = data['digest'] === true ? 'Récapitulatif hebdomadaire uniquement.'
          : data['weekly'] === true ? 'Maximum un nouvel envoi de campagne sur sept jours.' : 'Fréquence habituelle.';
        const snoozedUntil = typeof data['snoozed_until'] === 'string' ? Date.parse(data['snoozed_until']) : NaN;
        const pause = Number.isFinite(snoozedUntil)
          ? `Pause jusqu’au ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(snoozedUntil)} (UTC).`
          : 'Aucune pause active.';
        const selectedTopics = Array.isArray(data['topics']) ? data['topics'].filter(isCampaignTopic) : [];
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        const path = `/preferences/${token}`;
        const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
        const cookie = `${cookieName}=${nonce}; Path=${path}; Max-Age=1200; SameSite=Strict; HttpOnly${secure}`;
        const sponsors = await db.rpc('read_recipient_sponsor_options', { _token: token, _scope: 'campaign' });
        return page('Mes préférences e-mail', `
          ${brand ? `<p><strong>${brand}</strong></p>` : ''}<p>Votre fréquence actuelle est affichée ci-dessous.</p><p>${current}</p>
          <form method="post" action="${path}">
            <input type="hidden" name="nonce" value="${nonce}">
            <input type="hidden" name="action" value="snooze">
            <fieldset><legend>Mettre les envois en pause</legend>
              <p>${pause}</p>
              <label><input type="radio" name="days" value="30" required> Pause de 30 jours</label>
              <label><input type="radio" name="days" value="60" required> Pause de 60 jours</label>
              ${Number.isFinite(snoozedUntil) ? '<label><input type="radio" name="days" value="0" required> Reprendre les envois</label>' : ''}
            </fieldset>
            <button type="submit">Enregistrer ma pause</button>
            <small>Les campagnes qui tombent pendant la pause sont ignorées. Vos autres préférences restent actives.</small>
          </form>
          <form method="post" action="${path}">
            <input type="hidden" name="nonce" value="${nonce}">
            <input type="hidden" name="action" value="cadence">
            <fieldset><legend>Choisir ma fréquence</legend>
              <label><input type="radio" name="cadence" value="weekly" required> Maximum un nouvel envoi de campagne sur sept jours</label>
              <label><input type="radio" name="cadence" value="digest" required> Récapitulatif hebdomadaire uniquement</label>
              <label><input type="radio" name="cadence" value="standard" required> Fréquence habituelle</label>
            </fieldset>
            <button type="submit">Enregistrer ma fréquence</button>
          </form>
          <form method="post" action="${path}">
            <input type="hidden" name="nonce" value="${nonce}">
            <input type="hidden" name="action" value="topics">
            <fieldset><legend>Choisir mes centres d’intérêt</legend>
              <p>Sélection actuelle. ${selectedTopics.length ? selectedTopics.map(topic => campaignTopicLabels[topic]).join(', ') : 'Tous les thèmes'}</p>
              <label><input type="radio" name="mode" value="all" required> Tous les thèmes</label>
              <label><input type="radio" name="mode" value="selected" required> Uniquement les thèmes cochés</label>
              ${campaignTopics.map(topic => `<label><input type="checkbox" name="topic" value="${topic}"${selectedTopics.includes(topic) ? ' checked' : ''}> ${campaignTopicLabels[topic]}</label>`).join('')}
            </fieldset>
            <button type="submit">Enregistrer mes centres d’intérêt</button>
          </form>
          <small>Vos centres d’intérêt s’appliquent aux campagnes associées à un thème. Les campagnes sans thème suivent votre fréquence habituelle ou hebdomadaire.</small>
          ${sponsorPreferenceForms(sponsors.data ?? [], nonce)}
          <small>Le réglage s’applique aux nouveaux envois. Les messages déjà confiés au serveur d’envoi peuvent encore arriver.</small>
          <p><a href="/api/public/unsub/${token}">Me désinscrire entièrement</a></p>
        `, 200, cookie);
      },
      POST: async ({ request, params }) => {
        const { token } = params;
        if (!tokenPattern.test(token)) return invalid();
        const path = `/preferences/${token}`;
        const expired = () => page('Formulaire expiré', `<p><a href="${path}">Ouvrir de nouveau mes préférences</a></p>`, 400);
        if (request.headers.get('sec-fetch-site') === 'cross-site') return expired();
        const form = await limitedForm(request);
        const cookie = request.headers.get('cookie')?.split(';').map(part => part.trim())
          .find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
        if (!form || !cookie || !noncePattern.test(cookie) || form.getAll('nonce').length !== 1 || form.get('nonce') !== cookie) return expired();
        const action = form.get('action');
        if (form.getAll('action').length !== 1 || (action !== 'cadence' && action !== 'topics' && action !== 'snooze' && action !== 'sponsor')) return expired();
        const days = form.get('days');
        if (action === 'snooze' && (form.getAll('days').length !== 1 || (days !== '0' && days !== '30' && days !== '60'))) return expired();
        const cadence = form.get('cadence');
        if (action === 'cadence' && (form.getAll('cadence').length !== 1 || (cadence !== 'weekly' && cadence !== 'standard' && cadence !== 'digest'))) return expired();
        const topics = action === 'topics' ? parseTopicPreferences(form) : null;
        if (topics === undefined) return page('Sélection invalide', `<p>Pour limiter les thèmes, cochez au moins un centre d’intérêt.</p><p><a href="${path}">Revenir à mes préférences</a></p>`, 400);
        const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
        const sponsor = action === 'sponsor' ? parseSponsorPreference(form) : null;
        if (action === 'sponsor' && !sponsor) return expired();
        const { data, error } = sponsor
          ? await db.rpc('set_recipient_sponsor_option', { _token: token, _scope: 'campaign', _brand: sponsor.id, _blocked: sponsor.blocked })
          : action === 'topics'
          ? await db.rpc('set_recipient_topics', { _token: token, _topics: topics })
          : action === 'snooze' ? await db.rpc('set_recipient_snooze', { _token: token, _days: Number(days) })
          : cadence === 'digest' ? await db.rpc('set_recipient_digest', { _token: token })
          : await db.rpc('set_recipient_preferences', { _token: token, _weekly: cadence === 'weekly' });
        if (error) return unavailable();
        if (data === 'invalid') return invalid();
        if (data === 'suppressed') return page('Adresse exclue des campagnes', '<p>Cette adresse ne reçoit plus d’envois de campagne.</p>');
        if (data !== 'saved') return unavailable();
        const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
        const summary = sponsor
          ? (sponsor.blocked ? 'Les offres de cette marque sont arrêtées.' : 'Le blocage de cette marque a été retiré.')
          : action === 'topics'
          ? (topics ? `Thèmes sélectionnés. ${topics.map(topic => campaignTopicLabels[topic]).join(', ')}.` : 'Tous les thèmes.')
          : action === 'snooze' ? (days === '0' ? 'Les envois reprennent selon vos préférences.' : `Envois en pause pendant ${Number(days)} jours.`)
          : cadence === 'digest' ? 'Vous recevrez uniquement le récapitulatif hebdomadaire.'
          : (cadence === 'weekly' ? 'Maximum un nouvel envoi de campagne sur sept jours.' : 'Fréquence habituelle.');
        return page('Préférences enregistrées', `<p>${summary}</p><p><a href="${path}">Revenir à mes préférences</a></p>`, 200,
          `${cookieName}=; Path=${path}; Max-Age=0; SameSite=Strict; HttpOnly${secure}`);
      },
    },
  },
});
