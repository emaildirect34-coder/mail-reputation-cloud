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

export type PmDomain = { name: string; createTime: string | null; permission: string | null; verified: boolean };
export async function listDomains(): Promise<PmDomain[]> {
  const out: PmDomain[] = [];
  let page = "";
  do {
    const j = await gget(`/domains?pageSize=200${page ? `&pageToken=${page}` : ""}`);
    for (const d of j.domains ?? []) out.push({ name: String(d.name).replace(/^domains\//, ""), createTime: d.createTime ?? null, permission: d.permission ?? null, verified: d.verificationState === "VERIFIED" });
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

const ERR: [string, string][] = [
  ["reject", "bad_attachment"], ["reject", "bad_or_missing_ptr_record"], ["reject", "ip_in_rbls"], ["reject", "low_domain_reputation"],
  ["reject", "low_ip_reputation"], ["reject", "spammy_content"], ["reject", "stamp_policy_error"], ["reject", "other"],
  ["temp_fail", "anomalous_traffic_pattern"], ["temp_fail", "other"],
];
const dt = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const num = (v: any) => v == null ? null : Number(v.doubleValue ?? v.floatValue ?? v.intValue ?? NaN);

async function gpost(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("postmaster", res.status, JSON.stringify(j)); throw new Error(res.status === 403 ? "Accès refusé : ajoutez le compte de service sur ce domaine dans Postmaster Tools" : j?.error?.message ?? "Erreur Google Postmaster"); }
  return j;
}

async function query(domain: string, days: number, metrics: { name: string; m: string; filter?: string }[]) {
  const out: { date: string; metric: string; value: any }[] = [];
  let pageToken = "";
  do {
    const j = await gpost(`/domains/${encodeURIComponent(domain)}/domainStats:query`, {
      timeQuery: { dateRanges: { dateRanges: [{ start: dt(new Date(Date.now() - days * 86400_000)), end: dt(new Date()) }] } },
      aggregationGranularity: "DAILY", pageSize: 1000, ...(pageToken ? { pageToken } : {}),
      metricDefinitions: metrics.map((x) => ({ name: x.name, baseMetric: { standardMetric: x.m }, ...(x.filter ? { filter: x.filter } : {}) })),
    });
    for (const s of j.domainStats ?? []) {
      const d = s.date ? `${s.date.year}-${String(s.date.month).padStart(2, "0")}-${String(s.date.day).padStart(2, "0")}` : "total";
      out.push({ date: d, metric: s.metric, value: s.value ?? {} });
    }
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

export async function trafficStats(domain: string, days: number): Promise<PmStat[]> {
  const metrics = [
    { name: "spam", m: "SPAM_RATE" },
    { name: "spf", m: "AUTH_SUCCESS_RATE", filter: 'auth_type = "spf"' },
    { name: "dkim", m: "AUTH_SUCCESS_RATE", filter: 'auth_type = "dkim"' },
    { name: "dmarc", m: "AUTH_SUCCESS_RATE", filter: 'auth_type = "dmarc"' },
    { name: "tlsin", m: "TLS_ENCRYPTION_RATE", filter: 'traffic_direction = "inbound"' },
    { name: "tlsout", m: "TLS_ENCRYPTION_RATE", filter: 'traffic_direction = "outbound"' },
    { name: "fbl", m: "FEEDBACK_LOOP_ID" },
    ...ERR.map(([t, r]) => ({ name: `err:${t}:${r}`, m: "DELIVERY_ERROR_RATE", filter: `error_type = "${t}" AND error_reason = "${r}"` })),
  ];
  const rows = await query(domain, days, metrics);
  const by = new Map<string, PmStat>();
  const get = (date: string) => {
    let s = by.get(date);
    if (!s) { s = { date, spamRate: null, spamLow: null, spamHigh: null, domainReputation: null, ipReputations: [], feedbackLoops: [], spf: null, dkim: null, dmarc: null, inboundTls: null, outboundTls: null, deliveryErrors: [] }; by.set(date, s); }
    return s;
  };
  const fblIds = new Set<string>();
  for (const r of rows) {
    const s = get(r.date); const v = num(r.value);
    if (r.metric === "spam") s.spamRate = v;
    else if (r.metric === "spf") s.spf = v;
    else if (r.metric === "dkim") s.dkim = v;
    else if (r.metric === "dmarc") s.dmarc = v;
    else if (r.metric === "tlsin") s.inboundTls = v;
    else if (r.metric === "tlsout") s.outboundTls = v;
    else if (r.metric === "fbl") for (const id of r.value.stringList?.values ?? (r.value.stringValue ? [r.value.stringValue] : [])) fblIds.add(id);
    else if (r.metric.startsWith("err:") && v) { const [, t, why] = r.metric.split(":"); s.deliveryErrors.push({ errorClass: t, errorType: why, errorRatio: v }); }
  }
  const ids = [...fblIds].slice(0, 20);
  if (ids.length) {
    const fr = await query(domain, days, ids.map((id, i) => ({ name: `fbl${i}`, m: "FEEDBACK_LOOP_SPAM_RATE", filter: `feedback_loop_id = "${id}"` })));
    for (const r of fr) { const v = num(r.value); if (v != null) get(r.date).feedbackLoops.push({ id: ids[Number(r.metric.slice(3))], spamRatio: v }); }
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type PmCompliance = {
  deliverability: { state: string | null; reason: string | null };
  oneClick: { state: string | null; reason: string | null };
  honorUnsub: { state: string | null; reason: string | null };
  rows: { requirement: string; status: string }[];
  subRows: { requirement: string; status: string }[];
};
export async function compliance(domain: string): Promise<PmCompliance> {
  const j = await gget(`/domains/${encodeURIComponent(domain)}/complianceStatus`);
  const c = j.complianceData ?? {};
  const rows = (x: any) => (x?.rowData ?? []).map((r: any) => ({ requirement: r.requirement, status: r.status?.status ?? "STATE_UNSPECIFIED" }));
  return {
    deliverability: { state: c.deliverabilityStatusVerdict?.state?.status ?? null, reason: c.deliverabilityStatusVerdict?.reason ?? null },
    oneClick: { state: c.oneClickUnsubscribeVerdict?.status?.status ?? null, reason: c.oneClickUnsubscribeVerdict?.reason ?? null },
    honorUnsub: { state: c.honorUnsubscribeVerdict?.status?.status ?? null, reason: c.honorUnsubscribeVerdict?.reason ?? null },
    rows: rows(c), subRows: rows(j.subdomainComplianceData),
  };
}
