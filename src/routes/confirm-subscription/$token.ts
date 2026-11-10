import { createFileRoute } from '@tanstack/react-router';
import { localForm, readTrackingForm, singleFormValue } from '@/lib/tracking-request';

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><main><h1>${title}</h1>${body}</main></html>`, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
  });
}

const invalid = () => page('Lien indisponible', '<p>Ce lien d’inscription est invalide ou expiré.</p>', 404);

export const Route = createFileRoute('/confirm-subscription/$token')({
  server: { handlers: {
    GET: async ({ params }) => {
      const { readSubscriptionToken } = await import('@/lib/subscription-confirmation.server');
      const { subscriptionStatement } = await import('@/lib/subscription-proof.server');
      const token = await readSubscriptionToken(params.token);
      if (!token) return invalid();
      const statement = subscriptionStatement(token.listName).replace(/[&<>]/g, character => `&#${character.charCodeAt(0)};`);
      return page('Confirmer mon inscription', `<p>${statement}</p><form method="post"><button name="confirm" value="yes">Confirmer mon inscription</button></form>`);
    },
    POST: async ({ request, params }) => {
      if (!localForm(request.headers) || !singleFormValue(await readTrackingForm(request), 'confirm', 'yes')) return invalid();
      const { readSubscriptionToken } = await import('@/lib/subscription-confirmation.server');
      const token = await readSubscriptionToken(params.token);
      if (!token) return invalid();
      const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
      const { sha256 } = await import('@/lib/kumo.server');
      const { sealSubscriptionProof } = await import('@/lib/subscription-proof.server');
      const tokenHash = await sha256(params.token);
      const proof = await sealSubscriptionProof(token, tokenHash, request.url).catch(() => null);
      if (!proof) return page('Confirmation indisponible', '<p>Réessayez plus tard.</p>', 503);
      const result = await db.rpc('confirm_contact_subscription', { _list: token.list, _email: token.email, _token_hash: tokenHash, ...proof });
      if (result.error) return page('Confirmation indisponible', '<p>Réessayez plus tard.</p>', 503);
      if (result.data !== 'confirmed') return invalid();
      return page('Inscription confirmée', '<p>Votre confirmation a bien été enregistrée.</p>');
    },
  } },
});
