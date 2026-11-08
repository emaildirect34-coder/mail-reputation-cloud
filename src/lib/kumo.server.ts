// Server-only: KumoMTA configuration generator and agent token helpers.
import { plannedQuota, effectiveDay, ISP_DOMAINS, ispHealth } from './infrastructure.schemas';

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return 'kag_' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

const q = (s: string) => JSON.stringify(s);

export type AgentBundle = { lua: string; hash: string; dkim: { domain: string; selector: string; key: string; bindingId: string }[] };

export async function buildBundle(db: any, serverId: string, withKeys: boolean): Promise<AgentBundle> {
  const [srv, ips, pools, binds] = await Promise.all([
    db.from('managed_servers').select('id,label,ipv4').eq('id', serverId).single(),
    db.from('server_ips').select('id,address,family,pool_id,rdns').eq('server_id', serverId).eq('active', true),
    db.from('vmta_pools').select('id,name,status'),
    db.from('server_domain_bindings').select('id,domain_id').eq('server_id', serverId),
  ]);
  for (const r of [srv, ips, pools, binds]) if (r.error) throw new Error(r.error.message);
  const domIds = (binds.data ?? []).map((b: any) => b.domain_id);
  const doms = domIds.length ? await db.from('sending_domains').select('id,domain,selector_a,selector_b' + (withKeys ? ',dkim_priv_a,dkim_priv_b' : '')).in('id', domIds) : { data: [] };
  if (doms.error) throw new Error(doms.error.message);
  const v4 = (ips.data ?? []).filter((i: any) => i.family === 4);
  const ipIds = v4.map((i: any) => i.id);
  const warm = ipIds.length ? await db.from('warmup_plans').select('ip_id,isp,daily_limits,current_day,status,created_at').in('ip_id', ipIds).eq('status', 'active') : { data: [] };
  if (warm.error) throw new Error(warm.error.message);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const ev = await db.from('delivery_events').select('recipient,event_type').eq('server_id', serverId).gte('occurred_at', since).limit(20000);
  const health = ispHealth(ev.error ? [] : ev.data ?? []);

  const src = (a: string) => 'ip-' + a.replace(/[.:]/g, '_');
  const poolMap = new Map<string, string[]>();
  for (const ip of v4) {
    const name = (pools.data ?? []).find((p: any) => p.id === ip.pool_id && p.status === 'active')?.name ?? 'default';
    poolMap.set(name, [...(poolMap.get(name) ?? []), src(ip.address)]);
  }
  const L: string[] = [];
  L.push(`-- Généré automatiquement pour ${srv.data.label}. Ne pas modifier à la main.`);
  L.push(`local kumo = require 'kumo'`, `local shaping = require 'policy-extras.shaping'`, '');
  L.push(`kumo.on('init', function()`);
  L.push(`  kumo.define_spool { name = 'data', path = '/var/spool/kumomta/data' }`);
  L.push(`  kumo.define_spool { name = 'meta', path = '/var/spool/kumomta/meta' }`);
  L.push(`  kumo.start_esmtp_listener { listen = '0.0.0.0:25', relay_hosts = { '127.0.0.1' } }`);
  L.push(`  kumo.start_http_listener { listen = '127.0.0.1:8000' }`);
  L.push(`  kumo.configure_local_logs { log_dir = '/var/log/kumomta', max_segment_duration = '1 minute', headers = { 'Subject' } }`, `end)`, '');
  L.push(`local SOURCES = {`);
  for (const ip of v4) L.push(`  [${q(src(ip.address))}] = { source_address = ${q(ip.address)}, ehlo_domain = ${q(ip.rdns ?? srv.data.label)} },`);
  L.push(`}`, `kumo.on('get_egress_source', function(name) return kumo.make_egress_source(SOURCES[name]) end)`, '');
  L.push(`local POOLS = {`);
  for (const [n, s] of poolMap) L.push(`  [${q(n)}] = { ${s.map(x => `{ name = ${q(x)} }`).join(', ')} },`);
  L.push(`}`, `kumo.on('get_egress_pool', function(name) return kumo.make_egress_pool { name = name, entries = POOLS[name] or POOLS['default'] or {} } end)`, '');
  // Warmup → per ISP daily caps (minimum across IPs of the plan quota)
  const caps: Record<string, number> = {};
  for (const w of warm.data ?? []) { const v = plannedQuota(w.daily_limits, effectiveDay(w as any)); caps[w.isp] = (caps[w.isp] ?? 0) + v; }
  // Dynamic regulation: hourly rate and connections are scaled down per ISP when the last hour shows complaints, bounces or deferrals.
  L.push(`local ISP_CAPS = {`);
  for (const [isp, ds] of Object.entries(ISP_DOMAINS)) {
    const f = health[isp]?.factor ?? 1, cap = caps[isp];
    if (cap === undefined && f === 1) continue;
    const conns = Math.max(1, Math.round((cap !== undefined ? 3 : 10) * f));
    const rate = cap !== undefined ? `, max_message_rate = ${q(`${Math.max(1, Math.ceil((cap / 24) * f))}/h`)}` : '';
    for (const d of ds) L.push(`  [${q(d)}] = { connection_limit = ${conns}${rate} },`);
  }
  L.push(`}`);
  L.push(`kumo.on('get_egress_path_config', function(domain, source, site)`);
  L.push(`  local c = ISP_CAPS[domain] or { connection_limit = 10 }`);
  L.push(`  return kumo.make_egress_path { enable_tls = 'OpportunisticInsecure', connection_limit = c.connection_limit, max_message_rate = c.max_message_rate }`);
  L.push(`end)`, '');
  L.push(`local DKIM = {`);
  for (const d of doms.data ?? []) L.push(`  [${q(d.domain)}] = { ${q(d.selector_a)}, ${q(d.selector_b)} },`);
  L.push(`}`);
  // Sign both SMTP-received and HTTP-injected (/api/inject/v1) messages; HTTP injection only fires http_message_generated.
  L.push(`local function sign(msg)`);
  L.push(`  local from = msg:from_header(); if not from then return end`);
  L.push(`  local dom = string.lower(from.domain); local sels = DKIM[dom]; if not sels then return end`);
  L.push(`  for _, sel in ipairs(sels) do`);
  L.push(`    msg:dkim_sign(kumo.dkim.rsa_sha256_signer { domain = dom, selector = sel, headers = { 'From','To','Subject','Date','Message-ID','List-Unsubscribe','List-Unsubscribe-Post' }, key = '/opt/kumomta/etc/dkim/' .. dom .. '/' .. sel .. '.key' })`);
  L.push(`  end`, `end`);
  // Inbound for our sending domains: ISP FBL (ARF) and async bounces are logged then dropped; unsubscribe@ mails are logged (Subject = token) then dropped.
  L.push(`kumo.on('get_listener_domain', function(domain, listener, conn_meta)`);
  L.push(`  if DKIM[string.lower(domain)] then return kumo.make_listener_domain { relay_to = true, log_arf = true, log_oob = true } end`);
  L.push(`end)`);
  L.push(`kumo.on('smtp_server_message_received', function(msg)`);
  L.push(`  local rcpt = msg:recipient(); local dom = rcpt and string.lower(rcpt.domain) or ''`);
  L.push(`  if DKIM[dom] then msg:set_meta('queue', 'null'); return end`);
  L.push(`  sign(msg)`);
  L.push(`end)`);
  L.push(`kumo.on('http_message_generated', function(msg) sign(msg) end)`);
  const lua = L.join('\n') + '\n';
  const dkim: AgentBundle['dkim'] = [];
  if (withKeys) for (const d of doms.data ?? []) {
    const b = (binds.data ?? []).find((x: any) => x.domain_id === d.id);
    dkim.push({ domain: d.domain, selector: d.selector_a, key: d.dkim_priv_a, bindingId: b.id }, { domain: d.domain, selector: d.selector_b, key: d.dkim_priv_b, bindingId: b.id });
  }
  return { lua, hash: await sha256(lua + (doms.data ?? []).map((d: any) => d.selector_a + d.selector_b).join()), dkim };
}

export async function agentFromRequest(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!/^kag_[0-9a-f]{64}$/.test(token)) return null;
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const r = await supabaseAdmin.from('server_agents').select('server_id').eq('token_hash', await sha256(token)).maybeSingle();
  return r.data ? { db: supabaseAdmin, serverId: r.data.server_id } : null;
}
