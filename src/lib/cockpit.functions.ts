import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { operationsWidgetSchema } from './operations-widgets';

async function requireAdmin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error || !role.data) throw new Error('Accès au cockpit réservé au superadmin.');
}

const hour = 3_600_000;
const iso = (time: number) => new Date(time).toISOString();

export const readOperationsWidgets = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const result = await supabaseAdmin.rpc('read_operations_widgets');
    if (result.error?.code === 'PGRST202') return null;
    if (result.error) throw new Error('Les widgets d’exploitation sont indisponibles.');
    return operationsWidgetSchema.parse(result.data);
  });

export const readCockpitTraffic = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.enum(['24h', '7j']).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const db = context.supabase;
    const end = Date.now();
    const width = (data === '24h' ? 4 : 24) * hour;
    const size = data === '24h' ? 6 : 7;
    const start = end - width * size;
    async function count(from: number, to: number, type: string, gmail = false) {
      let query = db.from('delivery_events').select('id', { count: 'exact', head: true })
        .gte('occurred_at', iso(from)).lt('occurred_at', iso(to)).eq('event_type', type);
      if (gmail) query = query.eq('isp', 'Gmail');
      const result = await query;
      if (result.error) throw new Error('Les statistiques SMTP sont indisponibles.');
      return result.count ?? 0;
    }
    async function bucket(index: number) {
      const from = start + index * width;
      const to = from + width;
      const [accepted, bounced, gmailAccepted, gmailBounced, gmailComplaints, injected] = await Promise.all([
        count(from, to, 'delivered'), count(from, to, 'bounce'),
        count(from, to, 'delivered', true), count(from, to, 'bounce', true), count(from, to, 'complaint', true),
        db.from('campaign_messages').select('id', { count: 'exact', head: true }).gte('sent_at', iso(from)).lt('sent_at', iso(to)),
      ]);
      if (injected.error) throw new Error('Les données d’injection sont indisponibles.');
      return { from: iso(from), accepted, bounced, gmailAccepted, gmailBounced, gmailComplaints, injected: injected.count ?? 0 };
    }
    const buckets = [];
    for (let i = 0; i < size; i += 2) {
      buckets.push(...await Promise.all(Array.from({ length: Math.min(2, size - i) }, (_, offset) => bucket(i + offset))));
    }
    const [volume, minute, opened, unsubscribed, recent] = await Promise.all([
      db.from('campaign_messages').select('id', { count: 'exact', head: true }).gte('sent_at', iso(end - 24 * hour)).lt('sent_at', iso(end)),
      db.from('campaign_messages').select('id', { count: 'exact', head: true }).gte('sent_at', iso(end - 60_000)).lt('sent_at', iso(end)),
      db.from('campaign_messages').select('id', { count: 'exact', head: true }).gte('opened_at', iso(start)).lt('opened_at', iso(end)),
      db.from('suppressions').select('email_md5', { count: 'exact', head: true }).eq('reason', 'unsubscribe').gte('created_at', iso(start)).lt('created_at', iso(end)),
      db.from('delivery_events').select('id,occurred_at,event_type,isp,smtp_code').order('occurred_at', { ascending: false }).limit(6),
    ]);
    if ([volume, minute, opened, unsubscribed, recent].some(result => result.error)) throw new Error('Certaines mesures du cockpit sont indisponibles.');
    return { buckets, volume: volume.count ?? 0, minute: minute.count ?? 0, opened: opened.count ?? 0,
      unsubscribed: unsubscribed.count ?? 0, recent: recent.data ?? [] };
  });

export const readCockpitInventory = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const db = context.supabase;
    const today = iso(Date.now()).slice(0, 10);
    const dates = Array.from({ length: 7 }, (_, index) => iso(Date.now() - (6 - index) * 24 * hour).slice(0, 10));
    async function privateInventory() {
      try {
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const [placement, domains] = await Promise.all([
          supabaseAdmin.from('campaign_placement_monitors').select('seeds,observed_at')
            .not('observed_at', 'is', null).order('observed_at', { ascending: false }).limit(30),
          supabaseAdmin.from('sending_domains').select('checks,checked_at', { count: 'exact' }).not('checked_at', 'is', null).limit(1000),
        ]);
        return {
          placement: placement.error ? null : placement.data,
          domains: !domains.error && domains.count === domains.data.length ? domains.data.map(domain => domain.checks) : null,
        };
      } catch {
        return { placement: null, domains: null };
      }
    }
    async function activeCampaigns() {
      const active = () => db.from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'queued').not('list_id', 'is', null);
      const scheduled = await active().or(`scheduled_at.is.null,scheduled_at.lte.${iso(Date.now())}`);
      return scheduled.error?.code === '42703' ? active() : scheduled;
    }
    const [finance, campaigns, pools, ips, restricted] = await Promise.all([
      db.from('finance_entries').select('occurred_on,amount_cents', { count: 'exact' }).eq('currency', 'EUR').eq('kind', 'revenue')
        .in('status', ['approved', 'paid']).gte('occurred_on', dates[0]!).lte('occurred_on', today).limit(1000),
      activeCampaigns(),
      db.from('vmta_pools').select('id,name,purpose').eq('status', 'active').order('name'),
      db.from('server_ips').select('pool_id,quarantined_at', { count: 'exact' }).eq('active', true).limit(1000),
      privateInventory(),
    ]);
    const complete = <T,>(result: { data: T[] | null; count: number | null; error: unknown }) =>
      !result.error && result.data && result.count === result.data.length ? result.data : null;
    const revenue = complete(finance);
    const ipList = complete(ips);
    return {
      revenues: revenue && dates.map(date => revenue.filter(row => row.occurred_on === date).reduce((sum, row) => sum + row.amount_cents, 0) / 100),
      campaigns: campaigns.error ? null : campaigns.count ?? 0,
      ipCount: ipList?.length ?? null,
      pools: ipList && pools.data ? pools.data.map(pool => ({
        name: pool.name, purpose: pool.purpose,
        assigned: ipList.filter(ip => ip.pool_id === pool.id).length,
        usable: ipList.filter(ip => ip.pool_id === pool.id && !ip.quarantined_at).length,
      })).sort((a, b) => b.assigned - a.assigned).slice(0, 3) : null,
      ...restricted,
    };
  });
