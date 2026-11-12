import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';

export const Route = createFileRoute('/api/public/jobs/daily-report')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { withOperationalJob } = await import('@/lib/operational-jobs.server');
        return withOperationalJob(supabaseAdmin, 'daily-report', async () => {
          const { sendDailyReport } = await import('@/lib/daily-report.server');
          const [report, retention] = await Promise.allSettled([
            sendDailyReport(supabaseAdmin),
            supabaseAdmin.from('sponsor_postback_rejections').delete().lt('last_seen', new Date(Date.now() - 30 * 86_400_000).toISOString()),
          ]);
          if (retention.status === 'rejected' || (retention.value.error && !['PGRST205', '42P01'].includes(retention.value.error.code))) {
            console.error('Sponsor postback rejection cleanup failed');
          }
          if (report.status === 'rejected') throw report.reason;
          return Response.json({ success: true });
        });
      },
    },
  },
});
