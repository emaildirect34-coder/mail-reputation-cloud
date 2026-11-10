import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { logFilters, canReadLogs, parseMessageReference } from './delivery.schemas';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

async function requireLogsAccess(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error) throw new Error('Vérification des droits impossible');
  if (role.data) return true;
  const tasks = await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
  if (tasks.error || !canReadLogs({ role: 'worker', paths: (tasks.data ?? []).flatMap(t => t.allowed_paths) })) throw new Error('Accès non autorisé');
  return false;
}

export const readMessageTrace = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.string().max(320).parse(input))
  .handler(async ({ context, data }) => {
    const superadmin = await requireLogsAccess(context);
    const reference = parseMessageReference(data);
    if (!reference) throw new Error('Saisissez un UUID de message ou un en-tête Message-ID complet.');

    // Workers can follow existing log entries. Pre-SMTP audience data stays restricted to superadmins.
    const events = await context.supabase.from('delivery_events').select('*')
      .eq('message_id', reference.id).order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(101);
    if (events.error) throw new Error('Lecture des événements du message impossible.');
    if (!superadmin && !events.data.length) return null;

    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const basic = 'id,email,campaign_id,server_id,status,delivery_state,error,created_at,claimed_at,sent_at';
    const current = await db.from('campaign_messages').select(`${basic},available_at,permit_granted_at,variant`).eq('id', reference.id).maybeSingle();
    let message = current.data;
    if (current.error?.code === '42703') {
      const legacy = await db.from('campaign_messages').select(basic).eq('id', reference.id).maybeSingle();
      if (legacy.error) throw new Error('Lecture de la file du message impossible.');
      message = legacy.data && { ...legacy.data, available_at: null, permit_granted_at: null, variant: null };
    } else if (current.error) throw new Error('Lecture de la file du message impossible.');
    if (!message) return null;

    const [campaign, server] = await Promise.all([
      db.from('campaigns').select('name,subject,from_email').eq('id', message.campaign_id).maybeSingle(),
      db.from('managed_servers').select('label').eq('id', message.server_id).maybeSingle(),
    ]);
    if (campaign.error || server.error) throw new Error('Lecture du contexte du message impossible.');
    const domain = campaign.data?.from_email.split('@')[1]?.toLowerCase();
    if (reference.domain && reference.domain !== domain) return null;

    return {
      message, messageId: domain ? `<${message.id}@${domain}>` : message.id,
      campaign: campaign.data, server: server.data?.label ?? null,
      events: events.data.slice(0, 100).map(event => ({ id: event.id, type: event.event_type,
        at: event.occurred_at, isp: event.isp, code: event.smtp_code, detail: event.detail, ip: event.source_ipv4 ?? null })),
      truncated: events.data.length > 100,
    };
  });

export const readDeliveryLogs = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => logFilters.parse(i)).handler(async ({ data, context }) => {
    await requireLogsAccess(context);
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

export const readDeliveryEngagement = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireLogsAccess(context);
    const result = await context.supabase.rpc('delivery_engagement_anomalies');
    if (result.error?.code === 'PGRST202' || result.error?.code === '42883') {
      return { configured: false, anomalies: [] };
    }
    if (result.error) throw new Error('Lecture de la télémétrie après acceptation SMTP impossible.');
    return { configured: true, anomalies: result.data ?? [] };
  });

export const readDeliveryDashboard = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.enum(['24h', '7j', '30j']).parse(i))
  .handler(async ({ data, context }) => {
    await requireLogsAccess(context);
    const hours = { '24h': 24, '7j': 168, '30j': 720 }[data];
    const bucketCount = data === '7j' ? 7 : 6;
    const width = hours * 3_600_000 / bucketCount;
    const end = Date.now();
    const start = end - hours * 3_600_000;
    const iso = (value: number) => new Date(value).toISOString();
    const count = async (from: number, to: number, type?: string) => {
      let query = context.supabase.from('delivery_events').select('id', { count: 'exact', head: true })
        .gte('occurred_at', iso(from)).lt('occurred_at', iso(to));
      if (type) query = query.eq('event_type', type);
      const result = await query;
      if (result.error) throw new Error('Lecture des métriques SMTP impossible.');
      return result.count ?? 0;
    };
    const [delivered, bounced, deferred, complaints, buckets, recent] = await Promise.all([
      count(start, end, 'delivered'), count(start, end, 'bounce'), count(start, end, 'deferred'), count(start, end, 'complaint'),
      Promise.all(Array.from({ length: bucketCount }, async (_, index) => {
        const from = start + index * width;
        return { from: iso(from), to: iso(from + width), count: await count(from, from + width) };
      })),
      context.supabase.from('delivery_events').select('id,occurred_at,event_type,isp,smtp_code')
        .gte('occurred_at', iso(start)).lt('occurred_at', iso(end)).order('occurred_at', { ascending: false }).order('id').limit(50),
    ]);
    if (recent.error) throw new Error('Lecture des événements SMTP impossible.');
    return { from: iso(start), to: iso(end), delivered, bounced, deferred, complaints, buckets, events: recent.data };
  });
