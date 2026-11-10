import { dmarcDomain } from './dmarc-policy';

// Server-only: dual DKIM key generation, expected DNS records, and live DNS checks (DNS-over-HTTPS).
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export async function genDkim() {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = b64((await crypto.subtle.exportKey("spki", kp.publicKey)) as ArrayBuffer);
  const priv = b64((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
  return { pub, priv: `-----BEGIN PRIVATE KEY-----\n${(priv.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----` };
}

export type Rec = { key: string; type: string; name: string; content: string; priority?: number };
export type Dom = { domain: string; ip: string | null; selector_a: string; selector_b: string; dkim_pub_a: string; dkim_pub_b: string };

export function expectedRecords(d: Dom): Rec[] {
  const ip = d.ip ? ` ip4:${d.ip}` : "";
  const out: Rec[] = [
    { key: "spf", type: "TXT", name: d.domain, content: `v=spf1${ip} -all` },
    { key: "dkim_a", type: "TXT", name: `${d.selector_a}._domainkey.${d.domain}`, content: `v=DKIM1; k=rsa; p=${d.dkim_pub_a}` },
    { key: "dkim_b", type: "TXT", name: `${d.selector_b}._domainkey.${d.domain}`, content: `v=DKIM1; k=rsa; p=${d.dkim_pub_b}` },
    { key: "dmarc", type: "TXT", name: `_dmarc.${d.domain}`, content: `v=DMARC1; p=reject; adkim=s; aspf=s; pct=100; rua=mailto:dmarc@${d.domain}; ruf=mailto:dmarc@${d.domain}; fo=1` },
    { key: "mta_sts", type: "TXT", name: `_mta-sts.${d.domain}`, content: `v=STSv1; id=${Date.now().toString().slice(0, 10)}` },
    { key: "tls_rpt", type: "TXT", name: `_smtp._tls.${d.domain}`, content: `v=TLSRPTv1; rua=mailto:tlsrpt@${d.domain}` },
  ];
  if (d.ip) {
    out.unshift({ key: "a", type: "A", name: `mail.${d.domain}`, content: d.ip });
    out.push({ key: "mx", type: "MX", name: d.domain, content: `mail.${d.domain}`, priority: 10 });
  }
  return out;
}

async function doh(name: string, type: string): Promise<string[]> {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" } });
  if (!r.ok) return [];
  const j: any = await r.json();
  return (j.Answer ?? []).filter((a: any) => a.type === ({ A: 1, MX: 15, TXT: 16 } as any)[type]).map((a: any) => String(a.data).replace(/"\s*"/g, "").replace(/^"|"$/g, ""));
}

export async function checkDomain(d: Dom) {
  const recs = expectedRecords(d);
  const res: Record<string, { ok: boolean; found: string | null }> = {};
  await Promise.all(recs.map(async (r) => {
    const ans = await doh(r.name, r.type).catch(() => []);
    let hit: string | undefined;
    if (r.key === "spf") hit = ans.find((a) => a.startsWith("v=spf1"));
    else if (r.key === "dmarc") hit = ans.find((a) => a.startsWith("v=DMARC1"));
    else if (r.key.startsWith("dkim")) hit = ans.find((a) => a.replace(/\s/g, "").includes(r.content.split("p=")[1] ?? "__"));
    else if (r.key === "mx") hit = ans.find((a) => a.includes(`mail.${d.domain}`));
    else if (r.key === "a") hit = ans.find((a) => a === d.ip);
    else hit = ans[0];
    res[r.key] = { ok: !!hit, found: hit ?? ans[0] ?? null };
  }));
  return res;
}

/** Self-heal before publishing: pick the Cloudflare zone that really owns the domain (by name, across all accounts) and fill the sending IP from a connected server. */
export async function healDomain(db: any, d: any): Promise<{ d: any; acc: any | null; note: string }> {
  const { cfZones } = await import("./providers.server");
  const { data: accs } = await db.from("provider_accounts").select("*").eq("provider", "cloudflare");
  const ordered = [...(accs ?? [])].sort((a: any, b: any) => Number(b.id === d.account_id) - Number(a.id === d.account_id));
  let acc: any = null, zoneId: string | null = null, note = "";
  let zoneNameLength = 0;
  for (const a of ordered) {
    try {
      const zones = await cfZones(a);
      const z = zones.filter((x) => d.domain === x.name || d.domain.endsWith("." + x.name)).sort((x, y) => y.name.length - x.name.length)[0];
      if (z && z.name.length > zoneNameLength) {
        acc = a;
        zoneId = z.id;
        zoneNameLength = z.name.length;
        if (z.name === d.domain) break;
      }
    } catch (e) { note = (e as Error).message; }
  }
  let ip = d.ip;
  if (!ip) {
    const { data: ag } = await db.from("server_agents").select("server_id").neq("status", "awaiting");
    const ids = (ag ?? []).map((x: any) => x.server_id);
    if (ids.length) { const { data: s } = await db.from("managed_servers").select("ipv4").in("id", ids).not("ipv4", "is", null).limit(1); ip = s?.[0]?.ipv4 ?? null; }
  }
  const patch: any = {};
  if (acc && (acc.id !== d.account_id || zoneId !== d.zone_id)) { patch.account_id = acc.id; patch.zone_id = zoneId; }
  if (ip !== d.ip) patch.ip = ip;
  if (Object.keys(patch).length) await db.from("sending_domains").update(patch).eq("id", d.id);
  if (!acc) note = note || `Aucune zone Cloudflare ne contient « ${d.domain} ».`;
  return { d: { ...d, ...patch }, acc, note };
}

export async function publishDane(db: any, data: { domain: string; mx: string; fingerprint: string }, requiredServer?: string) {
  const domain = dmarcDomain(data.domain);
  const mx = dmarcDomain(data.mx);
  if (!domain || !mx || mx.length > 244 || (mx !== domain && !mx.endsWith('.' + domain))) {
    throw new Error('Le MX doit appartenir au domaine d’envoi sélectionné.');
  }
  const { data: configured, error } = await db.from('sending_domains').select('id,domain,account_id,zone_id,ip').eq('domain', domain).maybeSingle();
  if (error || !configured) throw new Error('Ajoutez d’abord ce domaine dans Domaines.');
  const { d, acc, note } = await healDomain(db, configured);
  if (!acc || !d.zone_id || !d.ip) throw new Error(note || 'Associez une zone et une IP d’envoi au domaine.');
  const { data: servers } = await db.from('managed_servers').select('id').eq('ipv4', d.ip);
  const ids = (servers ?? []).map((server: { id: string }) => server.id);
  if (requiredServer && !ids.includes(requiredServer)) throw new Error('Le MX ne correspond pas au serveur autoris\u00e9.');
  if (!ids.length) throw new Error('L’IPv4 d’envoi doit appartenir à un serveur connecté.');
  const { data: connected } = await db.from('server_agents').select('server_id').in('server_id', ids).neq('status', 'awaiting').limit(1);
  if (!connected?.length) throw new Error('L’IPv4 d’envoi doit appartenir à un serveur connecté.');
  const { inspectDaneDns, matchesSendingIp } = await import('./dane.server');
  const [dns, matches] = await Promise.all([inspectDaneDns(domain, mx), matchesSendingIp(mx, d.ip)]);
  if (dns.mx !== 'secure' || !matches) throw new Error('Le MX et son IPv4 d’envoi doivent être authentifiés par DNSSEC.');
  if (dns.tlsa === 'secure' && dns.fingerprints.includes(data.fingerprint)) return 'present' as const;
  if (!dns.authenticatedAbsence) throw new Error('La publication initiale exige une absence TLSA authentifiée par DNSSEC.');
  const { cfPublishInitialTlsa } = await import('./providers.server');
  return cfPublishInitialTlsa(acc, d.zone_id, dns.owner, data.fingerprint);
}
