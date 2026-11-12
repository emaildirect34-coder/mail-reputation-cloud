import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Database } from '@/integrations/supabase/types';
import { canOpen } from './access';

async function incidentAccess({ supabase, userId }: { supabase: SupabaseClient<Database>; userId: string }) {
  const roles = await supabase.from('user_roles').select('role').eq('user_id', userId);
  if (roles.error) throw new Error('Vérification des accès indisponible.');
  const isAdmin = roles.data.some(row => row.role === 'superadmin');
  if (!isAdmin) {
    if (!roles.data.some(row => row.role === 'worker')) throw new Error('Accès aux incidents non autorisé.');
    const tasks = await supabase.from('worker_tasks').select('allowed_paths').eq('user_id', userId).eq('status', 'active');
    if (tasks.error || !canOpen({ role: 'worker', paths: tasks.data.flatMap(task => task.allowed_paths) }, '/dashboard/incidents')) {
      throw new Error('Accès aux incidents non autorisé.');
    }
  }
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return { db: supabaseAdmin, isAdmin };
}

const pageSize = 30;
const affectedCampaigns = z.array(z.object({ id: z.string().uuid(), name: z.string() }));

export const readOperationsIncidents = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ state: z.enum(['open', 'resolved']), page: z.number().int().min(0).max(100_000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { db, isAdmin } = await incidentAccess(context);
    let scanFailed = false;
    if (isAdmin && data.state === 'open' && data.page === 0) {
      const scan = await db.rpc('sync_operations_incidents');
      if (scan.error?.code === 'PGRST202') return null;
      scanFailed = !!scan.error;
    }
    let query = db.from('operations_incidents')
      .select('id,kind,title,detail,server_id,affected_campaigns,affected_messages,started_at,last_observed_at,signal_cleared_at,assigned_to,resolved_at,resolution_note', { count: 'exact' });
    query = data.state === 'open' ? query.is('resolved_at', null) : query.not('resolved_at', 'is', null);
    if (!isAdmin) query = query.eq('assigned_to', context.userId);
    const [result, assignees] = await Promise.all([
      query.order(data.state === 'open' ? 'started_at' : 'resolved_at', { ascending: false })
        .order('id').range(data.page * pageSize, (data.page + 1) * pageSize - 1),
      isAdmin ? db.rpc('operations_incident_assignees') : null,
    ]);
    if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') return null;
    if (result.error || assignees?.error) throw new Error('Lecture du centre d’incidents indisponible.');
    return {
      isAdmin, scanFailed, total: result.count ?? 0, pageSize, assignees: assignees?.data ?? [],
      incidents: result.data.map(({ affected_campaigns, ...incident }) => ({
        ...incident, campaigns: affectedCampaigns.parse(affected_campaigns),
      })),
    };
  });

export const readOperationalJobHealth = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await incidentAccess(context);
    const result = await db.from('operational_job_runs').select('id,job,status,started_at,finished_at,duration_ms')
      .order('started_at', { ascending: false }).limit(60);
    if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') return null;
    if (result.error) throw new Error('État des tâches planifiées indisponible.');
    const latest = new Map<string, typeof result.data[number]>();
    for (const row of result.data) if (!latest.has(row.job)) latest.set(row.job, row);
    return [...latest.values()].sort((a, b) => a.job.localeCompare(b.job));
  });

const id = z.string().uuid();
export const readIncidentSmtpTimeline = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ id }).parse(input))
  .handler(async ({ data, context }) => {
    const { db, isAdmin } = await incidentAccess(context);
    let lookup = db.from('operations_incidents').select('server_id,affected_campaigns,started_at,signal_cleared_at').eq('id', data.id);
    if (!isAdmin) lookup = lookup.eq('assigned_to', context.userId);
    const incident = await lookup.maybeSingle();
    if (incident.error || !incident.data) throw new Error('Chronologie indisponible pour cet incident.');
    const campaigns = affectedCampaigns.parse(incident.data.affected_campaigns).map(campaign => campaign.id);
    if (!incident.data.server_id && !campaigns.length) return [];
    const start = new Date(Date.parse(incident.data.started_at) - 30 * 60_000).toISOString();
    const end = incident.data.signal_cleared_at ?? new Date().toISOString();
    let query = db.from('delivery_events').select('id,occurred_at,event_type,isp,smtp_code')
      .in('event_type', ['bounce', 'deferred', 'complaint']).gte('occurred_at', start).lte('occurred_at', end)
      .order('occurred_at').order('id').limit(15);
    if (incident.data.server_id) query = query.eq('server_id', incident.data.server_id);
    if (campaigns.length) query = query.in('campaign_id', campaigns);
    const events = await query;
    if (events.error) throw new Error('Retours SMTP indisponibles.');
    return events.data;
  });

export const manageOperationsIncident = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.discriminatedUnion('action', [
    z.object({ id, action: z.literal('assign'), assignee: id.nullable() }),
    z.object({ id, action: z.literal('resolve'), note: z.string().trim().max(500).optional() }),
    z.object({ id, action: z.literal('reopen') }),
  ]).parse(input))
  .handler(async ({ data, context }) => {
    const { db } = await incidentAccess(context);
    const result = await db.rpc('manage_operations_incident', {
      _id: data.id, _actor: context.userId, _action: data.action,
      ...(data.action === 'assign' ? { _assignee: data.assignee } : {}),
      ...(data.action === 'resolve' && data.note ? { _note: data.note } : {}),
    });
    if (result.error || !result.data) throw new Error('Cette action est indisponible pour cet incident.');
    const { recordAuditEvent } = await import('./audit-log.server');
    await recordAuditEvent(db, { actorId: context.userId, action: `incident.${data.action}`, entityType: 'operations_incident', entityId: data.id,
      summary: data.action === 'resolve' ? { note_added: !!data.note } : data.action === 'assign' ? { assigned: !!data.assignee } : {} });
  });
