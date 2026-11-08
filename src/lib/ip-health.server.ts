import { quarantineDecision } from './ip-health';

// Re-checks a server's IPv4 blacklist status at most hourly; quarantined IPs are left out of the KumoMTA config.
export async function healServerIps(db: any, serverId: string, force = false) {
  const ips = await db.from('server_ips').select('id,address,quarantined_at,checked_at').eq('server_id', serverId).eq('active', true).eq('family', 4);
  if (ips.error) return [];
  const { scanTarget } = await import('./reputation.functions');
  const cutoff = Date.now() - 3600_000;
  const out: { address: string; action: string; listed: string[] }[] = [];
  for (const ip of ips.data ?? []) {
    if (!force && ip.checked_at && Date.parse(ip.checked_at) > cutoff) continue;
    const s = await scanTarget(ip.address);
    const listed = s.results.filter(r => r.status === 'listed').map(r => r.list);
    const action = quarantineDecision(!!ip.quarantined_at, listed);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { checked_at: now };
    if (action === 'quarantine') Object.assign(patch, { quarantined_at: now, quarantine_reason: 'Listée : ' + listed.join(', ') });
    if (action === 'release') Object.assign(patch, { quarantined_at: null, quarantine_reason: null });
    await db.from('server_ips').update(patch).eq('id', ip.id);
    out.push({ address: ip.address, action, listed });
  }
  return out;
}
