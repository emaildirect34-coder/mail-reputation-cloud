import type { DailyReport, ReportCounts } from './daily-report';

const zero = (): ReportCounts => ({ delivered: 0, bounce: 0, deferred: 0, complaint: 0 });

export async function buildDailyReport(db: any): Promise<DailyReport> {
  const since = new Date(Date.now() - 86400_000).toISOString();
  const totals = zero(); const byIsp = new Map<string, ReportCounts>();
  for (let off = 0; off < 200000; off += 1000) {
    const r = await db.from('delivery_events').select('event_type,isp').gte('occurred_at', since).range(off, off + 999);
    for (const e of r.data ?? []) {
      const k = e.event_type as keyof ReportCounts; if (!(k in totals)) continue;
      totals[k]++; const c = byIsp.get(e.isp || 'Autres') ?? zero(); c[k]++; byIsp.set(e.isp || 'Autres', c);
    }
    if ((r.data ?? []).length < 1000) break;
  }
  const day = since.slice(0, 10);
  const [fin, ips, agents, unsub] = await Promise.all([
    db.from('finance_entries').select('amount_cents,currency').eq('kind', 'revenue').in('status', ['approved', 'paid']).gte('created_at', since),
    db.from('server_ips').select('address').not('quarantined_at', 'is', null).eq('active', true),
    db.from('server_agents').select('last_seen,managed_servers(label)'),
    db.from('suppressions').select('email_md5', { count: 'exact', head: true }).eq('reason', 'unsubscribe').gte('created_at', since),
  ]);
  const revenueCents: Record<string, number> = {};
  for (const f of fin.data ?? []) revenueCents[f.currency] = (revenueCents[f.currency] ?? 0) + Number(f.amount_cents);
  const stale = Date.now() - 15 * 60_000;
  return {
    date: new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) || day,
    totals, isps: [...byIsp].map(([isp, counts]) => ({ isp, counts })).sort((a, b) => b.counts.delivered - a.counts.delivered),
    revenueCents, quarantined: (ips.data ?? []).map((i: any) => i.address),
    offlineServers: (agents.data ?? []).filter((a: any) => !a.last_seen || Date.parse(a.last_seen) < stale).map((a: any) => a.managed_servers?.label ?? 'serveur'),
    unsubscribes: unsub.count ?? 0,
  };
}

export async function sendDailyReport(db: any) {
  const { reportText } = await import('./daily-report');
  const { fireWebhooks } = await import('./webhooks.server');
  const report = await buildDailyReport(db);
  await fireWebhooks('daily_report', { ...report, text: reportText(report) });
  return report;
}
