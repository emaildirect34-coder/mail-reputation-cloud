import { createFileRoute } from '@tanstack/react-router';

const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));

// Open pixel: records the first open of a message (used for A/B winner selection).
export const Route = createFileRoute('/api/public/t/$token')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (/^[0-9a-f]{36}$/.test(params.token)) {
          const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
          await db.from('campaign_messages').update({ opened_at: new Date().toISOString() }).eq('unsub_token', params.token).is('opened_at', null);
        }
        return new Response(gif, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } });
      },
    },
  },
});
