import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

async function admin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'superadmin' });
  if (error || !data) throw new Error('Accès réservé au Superadmin');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}
const check = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

export const abInput = z.object({
  campaignId: z.string().uuid(),
  variants: z.array(z.object({ subject: z.string().trim().max(300), fromName: z.string().trim().max(120) })).min(2).max(3),
  pct: z.number().int().min(5).max(50),
  hours: z.number().int().min(1).max(72),
  metric: z.enum(['open', 'click']),
});

export const readAb = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const db = await admin(context);
  const camps = await db.from('campaigns').select('id,name,subject,from_name,status,total,ab_variants,ab_metric,ab_decide_at,ab_winner,created_at').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(50);
  check(camps.error);
  const tests = [];
  const eligible = [];
  for (const c of camps.data ?? []) {
    if (Array.isArray(c.ab_variants)) {
      const variants = await Promise.all((c.ab_variants as any[]).map(async (v, i) => {
        const base = () => db.from('campaign_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('variant', i);
        const [all, sent, opened, clicked] = await Promise.all([base(), base().eq('status', 'sent'), base().not('opened_at', 'is', null), base().not('clicked_at', 'is', null)]);
        return { ...v, assigned: all.count ?? 0, sent: sent.count ?? 0, opened: opened.count ?? 0, clicked: clicked.count ?? 0 };
      }));
      tests.push({ ...c, variants });
    } else if (c.status !== 'done') {
      const sent = await db.from('campaign_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).neq('status', 'queued');
      if ((sent.count ?? 0) === 0) eligible.push({ id: c.id, name: c.name, subject: c.subject, from_name: c.from_name, total: c.total });
    }
  }
  return { tests, eligible };
});

export const startAb = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => abInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const c = await db.from('campaigns').select('status,ab_variants,subject,from_name').eq('id', data.campaignId).single(); check(c.error);
    if (c.data!.ab_variants) throw new Error('Cette campagne a déjà un test A/B.');
    const started = await db.from('campaign_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', data.campaignId).neq('status', 'queued');
    if ((started.count ?? 0) > 0) throw new Error('L’envoi a déjà commencé : le test A/B doit être créé avant le premier envoi.');
    const variants = data.variants.map(v => ({ subject: v.subject || c.data!.subject, fromName: v.fromName || c.data!.from_name }));
    // Hold sending while variants are assigned.
    check((await db.from('campaigns').update({ status: 'paused', ab_variants: variants, ab_metric: data.metric, ab_decide_at: new Date(Date.now() + data.hours * 3600_000).toISOString() }).eq('id', data.campaignId)).error);
    const ids: string[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await db.from('campaign_messages').select('id').eq('campaign_id', data.campaignId).eq('status', 'queued').range(from, from + 999); check(r.error);
      ids.push(...(r.data ?? []).map(x => x.id)); if ((r.data ?? []).length < 1000) break;
    }
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
    const sample = ids.slice(0, Math.max(variants.length, Math.round(ids.length * data.pct / 100)));
    for (let v = 0; v < variants.length; v++) {
      const part = sample.filter((_, i) => i % variants.length === v);
      for (let i = 0; i < part.length; i += 500) check((await db.from('campaign_messages').update({ variant: v }).in('id', part.slice(i, i + 500))).error);
    }
    if (c.data!.status === 'queued') check((await db.from('campaigns').update({ status: 'queued' }).eq('id', data.campaignId)).error);
    return { sample: sample.length, holdout: ids.length - sample.length };
  });

export const decideAbNow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(i => z.object({ campaignId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    check((await db.from('campaigns').update({ ab_decide_at: new Date().toISOString() }).eq('id', data.campaignId).is('ab_winner', null)).error);
    check((await db.rpc('decide_ab_winners' as any)).error);
    return { ok: true };
  });
