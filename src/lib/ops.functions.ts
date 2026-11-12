import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { dmarcDomain } from './dmarc-policy';
import { recipientDomain } from './email-address';

// Task-gated access: superadmin, or worker whose active task includes the path.
async function gate(context: any, path: string) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error) throw new Error('Vérification des droits impossible');
  if (role.data) return true;
  const t = await context.supabase.from('worker_tasks').select('allowed_paths').eq('user_id', context.userId).eq('status', 'active');
  if (t.error || !(t.data ?? []).some((r: any) => (r.allowed_paths ?? []).includes(path))) throw new Error('Accès non autorisé');
  return false;
}

export const readProtection = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const isAdmin = await gate(context, '/dashboard/shield');
  const db = isAdmin ? context.supabase : (await import('@/integrations/supabase/client.server')).supabaseAdmin;
  const [alerts, campaigns, ips] = await Promise.all([
    db.from('delivery_alerts').select('id,campaign_name,rule,isp,rate,sample_size,created_at').order('created_at', { ascending: false }).limit(25),
    db.from('campaigns').select('id,name,status,auto_pause_reason').in('status', ['queued','paused']).order('created_at', { ascending: false }).limit(50),
    db.from('server_ips').select('id,address,quarantined_at,quarantine_reason').eq('active', true).not('quarantined_at', 'is', null).order('quarantined_at', { ascending: false }).limit(50),
  ]);
  if (alerts.error || campaigns.error || ips.error) throw new Error('Impossible de charger l’état des protections.');
  return { isAdmin, alerts: alerts.data, campaigns: campaigns.data, ips: ips.data };
});

export const inspectDmarcPolicy = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.string().max(253).parse(input))
  .handler(async ({ context, data }) => {
    await gate(context, '/dashboard/lab');
    const domain = dmarcDomain(data);
    if (!domain || domain.length > 246) throw new Error('Saisissez un nom de domaine valide.');
    const { readDmarcPolicy } = await import('./dmarc-policy.server');
    return readDmarcPolicy(domain);
  });

export const inspectSenderDns = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({
    domain: z.string().max(253), selector: z.string().regex(/^[a-z0-9_-]{1,63}$/i).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await gate(context, '/dashboard/lab');
    const domain = dmarcDomain(data.domain);
    if (!domain) throw new Error('Saisissez un domaine valide.');
    const { senderRecords, spfLookupBudget } = await import('./sender-dns.server');
    const signal = AbortSignal.timeout(7500);
    if (!data.selector) {
      const budget = await spfLookupBudget(domain, name => senderRecords(name, 'TXT', signal));
      return { name: domain, status: budget.status, terms: budget.terms, records: null };
    }
    const name = data.selector.toLowerCase() + '._domainkey.' + domain;
    if (name.length > 253) throw new Error('Nom DNS trop long.');
    const entries = await senderRecords(name, 'TXT', signal);
    const records = entries?.filter(record => /(?:^|;)\s*p\s*=/i.test(record)) ?? null;
    const status = !records ? 'unknown' : !records.length ? 'missing' : records.length > 1 ? 'invalid'
      : /(?:^|;)\s*p\s*=\s*(?:;|$)/i.test(records[0]!) ? 'revoked' : 'published';
    return { name, status, records, terms: null };
  });

export const inspectDmarcAuthorization = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ domain: z.string().max(253), aggregate: z.string().max(254) }).parse(input))
  .handler(async ({ context, data }) => {
    const admin = await gate(context, '/dashboard/lab');
    const domain = dmarcDomain(data.domain);
    const destination = recipientDomain(data.aggregate.trim());
    if (!domain || !destination || domain === destination) throw new Error('Saisissez un domaine de politique et une destination externe.');
    const { readDmarcAuthorization } = await import('./dmarc-policy.server');
    const canPublish = admin && data.aggregate.trim().toLowerCase() === process.env['DMARC_REPORT_DESTINATION']?.trim().toLowerCase();
    return { ...await readDmarcAuthorization(domain, destination), canPublish };
  });

export const inspectDane = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ domain: z.string().max(253), mx: z.string().max(253) }).parse(input))
  .handler(async ({ context, data }) => {
    const canPublish = await gate(context, '/dashboard/lab');
    const domain = dmarcDomain(data.domain);
    const mx = dmarcDomain(data.mx);
    if (!domain || !mx || mx.length > 244) throw new Error('Saisissez un domaine et un hôte MX valides.');
    const { inspectDaneDns } = await import('./dane.server');
    return { ...await inspectDaneDns(domain, mx), canPublish };
  });

export const readQueues = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const superadmin = await gate(context, '/dashboard/queues');
  const db = context.supabase;
  const readUncertain = async () => {
    if (!superadmin) return null;
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const expired = new Date(Date.now() - 15 * 60_000).toISOString();
    const result = await supabaseAdmin.from('campaign_messages')
      .select('id,email,campaign_id,server_id,claimed_at,injection_uncertain_at', { count: 'exact' })
      .or(`injection_uncertain_at.not.is.null,and(status.eq.claimed,claimed_at.lt.${expired},delivery_state.eq.pending)`)
      .order('injection_uncertain_at', { ascending: false, nullsFirst: false })
      .order('claimed_at', { ascending: false }).order('id').limit(50);
    if (result.error?.code === '42703') return null;
    if (result.error) throw new Error('Lecture des injections à vérifier impossible');
    const ids = [...new Set(result.data.map(row => row.campaign_id))];
    const names = ids.length ? await supabaseAdmin.from('campaigns').select('id,name').in('id', ids) : null;
    if (names?.error) throw new Error('Lecture des campagnes à vérifier impossible');
    const byId = new Map(names?.data.map(campaign => [campaign.id, campaign.name]));
    return { count: result.count ?? result.data.length, rows: result.data.map(row => ({
      id: row.id, recipient: row.email, campaign: byId.get(row.campaign_id) ?? row.campaign_id,
      serverId: row.server_id, at: row.injection_uncertain_at ?? row.claimed_at,
    })) };
  };
  const [msgs, servers, camps, uncertain] = await Promise.all([
    db.from('campaign_messages').select('email,status,delivery_state,server_id,campaign_id,sent_at').in('status', ['queued', 'claimed', 'sent', 'failed']).order('created_at', { ascending: false }).limit(20000),
    db.from('managed_servers').select('id,label'),
    db.from('campaigns').select('id,name,status,auto_pause_reason').in('status', ['queued', 'sending', 'paused']).order('created_at', { ascending: false }).limit(50),
    readUncertain(),
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
  return {
    rows, totals: { queued, claimed, deferred, sentHour }, campaigns: camps.data ?? [], fetchedAt: new Date().toISOString(),
    uncertain: uncertain && { count: uncertain.count, rows: uncertain.rows.map(row => ({ ...row, server: label.get(row.serverId) ?? row.serverId })) },
  };
});

const ISPS: Record<string, string> = { Gmail: 'gmail.com, googlemail.com', Microsoft: 'outlook.com, hotmail.com, live.com, msn.com', Yahoo: 'yahoo.com, yahoo.fr, aol.com', Orange: 'orange.fr, wanadoo.fr', 'Free / SFR': 'free.fr, sfr.fr, neuf.fr' };

export const readShaping = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context, '/dashboard/shaping');
  const db = context.supabase;
  const [plans, ips, events] = await Promise.all([
    db.from('warmup_plans').select('ip_id,isp,daily_limits,current_day,status'),
    db.from('server_ips').select('id,address,server_id').eq('active', true),
    db.from('delivery_events').select('isp,event_type,smtp_code,detail,occurred_at,recipient').in('event_type', ['deferred', 'bounce']).order('occurred_at', { ascending: false }).limit(30),
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
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { routingDomains, sourceReputation } = await import('./isp-source-routing');
  const history = await supabaseAdmin.rpc('source_isp_history', { _server: null, _domains: routingDomains });
  return { rules, plans: plansOut, signals: events.data ?? [],
    matrix: sourceReputation(history.data ?? []), matrixAvailable: !history.error,
    matrixEnabled: process.env['KUMO_ISP_SOURCE_ROUTING'] === 'true',
  };
});

// ---- Mail-Tester VPS connector (built by Codex). Contract: docs/CODEX.md ----
async function mt(path: string, init?: RequestInit) {
  const { mailTesterRequest } = await import('./mail-tester.server');
  return mailTesterRequest(path, init);
}

async function manageSeeds(context: Parameters<typeof gate>[0], path = '', init?: RequestInit) {
  const role = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'superadmin' });
  if (role.error || !role.data) throw new Error('Accès réservé aux superadmins.');
  return mt('/api/v1/placement/seeds' + path, init);
}

const gmailAddress = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9.+_-]{0,62}@gmail\.com$/);
export const listPlacementSeeds = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await manageSeeds(context);
    return { configured: r.configured, accounts: r.configured ? r.body as { address: string }[] : [] };
  });

export const savePlacementSeed = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ address: gmailAddress, password: z.string().max(24).transform(s => s.replaceAll(' ', '')).pipe(z.string().regex(/^[a-zA-Z0-9]{16}$/)) }).parse(i))
  .handler(async ({ data, context }) => {
    const r = await manageSeeds(context, '', { method: 'PUT', body: JSON.stringify(data) });
    if (!r.configured) throw new Error('Le serveur Mail-Tester n’est pas configuré.');
    return { ok: true };
  });

export const removePlacementSeed = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => gmailAddress.parse(i))
  .handler(async ({ data, context }) => {
    const r = await manageSeeds(context, '/' + encodeURIComponent(data), { method: 'DELETE' });
    if (!r.configured) throw new Error('Le serveur Mail-Tester n’est pas configuré.');
    return { ok: true };
  });
export const mailTesterNew = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context, '/dashboard/lab');
  const r = await mt('/api/v1/tests', { method: 'POST', body: '{}' });
  return r.configured ? { configured: true, test: r.body as { test_id: string; email: string } } : { configured: false, test: null };
});
export const mailTesterResult = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/) }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, '/dashboard/lab');
    const r = await mt('/api/v1/tests/' + data.id + '?version=2');
    return r.configured ? { configured: true, result: r.body as any } : { configured: false, result: null };
  });

// ---- Inbox placement (seed mailboxes polled by the Mail-Tester VPS over IMAP). Contract: docs/CODEX.md §4 ----
export type PlacementSeed = { provider: string; address: string; placement: 'inbox' | 'promotions' | 'spam' | 'missing' | 'pending'; folder?: string | null; received_at?: string | null };
export const placementNew = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context, '/dashboard/inbox-tester');
  const r = await mt('/api/v1/placement', { method: 'POST', body: '{}' });
  if (!r.configured) return { configured: false, test: null };
  const test = r.body as { id: string; token: string; seeds: PlacementSeed[]; expires_at: string };
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const saved = await (supabaseAdmin as any).from('seed_placement_runs').insert({
    placement_id: test.id, token: test.token, status: 'waiting', seeds: test.seeds, started_by: context.userId,
    expires_at: test.expires_at ?? new Date(Date.now() + 48 * 3600_000).toISOString(),
  });
  if (saved.error) throw new Error('Le test a été créé, mais son historique n’a pas pu être enregistré. Appliquez la migration 0086.');
  return { configured: true, test };
});
export const placementResult = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(i => z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/) }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, '/dashboard/inbox-tester');
    try {
      const r = await mt('/api/v1/placement/' + data.id);
      if (!r.configured) return { configured: false, result: null, error: null };
      const result = r.body as { id: string; token: string; status: 'waiting' | 'done'; seeds: PlacementSeed[] };
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const completedAt = result.status === 'done' ? new Date().toISOString() : null;
      const saved = await (supabaseAdmin as any).from('seed_placement_runs').update({ seeds: result.seeds, status: result.status, checked_at: new Date().toISOString(), completed_at: completedAt }).eq('placement_id', data.id);
      if (saved.error) throw new Error('Le résultat est disponible, mais son historique n’a pas pu être actualisé. Appliquez la migration 0086.');
      return { configured: true, result, error: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Résultat indisponible.';
      return { configured: true, result: null, error: message.startsWith('Mail-Tester 404:') ? 'Test introuvable ou expiré.' : message };
    }
  });

export const placementHistory = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await gate(context, '/dashboard/inbox-tester');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const result = await (supabaseAdmin as any).from('seed_placement_runs').select('placement_id,status,seeds,started_at,completed_at').order('started_at', { ascending: false }).limit(100);
  if (result.error) {
    if (['PGRST205','42P01'].includes(result.error.code)) return null;
    throw new Error('Historique de placement indisponible.');
  }
  const rows = result.data ?? [];
  const providers = new Map<string, { provider: string; observations: number; inbox: number; promotions: number; spam: number; missing: number; pending: number }>();
  for (const run of rows) for (const seed of (Array.isArray(run.seeds) ? run.seeds : []) as PlacementSeed[]) {
    const entry = providers.get(seed.provider) ?? { provider: seed.provider, observations: 0, inbox: 0, promotions: 0, spam: 0, missing: 0, pending: 0 };
    entry.observations++; entry[seed.placement]++; providers.set(seed.provider, entry);
  }
  return { runs: rows.map((r: any) => ({ id: r.placement_id, status: r.status, started_at: r.started_at, completed_at: r.completed_at,
    counts: Object.fromEntries(['inbox','promotions','spam','missing','pending'].map(key => [key, Array.isArray(r.seeds) ? r.seeds.filter((s: PlacementSeed) => s.placement === key).length : 0])) })),
    providers: [...providers.values()].sort((a,b) => a.provider.localeCompare(b.provider)), total: rows.length };
});
