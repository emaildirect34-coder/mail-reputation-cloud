// Pure daily-report formatting (24 h window), shared by the scheduled job and the "send now" button.
export type ReportCounts = { delivered: number; bounce: number; deferred: number; complaint: number };
export type DailyReport = { date: string; totals: ReportCounts; isps: { isp: string; counts: ReportCounts }[]; revenueCents: Record<string, number>; quarantined: string[]; offlineServers: string[]; unsubscribes: number };
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
export function reportAlerts(r: DailyReport): string[] {
  const a: string[] = [];
  const sent = r.totals.delivered + r.totals.bounce;
  if (pct(r.totals.complaint, r.totals.delivered) > 0.3) a.push(`Plaintes ${pct(r.totals.complaint, r.totals.delivered)} % (> 0,3 %)`);
  if (pct(r.totals.bounce, sent) > 5) a.push(`Rebonds ${pct(r.totals.bounce, sent)} % (> 5 %)`);
  for (const ip of r.quarantined) a.push(`IP en quarantaine : ${ip}`);
  for (const s of r.offlineServers) a.push(`Serveur hors ligne : ${s}`);
  return a;
}
export function reportText(r: DailyReport): string {
  const t = r.totals, sent = t.delivered + t.bounce;
  const money = Object.entries(r.revenueCents).map(([c, v]) => `${(v / 100).toFixed(2)} ${c}`).join(' · ') || '0';
  const lines = [
    `*Rapport Email Direct — ${r.date}*`,
    `Livrés : ${t.delivered.toLocaleString('fr-FR')} (${pct(t.delivered, sent)} %) · Rebonds : ${t.bounce} · Différés : ${t.deferred} · Plaintes : ${t.complaint} · Désinscriptions : ${r.unsubscribes}`,
    `Revenus validés : ${money}`,
    ...r.isps.slice(0, 8).map(i => `• ${i.isp} : ${i.counts.delivered} livrés · ${pct(i.counts.bounce, i.counts.delivered + i.counts.bounce)} % rebonds · ${i.counts.complaint} plaintes`),
  ];
  const al = reportAlerts(r);
  lines.push(al.length ? '⚠️ Alertes :\n' + al.map(x => '- ' + x).join('\n') : '✅ Aucune alerte');
  return lines.join('\n');
}
