import { createFileRoute } from '@tanstack/react-router';
import { isSpeculativeRequest, messageToken } from '@/lib/tracking-request';

const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));

// The open pixel records a first fetch. Email proxies can load it without a reader.
export const Route = createFileRoute('/api/public/t/$token')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (request.method === 'GET' && messageToken.test(params.token) && !isSpeculativeRequest(request.headers)) {
          const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
          await supabaseAdmin.from('campaign_messages').update({ opened_at: new Date().toISOString() }).eq('unsub_token', params.token).is('opened_at', null);
        }
        return new Response(gif, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } });
      },
    },
  },
});
