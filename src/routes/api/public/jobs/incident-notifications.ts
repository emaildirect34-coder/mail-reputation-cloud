import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';

export const Route = createFileRoute('/api/public/jobs/incident-notifications')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const failure = await authenticateCronRequest(request);
        if (failure) return failure;
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { withOperationalJob } = await import('@/lib/operational-jobs.server');
        return withOperationalJob(supabaseAdmin, 'incident-notifications', async () => {
        const stalled = await (supabaseAdmin as any).rpc('sync_stalled_campaign_incidents');
        if(stalled.error&&stalled.error.code!=='PGRST202')console.error('Stalled campaign scan failed',stalled.error.code);
        const { monitorTlsCertificates } = await import('@/lib/tls-monitor.server');
        const tls = await monitorTlsCertificates(supabaseAdmin).catch(()=>{console.error('TLS certificate scan failed');return null;});
        const { notifyIncidents } = await import('@/lib/incident-notifications.server');
        const { monitorSponsorLinks } = await import('@/lib/sponsor-link-monitor.server');
        const [notifications, expiry, center, sponsorChecks] = await Promise.all([
          notifyIncidents(supabaseAdmin),
          supabaseAdmin.rpc('expire_campaign_messages', { _limit: 5000 }),
          supabaseAdmin.rpc('sync_operations_incidents'),
          monitorSponsorLinks(supabaseAdmin).catch(() => { console.error('Sponsor link scan failed'); return null; }),
        ]);
        if (expiry.error && expiry.error.code !== 'PGRST202') console.error('Campaign deadline sweep failed', expiry.error.code);
        if (center.error && center.error.code !== 'PGRST202') console.error('Operations incident scan failed', center.error.code);
        return Response.json({ ...notifications, ...(expiry.data !== null ? { expiredCampaignMessages: expiry.data } : {}),
          ...(center.data !== null ? { incidentsScanned: center.data } : {}),stalledCampaigns:stalled.data??0,tls,sponsorChecks });
        });
      },
    },
  },
});
