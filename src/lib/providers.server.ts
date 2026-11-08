// Server-only adapters for each cloud / DNS provider. Each account has its own credentials.
export type ProviderId = "linode" | "vultr" | "hetzner" | "digitalocean" | "cloudflare" | "google_postmaster";
export type Account = { provider: string; auth_type: string; secret: string; email: string | null };
export type Plan = { id: string; label: string; vcpus: number; memoryMb: number; diskGb: number; monthly: number; hourly: number | null; regions?: string[] };
export type Region = { id: string; label: string };

const BASES: Record<string, string> = {
  linode: "https://api.linode.com/v4",
  vultr: "https://api.vultr.com/v2",
  hetzner: "https://api.hetzner.cloud/v1",
  digitalocean: "https://api.digitalocean.com/v2",
  cloudflare: "https://api.cloudflare.com/client/v4",
};

function headers(a: Account): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (a.provider === "cloudflare" && a.auth_type === "global") {
    h["X-Auth-Email"] = a.email ?? "";
    h["X-Auth-Key"] = a.secret;
  } else h["Authorization"] = `Bearer ${a.secret}`;
  return h;
}

async function call(a: Account, path: string, init: RequestInit = {}) {
  const res = await fetch(BASES[a.provider] + path, { ...init, headers: { ...headers(a), ...(init.headers as any) } });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok || (a.provider === "cloudflare" && body && body.success === false)) {
    const msg = body?.errors?.[0]?.message ?? body?.errors?.[0]?.reason ?? body?.error?.message ?? body?.error ?? body?.message ?? text;
    throw new Error(`${a.provider} [${res.status}] ${typeof msg === "string" ? msg : JSON.stringify(msg)}`.slice(0, 400));
  }
  return body;
}

export async function verifyAccount(a: Account): Promise<Record<string, unknown>> {
  switch (a.provider) {
    case "linode": { const p = await call(a, "/profile"); return { user: p.username, email: p.email }; }
    case "vultr": { const r = await call(a, "/account"); return { user: r.account?.name, email: r.account?.email, balance: r.account?.balance }; }
    case "hetzner": { const r = await call(a, "/servers?per_page=1"); return { servers: r.meta?.pagination?.total_entries ?? 0 }; }
    case "digitalocean": { const r = await call(a, "/account"); return { email: r.account?.email, droplet_limit: r.account?.droplet_limit }; }
    case "cloudflare": {
      if (a.auth_type === "global") { const r = await call(a, "/user"); return { email: r.result?.email }; }
      const r = await call(a, "/user/tokens/verify"); return { token_status: r.result?.status };
    }
    case "google_postmaster": return { note: "Connexion Google OAuth requise pour lire les données" };
    default: throw new Error("Fournisseur inconnu");
  }
}

export async function catalog(a: Account): Promise<{ plans: Plan[]; regions: Region[] }> {
  switch (a.provider) {
    case "linode": {
      const [t, r] = await Promise.all([call(a, "/linode/types?page_size=200"), call(a, "/regions?page_size=200")]);
      return {
        plans: t.data.map((x: any) => ({ id: x.id, label: x.label, vcpus: x.vcpus, memoryMb: x.memory, diskGb: Math.round(x.disk / 1024), monthly: x.price?.monthly ?? 0, hourly: x.price?.hourly ?? null })),
        regions: r.data.filter((x: any) => x.capabilities?.includes("Linodes")).map((x: any) => ({ id: x.id, label: `${x.label} (${x.id})` })),
      };
    }
    case "vultr": {
      const [p, r] = await Promise.all([call(a, "/plans?type=vc2&per_page=500"), call(a, "/regions?per_page=500")]);
      return {
        plans: p.plans.map((x: any) => ({ id: x.id, label: x.id, vcpus: x.vcpu_count, memoryMb: x.ram, diskGb: x.disk, monthly: x.monthly_cost, hourly: null, regions: x.locations })),
        regions: r.regions.map((x: any) => ({ id: x.id, label: `${x.city}, ${x.country}` })),
      };
    }
    case "hetzner": {
      const [p, r] = await Promise.all([call(a, "/server_types?per_page=50"), call(a, "/locations")]);
      return {
        plans: p.server_types.filter((x: any) => !x.deprecated).map((x: any) => ({
          id: x.name, label: x.description || x.name, vcpus: x.cores, memoryMb: x.memory * 1024, diskGb: x.disk,
          monthly: Number(x.prices?.[0]?.price_monthly?.gross ?? 0), hourly: Number(x.prices?.[0]?.price_hourly?.gross ?? 0),
          regions: x.prices?.map((pp: any) => pp.location),
        })),
        regions: r.locations.map((x: any) => ({ id: x.name, label: `${x.city} (${x.name})` })),
      };
    }
    case "digitalocean": {
      const [p, r] = await Promise.all([call(a, "/sizes?per_page=200"), call(a, "/regions?per_page=200")]);
      return {
        plans: p.sizes.filter((x: any) => x.available).map((x: any) => ({ id: x.slug, label: x.description || x.slug, vcpus: x.vcpus, memoryMb: x.memory, diskGb: x.disk, monthly: x.price_monthly, hourly: x.price_hourly, regions: x.regions })),
        regions: r.regions.filter((x: any) => x.available).map((x: any) => ({ id: x.slug, label: x.name })),
      };
    }
    default: throw new Error("Ce fournisseur ne vend pas de serveurs");
  }
}

export const KUMO_CLOUD_INIT_BASE = `#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y curl gnupg ca-certificates
curl -fsSL https://openrepo.kumomta.com/kumomta-ubuntu-22/public.gpg | gpg --yes --dearmor -o /usr/share/keyrings/kumomta.gpg
curl -fsSL https://openrepo.kumomta.com/files/kumomta-ubuntu22.list -o /etc/apt/sources.list.d/kumomta.list
apt-get update && apt-get install -y kumomta
systemctl enable --now kumomta
`;

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
function randomPass() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return "Km!" + Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 30) + "A9";
}

export function agentCloudInit(origin: string, token: string) {
  return `#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
for i in $(seq 1 30); do apt-get update -y && apt-get install -y curl && break; sleep 10; done
curl -fsSL ${origin}/api/public/agent/install.sh | KAG_TOKEN=${token} bash > /var/log/kumo-agent-install.log 2>&1
`;
}

export async function deploy(a: Account, o: { plan: string; region: string; label: string; userData?: string }): Promise<{ id: string; ipv4: string | null }> {
  const KUMO_CLOUD_INIT = o.userData ?? KUMO_CLOUD_INIT_BASE;
  switch (a.provider) {
    case "linode": {
      const r = await call(a, "/linode/instances", { method: "POST", body: JSON.stringify({ type: o.plan, region: o.region, label: o.label, image: "linode/ubuntu22.04", root_pass: randomPass(), metadata: { user_data: b64(KUMO_CLOUD_INIT) } }) });
      return { id: String(r.id), ipv4: r.ipv4?.[0] ?? null };
    }
    case "vultr": {
      const r = await call(a, "/instances", { method: "POST", body: JSON.stringify({ plan: o.plan, region: o.region, label: o.label, hostname: o.label, os_id: 1743, user_data: b64(KUMO_CLOUD_INIT) }) });
      return { id: r.instance.id, ipv4: r.instance.main_ip && r.instance.main_ip !== "0.0.0.0" ? r.instance.main_ip : null };
    }
    case "hetzner": {
      const r = await call(a, "/servers", { method: "POST", body: JSON.stringify({ name: o.label, server_type: o.plan, location: o.region, image: "ubuntu-22.04", user_data: KUMO_CLOUD_INIT }) });
      return { id: String(r.server.id), ipv4: r.server.public_net?.ipv4?.ip ?? null };
    }
    case "digitalocean": {
      const r = await call(a, "/droplets", { method: "POST", body: JSON.stringify({ name: o.label, region: o.region, size: o.plan, image: "ubuntu-22-04-x64", user_data: KUMO_CLOUD_INIT }) });
      return { id: String(r.droplet.id), ipv4: null };
    }
    default: throw new Error("Ce fournisseur ne vend pas de serveurs");
  }
}

export async function cfZones(a: Account) {
  const r = await call(a, "/zones?per_page=50");
  return (r.result as any[]).map((z) => ({ id: z.id, name: z.name, status: z.status }));
}

// Upsert records into a Cloudflare zone (update if same type+name exists, else create).
export async function cfUpsert(a: Account, zoneId: string, recs: { key: string; type: string; name: string; content: string; priority?: number }[]) {
  const out: { key: string; name: string; type: string; ok: boolean; error?: string }[] = [];
  for (const rec of recs) {
    try {
      const body = { type: rec.type, name: rec.name, content: rec.content, ttl: 3600, proxied: false, ...(rec.priority != null ? { priority: rec.priority } : {}) };
      const ex = await call(a, `/zones/${zoneId}/dns_records?type=${rec.type}&name=${encodeURIComponent(rec.name)}`);
      let match = (ex.result as any[])[0];
      if (rec.type === "TXT") match = (ex.result as any[]).find((r) => String(r.content).replace(/"/g, "").startsWith(rec.content.split(";")[0]?.split(" ")[0] ?? rec.content));
      if (match) await call(a, `/zones/${zoneId}/dns_records/${match.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await call(a, `/zones/${zoneId}/dns_records`, { method: "POST", body: JSON.stringify(body) });
      out.push({ key: rec.key, name: rec.name, type: rec.type, ok: true });
    } catch (e) { out.push({ key: rec.key, name: rec.name, type: rec.type, ok: false, error: (e as Error).message }); }
  }
  return out;
}

export async function cfMailDns(a: Account, zoneId: string, domain: string, ip: string) {
  const recs = [
    { type: "A", name: `mail.${domain}`, content: ip, ttl: 3600, proxied: false },
    { type: "MX", name: domain, content: `mail.${domain}`, priority: 10, ttl: 3600 },
    { type: "TXT", name: domain, content: `v=spf1 ip4:${ip} -all`, ttl: 3600 },
    { type: "TXT", name: `_dmarc.${domain}`, content: `v=DMARC1; p=reject; adkim=s; aspf=s; rua=mailto:dmarc@${domain}`, ttl: 3600 },
  ];
  const out: { name: string; type: string; ok: boolean; error?: string }[] = [];
  for (const rec of recs) {
    try { await call(a, `/zones/${zoneId}/dns_records`, { method: "POST", body: JSON.stringify(rec) }); out.push({ name: rec.name, type: rec.type, ok: true }); }
    catch (e) { out.push({ name: rec.name, type: rec.type, ok: false, error: (e as Error).message }); }
  }
  return out;
}

export type InventoryServer = { external_id: string; label: string; region: string | null; plan: string | null; status: string; ipv4: string | null; ips: { address: string; family: number; rdns: string | null }[] };
export async function inventory(a: Account): Promise<InventoryServer[]> {
  const out: InventoryServer[] = [];
  let cursor = '';
  for (let page = 1; page <= 100; page++) {
    let rows: any[] = [], next = false;
    if (a.provider === 'linode') {
      const r = await call(a, `/linode/instances?page=${page}&page_size=100`);
      rows = r.data; next = page < r.pages;
    } else if (a.provider === 'vultr') {
      const r = await call(a, `/instances?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      rows = r.instances;
      const raw = r.meta?.links?.next;
      cursor = raw ? new URL(raw, BASES['vultr']).searchParams.get('cursor') ?? '' : '';
      next = !!cursor;
    } else if (a.provider === 'hetzner') {
      const r = await call(a, `/servers?page=${page}&per_page=50`);
      rows = r.servers; next = !!r.meta?.pagination?.next_page;
    } else if (a.provider === 'digitalocean') {
      const r = await call(a, `/droplets?page=${page}&per_page=200`);
      rows = r.droplets; next = !!r.links?.pages?.next;
    } else throw new Error('Ce fournisseur ne possède pas de serveurs');
    for (const s of rows) {
      const ips: InventoryServer['ips'] = [];
      const add = (address: unknown, family: number, rdns: string | null = null) => {
        if (typeof address === 'string' && address && address !== '0.0.0.0') ips.push({ address, family, rdns });
      };
      let label = s.label ?? s.name ?? String(s.id), region = s.region, plan = s.plan ?? s.type;
      if (a.provider === 'linode') { for (const ip of s.ipv4 ?? []) { if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) add(ip,4); } add(s.ipv6,6); }
      if (a.provider === 'vultr') { add(s.main_ip,4); add(s.v6_main_ip,6); }
      if (a.provider === 'hetzner') { add(s.public_net?.ipv4?.ip,4,s.public_net?.ipv4?.dns_ptr); add(s.public_net?.ipv6?.ip,6); region = s.datacenter?.location?.name; plan = s.server_type?.name; }
      if (a.provider === 'digitalocean') { for (const n of s.networks?.v4 ?? []) if (n.type === 'public') add(n.ip_address,4); for (const n of s.networks?.v6 ?? []) if (n.type === 'public') add(n.ip_address,6); region = s.region?.slug; plan = s.size_slug; }
      out.push({ external_id:String(s.id), label, region:region ?? null, plan:plan ?? null, status:s.status ?? 'unknown', ipv4:ips.find(i=>i.family===4)?.address ?? null, ips });
    }
    if (!next) return out;
  }
  throw new Error('Inventaire trop volumineux : synchronisation interrompue sans suppression');
}
