import { createFileRoute } from '@tanstack/react-router';

// Click redirect: only to URLs present in the campaign template (no open redirect).
export const Route = createFileRoute('/api/public/c/$token')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const u = new URL(request.url).searchParams.get('u') ?? '';
        if (!/^[0-9a-f]{36}$/.test(params.token) || !/^https?:\/\//.test(u) || u.length > 2000) return new Response('Lien invalide', { status: 404 });
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const db = supabaseAdmin as any;
        const m = await db.from('campaign_messages').select('id,campaign_id,opened_at,clicked_at').eq('unsub_token', params.token).maybeSingle();
        if (!m.data) return new Response('Lien invalide', { status: 404 });
        const c = await db.from('campaigns').select('html').eq('id', m.data.campaign_id).single();
        const html = c.data?.html ?? '';
        if (!html.includes(u) && !html.includes(u.replaceAll('&', '&amp;'))) return new Response('Lien invalide', { status: 404 });
        if (!m.data.clicked_at) {
          const now = new Date().toISOString();
          await db.from('campaign_messages').update({ clicked_at: now, opened_at: m.data.opened_at ?? now }).eq('id', m.data.id);
        }
        const { fillClickId } = await import('@/lib/postback');
        return new Response(null, { status: 302, headers: { Location: fillClickId(u, params.token), 'Cache-Control': 'no-store' } });
      },
    },
  },
});
