import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';

export const Route = createFileRoute('/api/public/jobs/incident-notifications')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const failure = await authenticateCronRequest(request);
        if (failure) return failure;
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { notifyIncidents } = await import('@/lib/incident-notifications.server');
        return Response.json(await notifyIncidents(supabaseAdmin));
      },
    },
  },
});
