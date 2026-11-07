// Google Postmaster Tools v1 via service account (WebCrypto JWT, workerd-safe).
const API = "https://gmailpostmastertools.googleapis.com/v2";
let cached: { token: string; exp: number } | null = null;

function b64url(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function serviceAccount() {
  const raw = process.env["GOOGLE_POSTMASTER_SA"];
  if (!raw) throw new Error("Compte de service Google non configuré");
  return JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
}

export function serviceEmail() {
  return serviceAccount().client_email;
}

async function token() {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/postmaster.traffic.readonly https://www.googleapis.com/auth/postmaster.domain",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${b64url(sig)}` }),
  });
  const j: any = await res.json();
  if (!res.ok) { console.error("google token", j); throw new Error("Google a refusé le compte de service"); }
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function gget(path: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await token()}` } });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("postmaster", res.status, j);
    if (res.status === 403) throw new Error("API Postmaster non activée ou accès refusé dans Google Cloud");
    throw new Error(j?.error?.message ?? "Erreur Google Postmaster");
  }
  return j;
}

export type PmDomain = { name: string; createTime: string | null; permission: string | null };
export async function listDomains(): Promise<PmDomain[]> {
  const out: PmDomain[] = [];
  let page = "";
  do {
    const j = await gget(`/domains?pageSize=200${page ? `&pageToken=${page}` : ""}`);
    for (const d of j.domains ?? []) out.push({ name: String(d.name).replace(/^domains\//, ""), createTime: d.createTime ?? null, permission: d.permission ?? null });
    page = j.nextPageToken ?? "";
  } while (page);
  return out;
}

export type PmStat = {
  date: string;
  spamRate: number | null; spamLow: number | null; spamHigh: number | null;
  domainReputation: string | null;
  ipReputations: { reputation: string; ipCount: number; sampleIps: string[] }[];
  feedbackLoops: { id: string; spamRatio: number }[];
  spf: number | null; dkim: number | null; dmarc: number | null;
  inboundTls: number | null; outboundTls: number | null;
  deliveryErrors: { errorClass: string; errorType: string; errorRatio: number }[];
};

export async function trafficStats(domain: string, days: number): Promise<PmStat[]> {
  const end = new Date(); const start = new Date(Date.now() - days * 86400_000);
  const q = (p: string, d: Date) => `${p}.year=${d.getUTCFullYear()}&${p}.month=${d.getUTCMonth() + 1}&${p}.day=${d.getUTCDate()}`;
  const out: PmStat[] = [];
  let page = "";
  do {
    const j = await gget(`/domains/${encodeURIComponent(domain)}/trafficStats?${q("startDate", start)}&${q("endDate", end)}&pageSize=200${page ? `&pageToken=${page}` : ""}`);
    for (const s of j.trafficStats ?? []) {
      const id = String(s.name).split("/").pop() ?? "";
      out.push({
        date: id.length === 8 ? `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6)}` : id,
        spamRate: s.userReportedSpamRatio ?? null,
        spamLow: s.userReportedSpamRatioLowerBound ?? null, spamHigh: s.userReportedSpamRatioUpperBound ?? null,
        domainReputation: s.domainReputation ?? null,
        ipReputations: (s.ipReputations ?? []).map((r: any) => ({ reputation: r.reputation, ipCount: Number(r.ipCount ?? 0), sampleIps: r.sampleIps ?? [] })),
        feedbackLoops: (s.spammyFeedbackLoops ?? []).map((f: any) => ({ id: f.id, spamRatio: f.spamRatio ?? 0 })),
        spf: s.spfSuccessRatio ?? null, dkim: s.dkimSuccessRatio ?? null, dmarc: s.dmarcSuccessRatio ?? null,
        inboundTls: s.inboundEncryptionRatio ?? null, outboundTls: s.outboundEncryptionRatio ?? null,
        deliveryErrors: (s.deliveryErrors ?? []).map((e: any) => ({ errorClass: e.errorClass, errorType: e.errorType, errorRatio: e.errorRatio ?? 0 })),
      });
    }
    page = j.nextPageToken ?? "";
  } while (page);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
