import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

// Task-gated access: superadmin, or worker whose active task includes the path.
async function gate(context: any, path: string) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error) throw new Error('Vérification des droits impossible');
  if (role.data) return true;
  const t = await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
  if (t.error || !(t.data ?? []).some((r: any) => (r.allowed_paths ?? []).includes(path))) throw new Error('Accès non autorisé');
  return false;
}

export const readQueues = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context, '/dashboard/queues');
  const db = context.supabase;
  const [msgs, servers, camps] = await Promise.all([
    db.from('campaign_messages').select('email,status,delivery_state,server_id,campaign_id,sent_at').in('status', ['queued', 'claimed', 'sent', 'failed']).order('created_at', { ascending: false }).limit(20000),
    db.from('managed_servers').select('id,label'),
    db.from('campaigns').select('id,name,status,auto_pause_reason').in('status', ['queued', 'sending', 'paused']).order('created_at', { ascending: false }).limit(50),
  ]);
  for (const r of [msgs, servers, camps]) if (r.error) throw new Error('Lecture des files impossible');
  const label = new Map((servers.data ?? []).map((s: any) => [s.id, s.label]));
  const groups = new Map<string, { domain: string; server: string; queued: number; claimed: number; deferred: number; failed: number }>();
  let queued = 0, claimed = 0, deferred = 0, sentHour = 0;
  const hourAgo = Date.now() - 3600_000;
  for (const m of msgs.data ?? []) {
    const domain = (m.email.split('@')[1] ?? '?').toLowerCase();
    const k = domain + '|' + m.server_id;
    const g = groups.get(k) ?? { domain, server: label.get(m.server_id) ?? '—', queued: 0, claimed: 0, deferred: 0, failed: 0 };
    if (m.status === 'queued') { g.queued++; queued++; }
    if (m.status === 'claimed') { g.claimed++; claimed++; }
    if (m.delivery_state === 'deferred') { g.deferred++; deferred++; }
    if (m.status === 'failed') g.failed++;
    if (m.sent_at && Date.parse(m.sent_at) > hourAgo) sentHour++;
    groups.set(k, g);
  }
  const rows = [...groups.values()].filter(g => g.queued + g.claimed + g.deferred + g.failed > 0).sort((a, b) => b.queued + b.claimed - a.queued - a.claimed).slice(0, 200);
  return { rows, totals: { queued, claimed, deferred, sentHour }, campaigns: camps.data ?? [], fetchedAt: new Date().toISOString() };
});

const ISPS: Record<string, string> = { Gmail: 'gmail.com, googlemail.com', Microsoft: 'outlook.com, hotmail.com, live.com, msn.com', Yahoo: 'yahoo.com, yahoo.fr, aol.com', Orange: 'orange.fr, wanadoo.fr', 'Free / SFR': 'free.fr, sfr.fr, neuf.fr' };

export const readShaping = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context, '/dashboard/shaping');
  const db = context.supabase;
  const [plans, ips, events] = await Promise.all([
    db.from('warmup_plans').select('ip_id,isp,daily_limits,current_day,status'),
    db.from('server_ips').select('id,address,server_id').eq('active', true),
    db.from('delivery_events').select('isp,event_type,smtp_code,occurred_at,recipient').in('event_type', ['deferred', 'bounce']).order('occurred_at', { ascending: false }).limit(30),
  ]);
  for (const r of [plans, ips, events]) if (r.error) throw new Error('Lecture du shaping impossible');
  const { ispHealth } = await import('./infrastructure.schemas');
  const recent = await db.from('delivery_events').select('recipient,event_type').gte('occurred_at', new Date(Date.now() - 3600_000).toISOString()).limit(20000);
  const health = ispHealth(recent.data ?? []);
  const addr = new Map((ips.data ?? []).map((i: any) => [i.id, i.address]));
  const caps: Record<string, { ips: number; daily: number }> = {};
  for (const p of plans.data ?? []) {
    if (p.status === 'paused') continue;
    const lim = p.daily_limits[Math.min(p.current_day, p.daily_limits.length - 1)] ?? 0;
    const c = caps[p.isp] ?? { ips: 0, daily: 0 }; c.ips++; c.daily += lim; caps[p.isp] = c;
  }
  // Mirrors the policy compiled into the agent Lua (kumo.server.ts): hourly rate = daily cap / 24, 3 connections.
  const rules = Object.entries(ISPS).map(([isp, domains]) => {
    const c = caps[isp];
    const h = health[isp], f = h?.factor ?? 1;
    return { isp, domains, ips: c?.ips ?? 0, daily: c?.daily ?? 0, hourly: c ? Math.max(1, Math.ceil((c.daily / 24) * f)) : null, connections: Math.max(1, Math.round((c ? 3 : 10) * f)), factor: f, reason: h?.reason ?? 'Normal', sample: h?.total ?? 0 };
  });
  const plansOut = (plans.data ?? []).map((p: any) => ({ ...p, address: addr.get(p.ip_id) ?? '—' }));
  return { rules, plans: plansOut, signals: events.data ?? [] };
});

// ---- Mail-Tester VPS connector (built by Codex). Contract: docs/CODEX.md ----
async function mt(path: string, init?: RequestInit) {
  const url = process.env['MAILTESTER_URL'], key = process.env['MAILTESTER_KEY'];
  if (!url || !key) return { configured: false as const };
  const r = await fetch(url.replace(/\/$/, '') + path, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Mail-Tester ${r.status}: ${text.slice(0, 200)}`);
  return { configured: true as const, body: JSON.parse(text) };
}
export const mailTesterNew = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context, '/dashboard/lab');
  const r = await mt('/api/v1/tests', { method: 'POST', body: '{}' });
  return r.configured ? { configured: true, test: r.body as { test_id: string; email: string } } : { configured: false, test: null };
});
export const mailTesterResult = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/) }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, '/dashboard/lab');
    const r = await mt('/api/v1/tests/' + data.id);
    return r.configured ? { configured: true, result: r.body as any } : { configured: false, result: null };
  });

// ---- Inbox placement (seed mailboxes polled by the Mail-Tester VPS over IMAP). Contract: docs/CODEX.md §4 ----
export type PlacementSeed = { provider: string; address: string; placement: 'inbox' | 'promotions' | 'spam' | 'missing' | 'pending'; folder?: string | null; received_at?: string | null };
export const placementNew = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context, '/dashboard/inbox-tester');
  const r = await mt('/api/v1/placement', { method: 'POST', body: '{}' });
  return r.configured ? { configured: true, test: r.body as { id: string; token: string; seeds: PlacementSeed[]; expires_at: string } } : { configured: false, test: null };
});
export const placementResult = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/) }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, '/dashboard/inbox-tester');
    try {
      const r = await mt('/api/v1/placement/' + data.id);
      return r.configured ? { configured: true, result: r.body as { id: string; token: string; status: 'waiting' | 'done'; seeds: PlacementSeed[] }, error: null } : { configured: false, result: null, error: null };
    } catch (e) {
      // VPS without §4 yet → explicit message instead of a crash.
      return { configured: true, result: null, error: (e as Error).message.includes('404') ? 'Le serveur Mail-Tester ne gère pas encore le test de placement (contrat §4 à livrer par Codex).' : (e as Error).message };
    }
  });
