// DMARC aggregate report (RFC 7489 Appendix C) parsing — pure, runs in browser, server and tests.
export type DmarcRecord = { ip: string; count: number; disposition: string; dkim: 'pass' | 'fail'; spf: 'pass' | 'fail'; headerFrom: string };
export type DmarcReport = { orgName: string; reportId: string; domain: string; policy: string; dateBegin: number; dateEnd: number; records: DmarcRecord[] };

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))?.[1]?.trim() ?? '';
const blocks = (xml: string, name: string) => xml.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'g')) ?? [];

export function parseDmarcXml(xml: string): DmarcReport {
  const meta = tag(xml, 'report_metadata');
  const pol = tag(xml, 'policy_published');
  if (!meta || !pol) throw new Error("Ce fichier n'est pas un rapport DMARC agrégé");
  const records = blocks(xml, 'record').map((r) => {
    const ev = tag(r, 'policy_evaluated');
    return {
      ip: tag(r, 'source_ip'),
      count: Number(tag(r, 'count')) || 0,
      disposition: tag(ev, 'disposition') || 'none',
      dkim: tag(ev, 'dkim') === 'pass' ? 'pass' : 'fail',
      spf: tag(ev, 'spf') === 'pass' ? 'pass' : 'fail',
      headerFrom: tag(tag(r, 'identifiers'), 'header_from'),
    } as DmarcRecord;
  }).filter((r) => r.ip);
  const range = tag(meta, 'date_range');
  return {
    orgName: tag(meta, 'org_name') || 'Inconnu',
    reportId: tag(meta, 'report_id') || crypto.randomUUID(),
    domain: tag(pol, 'domain').toLowerCase(),
    policy: tag(pol, 'p') || 'none',
    dateBegin: Number(tag(range, 'begin')) || 0,
    dateEnd: Number(tag(range, 'end')) || 0,
    records,
  };
}

/** DMARC passes when SPF or DKIM passes aligned. */
export const passes = (r: DmarcRecord) => r.dkim === 'pass' || r.spf === 'pass';

export type SourceKind = 'own' | 'forwarder' | 'spoof';
/** own = one of our sending IPs; spoof = unknown IP failing DMARC; forwarder = unknown IP passing (e.g. Google Workspace). */
export function classify(r: DmarcRecord, ownIps: Set<string>): SourceKind {
  if (ownIps.has(r.ip)) return 'own';
  return passes(r) ? 'forwarder' : 'spoof';
}

export function advice(r: DmarcRecord, kind: SourceKind, policy: string): string {
  if (kind === 'own') {
    if (passes(r) && r.dkim === 'pass') return 'Conforme : rien à faire.';
    if (r.dkim === 'fail') return "Votre serveur n'a pas signé DKIM aligné : vérifiez que les clés sont installées (Lab → Corriger automatiquement).";
    return "SPF non aligné : ajoutez cette IP au SPF du domaine.";
  }
  if (kind === 'forwarder') return 'Service tiers authentifié (ex. Google Workspace, transfert) : légitime si vous l\'utilisez.';
  return policy === 'reject' ? 'Usurpation bloquée par votre politique reject.' : policy === 'quarantine' ? 'Usurpation envoyée en spam. Passez à p=reject pour la bloquer.' : 'Usurpation NON bloquée : passez votre DMARC à p=quarantine puis p=reject.';
}
