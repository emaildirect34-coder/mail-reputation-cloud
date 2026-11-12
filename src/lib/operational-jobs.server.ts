import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export async function withOperationalJob<T>(db: SupabaseClient<Database>, job: 'daily-report' | 'incident-notifications' | 'webhook-retries', work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const opened = await db.rpc('start_operational_job', { _job: job });
  const runId = opened.error?.code === 'PGRST202' ? null : opened.data;
  if (opened.error && opened.error.code !== 'PGRST202') console.error('Operational job start could not be recorded', job, opened.error.code);
  try {
    const result = await work();
    if (runId) {
      const finished = await db.rpc('finish_operational_job', { _id: runId, _success: true, _duration_ms: Math.min(Date.now() - started, 2_147_483_647) });
      if (finished.error) console.error('Operational job completion could not be recorded', job, finished.error.code);
    }
    return result;
  } catch (error) {
    if (runId) {
      const finished = await db.rpc('finish_operational_job', { _id: runId, _success: false, _duration_ms: Math.min(Date.now() - started, 2_147_483_647) });
      if (finished.error) console.error('Operational job failure could not be recorded', job, finished.error.code);
    }
    throw error;
  }
}
