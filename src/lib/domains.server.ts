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
