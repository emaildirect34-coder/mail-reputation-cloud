import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Database } from '@/integrations/supabase/types';
import { canOpen } from './access';
import type { SupabaseClient } from '@supabase/supabase-js';

async function authorize(supabase: SupabaseClient<Database>, userId: string) {
  const roles = await supabase.from('user_roles').select('role').eq('user_id', userId);
  if (roles.error) throw new Error('Vérification des accès indisponible.');
  const isAdmin = roles.data.some(row => row.role === 'superadmin');
  if (!isAdmin) {
    if (!roles.data.some(row => row.role === 'worker')) throw new Error('Accès aux opérations non autorisé.');
    const tasks = await supabase.from('worker_tasks').select('allowed_paths').eq('user_id', userId).eq('status', 'active');
    if (tasks.error || !canOpen({ role: 'worker', paths: tasks.data.flatMap(row => row.allowed_paths) }, '/dashboard/operations')) {
      throw new Error('Accès aux opérations non autorisé.');
    }
  }
  return isAdmin;
}

export const readOperationsCenter = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await authorize(context.supabase, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const [reportResult, serverResult, jobsResult, accountsResult, mailTester] = await Promise.all([
      supabaseAdmin.rpc('read_weekly_operations_report', { _now: new Date().toISOString() }),
      supabaseAdmin.from('managed_servers').select('id,label,provider,status,monthly_price,maintenance_since,server_agents(status,last_seen,last_error,agent_version)').neq('status', 'absent').order('label'),
      supabaseAdmin.from('operational_job_runs').select('job,status,started_at,finished_at,duration_ms').order('started_at', { ascending: false }).limit(60),
      isAdmin ? supabaseAdmin.from('provider_accounts').select('id,provider,label,status,checked_at,auth_type,secret,email').in('provider', ['cloudflare','google_postmaster']).order('provider') : null,
      probeMailTester(),
    ]);
    if (reportResult.error && !['PGRST202','PGRST205','42P01'].includes(reportResult.error.code)) throw new Error('Rapport hebdomadaire indisponible.');
    if (serverResult.error) throw new Error('État des serveurs indisponible.');
    if (jobsResult.error && !['PGRST205','42P01'].includes(jobsResult.error.code)) throw new Error('État des tâches planifiées indisponible.');
    if (accountsResult?.error) throw new Error('État des comptes fournisseurs indisponible.');
    const servers = (serverResult.data ?? []).map(server => {
      const agent = Array.isArray(server.server_agents) ? server.server_agents[0] : server.server_agents;
      const minutesOld = agent?.last_seen ? (Date.now() - Date.parse(agent.last_seen)) / 60_000 : Infinity;
      const healthy = !!agent && agent.status !== 'error' && minutesOld <= 5;
      return { id: server.id, label: server.label, provider: server.provider, monthlyPrice: server.monthly_price, state: server.maintenance_since ? 'maintenance' as const : !agent ? 'missing' as const : healthy ? 'online' as const : 'stale' as const,
        lastSeen: agent?.last_seen ?? null, agentVersion: agent?.agent_version ?? null,
        detail: server.maintenance_since ? 'Maintenance active' : !agent ? 'Agent non installé' : agent.status === 'error' ? 'Agent en erreur' : minutesOld > 5 ? 'Signal reçu il y a plus de 5 minutes' : 'Signal récent',
      };
    });
    const latestJobs = new Map<string, NonNullable<typeof jobsResult.data>[number]>();
    for (const row of jobsResult.data ?? []) if (!latestJobs.has(row.job)) latestJobs.set(row.job, row);
    const providerHealth = await Promise.all((accountsResult?.data ?? []).map(async account => {
      if (account.provider === 'google_postmaster') return { id: account.id, label: `${account.label} · Google Postmaster`, state: 'unconfigured' as const, detail: 'Connexion OAuth et propriété du domaine à vérifier' };
      const age = account.checked_at ? Date.now() - Date.parse(account.checked_at) : Infinity;
      try {
        const { verifyAccount } = await import('./providers.server');
        const accountData = { provider: account.provider, auth_type: account.auth_type, secret: account.secret, email: account.email };
        await verifyAccount(accountData);
        return { id: account.id, label: `${account.label} · Cloudflare`, state: 'online' as const, detail: 'Jeton/API vérifié maintenant' };
      } catch {
        return { id: account.id, label: `${account.label} · Cloudflare`, state: 'error' as const, detail: age < 24*60*60_000 ? 'Échec de la vérification actuelle' : 'Échec actuel; dernière vérification ancienne' };
      }
    }));
    if (isAdmin && !(accountsResult?.data ?? []).some(row => row.provider === 'cloudflare')) providerHealth.push({ id: 'cloudflare-none', label: 'Cloudflare', state: 'unconfigured' as const, detail: 'Aucun compte connecté' });
    if (isAdmin && !(accountsResult?.data ?? []).some(row => row.provider === 'google_postmaster')) providerHealth.push({ id: 'postmaster-none', label: 'Google Postmaster', state: 'unconfigured' as const, detail: 'Aucun accès OAuth connecté' });
    const monthlyCosts = new Map<string, number>();
    for (const server of servers) if (server.monthlyPrice != null && server.monthlyPrice > 0) {
      const key = server.provider === 'hetzner' ? 'EUR' : ['linode','vultr','digitalocean'].includes(server.provider) ? 'USD' : `Unité non vérifiée · ${server.provider}`;
      monthlyCosts.set(key, (monthlyCosts.get(key) ?? 0) + server.monthlyPrice);
    }
    const audit = isAdmin ? await supabaseAdmin.from('audit_log').select('id,actor_id,action,entity_type,entity_id,summary,created_at').order('created_at', { ascending: false }).limit(50) : null;
    if (audit?.error && !['PGRST205','42P01'].includes(audit.error.code)) throw new Error('Journal d’audit indisponible.');
    return {
      isAdmin,
      report: reportResult.data ?? null,
      servers,
      jobs: [...latestJobs.values()],
      integrations: [{ id: 'database', label: 'Base applicative', state: 'online' as const, detail: 'Lecture réelle réussie' }, mailTester, ...providerHealth],
      monthlyCosts: [...monthlyCosts.entries()].map(([currency, amount]) => ({ currency, amount })),
      audit: isAdmin ? (audit?.data ?? []) : null,
    };
  });

export const exportAuditLog=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .handler(async ({context})=>{
  if(!(await authorize(context.supabase,context.userId)))throw new Error('Export réservé au Superadmin.');
  const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
  const {recordAuditEvent}=await import('./audit-log.server');
  await recordAuditEvent(supabaseAdmin,{actorId:context.userId,action:'audit.exported',entityType:'audit_log',summary:{limit:5000}});
  const result=await supabaseAdmin.from('audit_log').select('id,actor_id,action,entity_type,entity_id,summary,created_at').order('created_at',{ascending:false}).limit(5000);
  if(result.error)throw new Error('Export du journal impossible. Appliquez la migration 0082.');
  return result.data??[];
 });

async function probeMailTester() {
  if (!process.env['MAILTESTER_URL'] || !process.env['MAILTESTER_KEY']) {
    return { id: 'mail-tester', label: 'Mail-Tester', state: 'unconfigured' as const, detail: 'URL ou clé non configurée côté serveur' };
  }
  const started = Date.now();
  try {
    const { mailTesterRequest } = await import('./mail-tester.server');
    await mailTesterRequest('/openapi.json', { method: 'GET', signal: AbortSignal.timeout(5000) });
    return { id: 'mail-tester', label: 'Mail-Tester', state: 'online' as const, detail: `API joignable · ${Date.now() - started} ms` };
  } catch {
    return { id: 'mail-tester', label: 'Mail-Tester', state: 'error' as const, detail: 'API non joignable ou clé refusée' };
  }
}
