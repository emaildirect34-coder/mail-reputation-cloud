import { createFileRoute } from '@tanstack/react-router';
import { localForm, messageToken, readTrackingForm, singleFormValue, trackingPageHeaders } from '@/lib/tracking-request';
import { unsubscribeReasons } from '@/lib/unsubscribe-reasons';

const page = (title: string, text: string, form = '', status = 200) => new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center"><h1 style="font-size:22px">${title}</h1><p>${text}</p>${form}</body></html>`, { status, headers: trackingPageHeaders });
const invalid = () => page('Lien invalide', 'Ce lien de désinscription n’est pas valide.', '', 404);

async function unsubscribe(request: Request, token: string) {
  if (!messageToken.test(token)) return invalid();
  let serverId: string | undefined;
  let manual = false;
  if (request.headers.has('authorization')) {
    const { agentFromRequest } = await import('@/lib/kumo.server');
    const agent = await agentFromRequest(request);
    if (!agent) return new Response('Non autorisé', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    serverId = agent.serverId;
  } else {
    const body = await readTrackingForm(request);
    const oneClick = singleFormValue(body, 'List-Unsubscribe', 'One-Click');
    const confirmed = localForm(request.headers) && singleFormValue(body, 'confirm', 'unsubscribe');
    if (!oneClick && localForm(request.headers) && singleFormValue(body, 'action', 'reason')) {
      const values = body?.getAll('reason') ?? [];
      const reason = values[0];
      if (values.length !== 1 || typeof reason !== 'string' || !Object.hasOwn(unsubscribeReasons, reason)) return page('Motif invalide', 'Sélectionnez un motif proposé.', '', 400);
      const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
      const result = await db.rpc('record_campaign_unsubscribe_reason', { _token: token, _reason: reason });
      if (result.error) return page('Motif indisponible', 'Votre désinscription reste enregistrée.', '', 503);
      if (!result.data) return invalid();
      return page('Merci pour votre réponse', 'Votre désinscription est enregistrée.');
    }
    if (!oneClick && !confirmed) return page('Confirmation requise', 'Ouvrez le lien de désinscription pour confirmer.', '', 400);
    manual = confirmed && !oneClick;
  }

  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const result = await db.rpc('unsubscribe_campaign_message', serverId
    ? { _token: token, _server: serverId }
    : { _token: token });
  if (result.error) return page('Service indisponible', 'Réessayez plus tard.', '', 503);
  const row = result.data[0];
  if (!row) return invalid();
  if (row.newly_suppressed && !/^email-direct-unsub-[0-9a-f-]{36}@example\.invalid$/.test(row.email)) {
    const { fireWebhooks } = await import('@/lib/webhooks.server');
    await fireWebhooks('unsubscribe', { email: row.email, campaign_id: row.campaign_id });
  }
  const feedback = manual && row.newly_suppressed && !row.email.endsWith('@example.invalid')
    ? `<form method="post"><p>Facultatif · Pourquoi vous désinscrivez-vous ?</p><input type="hidden" name="action" value="reason">
      <select name="reason" required aria-label="Motif de désinscription"><option value="">Choisir un motif</option>${
        Object.entries(unsubscribeReasons).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')
      }</select> <button type="submit">Envoyer</button></form>` : '';
  return page('Désinscription confirmée', 'Vous ne recevrez plus nos emails.', feedback);
}

// GET is read-only. RFC 8058 POST is direct, without requiring a browser session.
export const Route = createFileRoute('/api/public/unsub/$token')({
  server: { handlers: {
    GET: async ({ params }) => (messageToken.test(params.token)
      ? page('Se désinscrire', 'Confirmez pour ne plus recevoir nos emails.', '<form method="post"><button name="confirm" value="unsubscribe" style="padding:10px 20px;font-size:16px;cursor:pointer">Confirmer la désinscription</button></form>')
      : invalid()),
    POST: ({ params, request }) => unsubscribe(request, params.token),
  } },
});
