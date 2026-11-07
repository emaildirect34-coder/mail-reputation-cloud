import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { aiInput, canUseAi } from './ai.schemas';

export const diagnoseEmail = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => aiInput.parse(input)).handler(async ({ data, context }) => {
    const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
    if (role.error) throw new Error('Vérification des droits impossible');
    const tasks = role.data ? null : await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
    if (tasks?.error || !canUseAi({ role: role.data ? 'superadmin' : 'worker', paths: (tasks?.data ?? []).flatMap(t => t.allowed_paths) }, data.skill)) throw new Error('Ce diagnostic ne fait pas partie de vos tâches.');
    let evidence: unknown = null;
    if (data.skill === 'dns') {
      const domain = await context.supabase.from('sending_domains').select('id,domain,ip,checks,checked_at,synced_at').eq('id', data.domainId ?? '').single();
      if (domain.error) throw new Error('Domaine inaccessible');
      const bindings = await context.supabase.from('server_domain_bindings').select('status,installed_at,last_error').eq('domain_id', domain.data.id);
      if (bindings.error) throw new Error('État DKIM inaccessible');
      evidence = { domain: domain.data, bindings: bindings.data };
    } else if (data.skill === 'logs') {
      const [events, alerts] = await Promise.all([
        context.supabase.from('delivery_events').select('event_type,isp,smtp_code,occurred_at').order('occurred_at',{ascending:false}).limit(200),
        context.supabase.from('delivery_alerts').select('rule,isp,rate,sample_size,created_at').order('created_at',{ascending:false}).limit(20),
      ]);
      if (events.error || alerts.error) throw new Error('Journaux inaccessibles');
      evidence = { latestEvents: events.data, alerts: alerts.data, sampleLimit: 200, fetchedAt: new Date().toISOString() };
    }
    const { diagnose } = await import('./ai.server');
    return diagnose(data, evidence);
  });