import { createFileRoute } from '@tanstack/react-router';

const page = (title: string, text: string, form = '') => new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center"><h1 style="font-size:22px">${title}</h1><p>${text}</p>${form}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

async function unsubscribe(token: string) {
  if (!/^[0-9a-f]{36}$/.test(token)) return false;
  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const m = await db.from('campaign_messages').select('email,contact_id,campaign_id').eq('unsub_token', token).maybeSingle();
  if (!m.data) return false;
  await db.rpc('add_suppressions', { _values: [m.data.email], _reason: 'unsubscribe', _source: `campagne ${m.data.campaign_id}` });
  await db.from('contacts').update({ status: 'unsubscribed' }).eq('email', m.data.email);
  return true;
}

// RFC 8058: POST = one-click from the mailbox provider; GET = confirmation page for humans.
export const Route = createFileRoute('/api/public/unsub/$token')({
  server: {
    handlers: {
      GET: async ({ params }) => (/^[0-9a-f]{36}$/.test(params.token) ? page('Se désinscrire', 'Confirmez pour ne plus recevoir nos emails.', `<form method="post"><button style="padding:10px 20px;font-size:16px;cursor:pointer">Confirmer la désinscription</button></form>`) : page('Lien invalide', 'Ce lien de désinscription n’est pas valide.')),
      POST: async ({ params }) => (await unsubscribe(params.token)) ? page('Désinscription confirmée', 'Vous ne recevrez plus nos emails.') : page('Lien invalide', 'Ce lien de désinscription n’est pas valide.'),
    },
  },
});
