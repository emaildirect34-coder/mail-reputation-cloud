import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

type Channel = { name: 'telegram' | 'whatsapp'; send: (text: string) => Promise<Response> };

function channels() {
  const env = process.env;
  const enabled: Channel[] = [];
  const telegramToken = env['TELEGRAM_BOT_TOKEN'];
  const chatId = env['TELEGRAM_CHAT_ID'];
  if (telegramToken && /^\d+:[A-Za-z0-9_-]+$/.test(telegramToken) && chatId) {
    enabled.push({ name: 'telegram', send: text => fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ chat_id: chatId, text }),
    }) });
  }
  const token = env['WHATSAPP_ACCESS_TOKEN'];
  const sender = env['WHATSAPP_PHONE_NUMBER_ID'];
  const to = env['WHATSAPP_ALERT_RECIPIENT'];
  const template = env['WHATSAPP_ALERT_TEMPLATE'];
  const version = env['WHATSAPP_GRAPH_VERSION'];
  const language = env['WHATSAPP_ALERT_LANGUAGE'] || 'fr';
  if (token && sender && /^\d+$/.test(sender) && to && template && version && /^v\d+\.\d+$/.test(version)) {
    enabled.push({ name: 'whatsapp', send: text => fetch(`https://graph.facebook.com/${version}/${sender}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: {
        name: template, language: { code: language },
        components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
      } }),
    }) });
  }
  return enabled;
}

async function caddyIncident(db: SupabaseClient<Database>) {
  const endpoint = process.env['CADDY_HEALTHCHECK_URL'];
  if (!endpoint) return null;
  const url = new URL(endpoint);
  const expected = Number(process.env['CADDY_HEALTHCHECK_STATUS'] ?? 200);
  if (url.protocol !== 'https:' || url.username || url.password || !Number.isInteger(expected) || expected < 200 || expected >= 500) {
    throw new Error('Sonde Caddy mal configurée.');
  }
  const checkedAt = new Date().toISOString();
  let healthy = false;
  try {
    const response = await fetch(url, {
      method: 'GET', headers: { 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    const proxy = [response.headers.get('via'), response.headers.get('server')].join(' ');
    healthy = response.status === expected && /\bCaddy\b/i.test(proxy);
    await response.body?.cancel();
  } catch { /* Unreachable or invalid HTTPS is a failed check. */ }
  const state = await db.rpc('record_caddy_probe', { _healthy: healthy, _checked_at: checkedAt });
  if (state.error) throw new Error('Le registre des sondes Caddy est indisponible.');
  return state.data ? {
    key: `caddy:${state.data}`,
    text: `Le point de contrôle HTTPS de Caddy (${url.hostname}) a échoué deux fois de suite.`,
  } : null;
}

export async function notifyIncidents(db: SupabaseClient<Database>) {
  const targets = channels();
  if (!targets.length) return { configured: false, sent: 0, failed: 0 };
  const now = Date.now();
  const recent = new Date(now - 24 * 3_600_000).toISOString();
  const offline = new Date(now - 5 * 60_000).toISOString();
  const [ips, fbl, agents, caddy, sponsor, campaignIncidents] = await Promise.all([
    db.from('server_ips').select('id,address,quarantined_at').gte('quarantined_at', recent).order('quarantined_at', { ascending: false }).limit(100),
    db.from('delivery_alerts').select('id,campaign_name,isp,rate').eq('rule', 'complaint').gt('rate', 0.003)
      .gte('created_at', recent).order('created_at', { ascending: false }).limit(100),
    db.from('server_agents').select('server_id,last_seen,managed_servers!inner(label,status)')
      .neq('managed_servers.status', 'absent').lt('last_seen', offline).limit(100),
    caddyIncident(db).then(incident => ({ incident, failed: false })).catch(() => ({ incident: null, failed: true })),
    db.from('sponsor_link_monitor').select('campaign_id,alert_since,campaigns!inner(name)')
      .not('alert_since', 'is', null).gt('active_until', new Date(now).toISOString())
      .order('alert_since', { ascending: false }).limit(100),
    db.from('operations_incidents').select('id,kind,title,detail').eq('kind','campaign_stalled').is('signal_cleared_at',null).is('resolved_at',null).limit(100),
  ]);
  if (ips.error || fbl.error || agents.error) throw new Error('Lecture des incidents impossible.');
  const incidents = [
    ...ips.data.map(ip => ({ key: `quarantine:${ip.id}:${ip.quarantined_at}`, text: `IP ${ip.address} mise en quarantaine.` })),
    ...fbl.data.map(alert => ({ key: `complaint:${alert.id}`, text: `Plaintes FBL à ${(alert.rate * 100).toFixed(2)} % chez ${alert.isp} pour ${alert.campaign_name}.` })),
    ...agents.data.map(agent => ({ key: `offline:${agent.server_id}:${agent.last_seen}`, text: `Serveur ${agent.managed_servers.label} sans signal depuis plus de cinq minutes.` })),
    ...(caddy.incident ? [caddy.incident] : []),
    ...(sponsor.data ?? []).map(row => ({ key: `sponsor-link:${row.campaign_id}:${row.alert_since}`,
      text: `Lien sponsor à vérifier dans la campagne « ${row.campaigns.name} ». Consultez la surveillance dans Offres sponsors.` })),
    ...(campaignIncidents.data??[]).map(row=>({key:`campaign-stalled:${row.id}`,text:`${row.title}. ${row.detail}`})),
  ];
  let sent = 0;
  let failed = Number(caddy.failed) + Number(!!sponsor.error && !['PGRST205', '42P01'].includes(sponsor.error.code))+Number(!!campaignIncidents.error&&!['PGRST205','42P01'].includes(campaignIncidents.error.code));
  let maxProviderResponseMs = 0;
  for (const incident of incidents) {
    for (const channel of targets) {
      const claim = await db.rpc('claim_incident_notification', { _key: incident.key, _channel: channel.name });
      if (claim.error) throw new Error('Le registre des alertes est indisponible.');
      if (!claim.data) continue;
      try {
        const started = Date.now();
        const response = await channel.send(`Email Direct · ${incident.text}`.replace(/\s+/g, ' ').slice(0, 512));
        if (!response.ok) throw new Error('Notification refusée.');
        maxProviderResponseMs = Math.max(maxProviderResponseMs, Date.now() - started);
        const saved = await db.from('incident_notifications').update({ sent_at: new Date().toISOString() })
          .eq('event_key', incident.key).eq('channel', channel.name);
        if (saved.error) throw new Error('Notification non journalisée.');
        sent++;
      } catch { failed++; }
    }
  }
  return { configured: true, sent, failed, maxProviderResponseMs: sent ? maxProviderResponseMs : null };
}
