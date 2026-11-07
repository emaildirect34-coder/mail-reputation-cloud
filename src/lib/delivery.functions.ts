import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { logFilters, canReadLogs } from './delivery.schemas';
export const readDeliveryLogs = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => logFilters.parse(i)).handler(async ({ data, context }) => {
    const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
    if (role.error) throw new Error('Vérification des droits impossible');
    if (!role.data) {
      const tasks = await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id',context.userId).eq('status','active');
      if (tasks.error || !canReadLogs({ role:'worker', paths: (tasks.data ?? []).flatMap(t=>t.allowed_paths) })) throw new Error('Accès non autorisé');
    }
    let query = context.supabase.from('delivery_events').select('*', { count:'exact' }).order('occurred_at',{ascending:false}).order('id');
    if (data.type !== 'all') query = query.eq('event_type', data.type);
    const search = data.search.trim().replace(/[%_\\]/g,'');
    if (search) query = query.ilike('recipient', `%${search}%`);
    const [events,summary,alerts] = await Promise.all([
      query.range(data.page*50,data.page*50+49), context.supabase.rpc('delivery_log_summary'),
      context.supabase.from('delivery_alerts').select('*').order('created_at',{ascending:false}).limit(30),
    ]);
    for (const r of [events,summary,alerts]) if (r.error) throw new Error('Lecture des journaux impossible');
    return { events:events.data ?? [], count:events.count ?? 0, summary:summary.data?.[0] ?? {events:0,delivered:0,bounced:0,deferred:0,complaints:0}, alerts:alerts.data ?? [], fetchedAt:new Date().toISOString() };
  });