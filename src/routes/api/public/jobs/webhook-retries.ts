import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';

export const Route = createFileRoute('/api/public/jobs/webhook-retries')({
  server: { handlers: { POST: async ({ request }) => {
    const authFailure = await authenticateCronRequest(request);
    if (authFailure) return authFailure;
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { withOperationalJob } = await import('@/lib/operational-jobs.server');
    return withOperationalJob(supabaseAdmin, 'webhook-retries', async () => {
      const { retryDueWebhooks } = await import('@/lib/webhooks.server');
      const results=await retryDueWebhooks(supabaseAdmin);
      const cleanup=await Promise.all([
        (supabaseAdmin as any).from('webhook_delivery_attempts').delete().lt('created_at',new Date(Date.now()-90*86400000).toISOString()),
        (supabaseAdmin as any).from('webhook_retry_deliveries').delete().eq('status','sent').lt('sent_at',new Date(Date.now()-90*86400000).toISOString()),
        (supabaseAdmin as any).from('webhook_retry_deliveries').delete().eq('status','dead').lt('created_at',new Date(Date.now()-180*86400000).toISOString()),
      ]);
      if(cleanup.some(result=>result.error))console.error('Webhook retention cleanup incomplete');
      return Response.json({ success: true, ...results });
    });
  } } },
});
