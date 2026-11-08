import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';

export const Route = createFileRoute('/api/public/jobs/daily-report')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { sendDailyReport } = await import('@/lib/daily-report.server');
        await sendDailyReport(supabaseAdmin);
        return Response.json({ success: true });
      },
    },
  },
});
