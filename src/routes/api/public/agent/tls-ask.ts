import { createFileRoute } from '@tanstack/react-router';

// Caddy on-demand TLS "ask" hook: a certificate is issued only for registered tracking hosts.
export const Route = createFileRoute('/api/public/agent/tls-ask')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const host = (new URL(request.url).searchParams.get('domain') ?? '').toLowerCase();
        if (!/^[a-z0-9.-]{3,253}$/.test(host)) return new Response('no', { status: 404 });
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { data } = await (supabaseAdmin as any).from('sending_domains').select('id').eq('tracking_host', host).maybeSingle();
        return new Response(data ? 'ok' : 'no', { status: data ? 200 : 404 });
      },
    },
  },
});
