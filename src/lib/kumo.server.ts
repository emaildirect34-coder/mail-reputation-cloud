// Server-only: KumoMTA configuration generator and agent token helpers.
import { plannedQuota, effectiveDay, ISP_DOMAINS, ispHealth } from './infrastructure.schemas';
import { reputationWeights, routingDomains, routingProviders, sourceReputation } from './isp-source-routing';

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
    db.from('server_ips').select('id,address,family,pool_id,rdns').eq('server_id', serverId).eq('active', true).is('quarantined_at', null),
    db.from('vmta_pools').select('id,purpose,status'),
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
  const googleHold = await db.from('delivery_provider_holds').select('until_at').eq('reason', 'gmail_rate')
    .gte('until_at', new Date(Date.now() - 20 * 60_000).toISOString()).limit(1);
  const googleRecovery = !googleHold.error && !!googleHold.data?.length;
  const matrixEnabled = process.env['KUMO_ISP_SOURCE_ROUTING'] === 'true';
  const history = matrixEnabled ? await db.rpc('source_isp_history', { _server: serverId, _domains: routingDomains }) : null;
  if (history?.error) throw new Error('Historique IP × FAI indisponible. La configuration existante est conservée.');
  const reputation = sourceReputation(history?.data ?? []);

  const src = (a: string) => 'ip-' + a.replace(/[.:]/g, '_');
  const poolMap = new Map<string, string[]>([['default', []]]);
  const poolsById = new Map<string, { purpose: string; status: string }>();
  for (const pool of pools.data ?? []) poolsById.set(pool.id, pool);
  const addToPool = (name: string, ip: string) => {
    const entries = poolMap.get(name) ?? [];
    entries.push(src(ip));
    poolMap.set(name, entries);
  };
  const sources = [];
  for (const ip of v4) {
    const pool = ip.pool_id ? poolsById.get(ip.pool_id) : null;
    if (ip.pool_id && (!pool || pool.status !== 'active' || !['marketing', 'transactional', 'warmup'].includes(pool.purpose))) continue;
    sources.push(ip);
    if (pool) addToPool(`ed-vmta-${ip.pool_id}`, ip.address);
    if (!pool || pool.purpose === 'marketing') addToPool('default', ip.address);
  }
  const L: string[] = [];
  L.push(`-- Généré automatiquement pour ${srv.data.label}. Ne pas modifier à la main.`);
  L.push(`local kumo = require 'kumo'`, `local shaping = require 'policy-extras.shaping'`, '');
  const enableDane = process.env['KUMO_ENABLE_DANE'] === 'true';
  const tls13Only = process.env['KUMO_TLS13_ONLY'] === 'true';
  const requireModernTls = tls13Only || process.env['KUMO_REQUIRE_MODERN_TLS'] === 'true';
  const smtpClientCert = process.env['KUMO_SMTP_CLIENT_CERT'] === 'true';
  L.push(`kumo.on('init', function()`);
  if (enableDane) {
    const resolver = process.env['KUMO_DNSSEC_RESOLVER'] ?? '1.1.1.1:53';
    L.push(`  kumo.dns.configure_resolver { Hickory = { name_servers = { ${q(resolver)} }, options = { validate = true } } }`);
  }
  L.push(`  kumo.define_spool { name = 'data', path = '/var/spool/kumomta/data' }`);
  L.push(`  kumo.define_spool { name = 'meta', path = '/var/spool/kumomta/meta' }`);
  L.push(`  kumo.start_esmtp_listener { listen = '0.0.0.0:25', relay_hosts = { '127.0.0.1' } }`);
  L.push(`  kumo.start_http_listener { listen = '127.0.0.1:8000' }`);
  L.push(`  kumo.configure_local_logs { log_dir = '/var/log/kumomta', max_segment_duration = '1 minute', headers = { 'Subject' } }`, `end)`, '');
  L.push(`local SOURCES = {`);
  for (const ip of sources) {
    const name = q(src(ip.address));
    L.push(`  [${name}] = { name = ${name}, source_address = ${q(ip.address)}, ehlo_domain = ${q(ip.rdns ?? srv.data.label)} },`);
  }
  L.push(`}`, `kumo.on('get_egress_source', function(name) return kumo.make_egress_source(SOURCES[name]) end)`, '');
  L.push(`local POOLS = {`);
  for (const [n, s] of poolMap) L.push(`  [${q(n)}] = { ${s.map(x => `{ name = ${q(x)} }`).join(', ')} },`);
  const reputationRoutes: string[] = [];
  const sourceAddresses = new Map<string, string>(sources.map(ip => [src(ip.address), ip.address]));
  const idsByAddress = new Map<string, string>(sources.map(ip => [ip.address, ip.id]));
  const warmupByIsp = new Set((warm.data ?? []).map((plan: { ip_id: string; isp: string }) => `${plan.ip_id}/${plan.isp}`));
  for (const [base, names] of poolMap) {
    const configured = base === 'default' ? null : poolsById.get(base.slice('ed-vmta-'.length));
    if (!matrixEnabled || (base !== 'default' && configured?.purpose !== 'marketing')) continue;
    const addresses = names.map(name => sourceAddresses.get(name)!);
    for (const [index, [isp, domains]] of routingProviders.entries()) {
      if (addresses.some(address => {
        const id = idsByAddress.get(address);
        return warmupByIsp.has(`${id}/${isp}`) || ((isp === 'Free' || isp === 'SFR') && warmupByIsp.has(`${id}/Free / SFR`));
      })) continue;
      const weights = reputationWeights(addresses, reputation, isp);
      if (!weights) continue;
      const pool = `${base}-isp-${index}`;
      L.push(`  [${q(pool)}] = { ${names.map((name, i) => `{ name = ${q(name)}, weight = ${weights[i]} }`).join(', ')} },`);
      for (const domain of domains) reputationRoutes.push(`[${q(base + '@' + domain)}] = ${q(pool)}`);
    }
  }
  L.push(`}`, `kumo.on('get_egress_pool', function(name) return kumo.make_egress_pool { name = name, entries = POOLS[name] or {} } end)`, '');
  L.push(`local REPUTATION_POOLS = { ${reputationRoutes.join(', ')} }`);
  L.push(`kumo.on('get_queue_config', function(domain, tenant, campaign, routing_domain)`);
  L.push(`  local pool = tenant and string.match(tenant, '^ed%-vmta%-[%x%-]+$') and tenant or 'default'`);
  L.push(`  pool = REPUTATION_POOLS[pool .. '@' .. domain] or pool`);
  // Kumo applies its own jittered exponential backoff per delivery attempt.
  L.push(`  return kumo.make_queue_config { egress_pool = pool, retry_interval = '20 minutes' }`);
  L.push(`end)`, '');
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
  const lockstepSites = [...new Set((process.env['KUMO_SMTP_LOCKSTEP_SITES'] ?? '').split(',').map(site => site.trim()).filter(Boolean))].sort();
  if (lockstepSites.some(site => /[^\x21-\x7e]/.test(site))) throw new Error('KUMO_SMTP_LOCKSTEP_SITES doit contenir des identifiants MX ASCII exacts.');
  L.push(`local SMTP_LOCKSTEP_SITES = { ${lockstepSites.map(site => `[${q(site)}] = true`).join(', ')} }`);
  const providerDomains = {
    orange: ['orange.fr', 'wanadoo.fr', 'wanadoo.es'],
    sfr: ['sfr.fr', 'neuf.fr', 'cegetel.net', 'numericable.fr', 'club-internet.fr'],
    free: ['free.fr', 'aliceadsl.fr', 'libertysurf.fr'],
    microsoft: ISP_DOMAINS['Microsoft'] ?? [],
  };
  L.push('local SHARED_ISP = {');
  for (const [provider, domains] of Object.entries(providerDomains)) {
    for (const domain of domains) L.push(`  [${q(domain)}] = ${q(provider)},`);
  }
  L.push('}');
  L.push(`kumo.on('get_egress_path_config', function(domain, source, site)`);
  L.push(`  local c = ISP_CAPS[domain] or { connection_limit = 10 }`);
  L.push(`  local limits = {}`);
  L.push(`  local shared_connections = {}`);
  L.push(`  local connections = c.connection_limit`);
  L.push(`  local provider = SHARED_ISP[domain]`);
  L.push(`  local telco = provider and provider ~= 'microsoft'`);
  L.push(`  if provider then`);
  L.push(`    local cap = provider == 'orange' and 2 or (telco and 3 or 10)`);
  L.push(`    limits[provider .. '-' .. source] = telco and '2/s,max_burst=1' or '5/s,max_burst=1'`);
  L.push(`    connections = math.min(connections, cap); shared_connections[provider .. '-' .. source] = cap`);
  L.push(`  end`);
  const dane = enableDane ? ', enable_dane = true' : '';
  L.push(`  local path = { enable_tls = 'OpportunisticInsecure', connection_limit = connections, max_message_rate = c.max_message_rate, additional_message_rate_throttles = limits, additional_connection_limits = shared_connections${dane} }`);
  if (requireModernTls) {
    L.push(`  path.enable_tls = 'Required'; path.tls_prefer_openssl = true`);
    L.push(`  path.openssl_options = 'NO_SSLV2|NO_SSLV3|NO_TLSV1|NO_TLSV1_1|NO_COMPRESSION${tls13Only ? '|NO_TLSV1_2' : ''}'`);
    L.push(`  path.openssl_cipher_list = 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305'`);
    L.push(`  path.openssl_cipher_suites = 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256'`);
  }
  if (smtpClientCert) {
    L.push(`  path.tls_certificate = '/opt/kumomta/etc/tls/smtp-client-chain.pem'`);
    L.push(`  path.tls_private_key = '/opt/kumomta/etc/tls/smtp-client-key.pem'`);
  }
  L.push(`  if domain == 'gmail.com' or domain == 'googlemail.com' or string.match(site or '', '%.google%.com$') or string.match(site or '', '%.googlemail%.com$') then`);
  L.push(`    path.connection_limit = math.min(connections, ${googleRecovery ? 1 : 10}); shared_connections[${googleRecovery ? "'google-recovery'" : "'google-' .. source"}] = ${googleRecovery ? 1 : 10}`);
  L.push(`    path.max_connection_rate = '${googleRecovery ? "1/min,max_burst=1" : "30/min,max_burst=3"}'; path.max_deliveries_per_connection = 20`);
  L.push(`  end`);
  L.push(`  path.enable_pipelining = not telco and not SMTP_LOCKSTEP_SITES[site]`);
  L.push(`  if telco then path.max_recipients_per_batch = 1 end`);
  L.push(`  if provider == 'orange' then path.max_deliveries_per_connection = 100 end`);
  L.push(`  return kumo.make_egress_path(path)`);
  L.push(`end)`, '');
  L.push(`local DKIM = {`);
  for (const d of doms.data ?? []) L.push(`  [${q(d.domain)}] = { ${q(d.selector_a)}, ${q(d.selector_b)} },`);
  L.push(`}`);
  // Sign both SMTP-received and HTTP-injected (/api/inject/v1) messages; HTTP injection only fires http_message_generated.
  L.push(`local function sign(msg)`);
  L.push(`  local from = msg:from_header(); if not from then return end`);
  L.push(`  local dom = string.lower(from.domain); local sels = DKIM[dom]; if not sels then return end`);
  L.push(`  for _, sel in ipairs(sels) do`);
  L.push(`    msg:dkim_sign(kumo.dkim.rsa_sha256_signer { domain = dom, selector = sel, over_sign = true, headers = { 'From','To','Subject','Date','Message-ID','List-Unsubscribe','List-Unsubscribe-Post','List-Id','List-Help','List-Owner','List-Archive','Feedback-ID','Precedence','X-Auto-Response-Suppress' }, key = '/opt/kumomta/etc/dkim/' .. dom .. '/' .. sel .. '.key' })`);
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
  L.push(`local function is_uuid(value)`);
  L.push(`  return type(value) == 'string' and #value == 36 and value:match('^%x+%-%x+%-%x+%-%x+%-%x+$') ~= nil`);
  L.push(`end`);
  L.push(`kumo.on('http_message_generated', function(msg)`);
  L.push(`  local extra = msg:get_meta('extra')`);
  L.push(`  if type(extra) == 'table' then`);
  L.push(`    if is_uuid(extra.campaign_id) then msg:set_meta('campaign', string.lower(extra.campaign_id)) end`);
  L.push(`    if is_uuid(extra.pool_id) then msg:set_meta('tenant', 'ed-vmta-' .. string.lower(extra.pool_id)) end`);
  L.push(`  end`);
  L.push(`  sign(msg)`);
  L.push(`end)`);
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
