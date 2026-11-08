import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superadmin" });
  if (!data) throw new Error("Accès réservé au Superadmin");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
const PUBLIC = "id, domain, account_id, zone_id, ip, selector_a, selector_b, dkim_pub_a, dkim_pub_b, checks, checked_at, synced_at, created_at";
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Self-heal before publishing: pick the Cloudflare zone that really owns the domain (by name, across all accounts) and fill the sending IP from a connected server. */
async function healDomain(db: any, d: any): Promise<{ d: any; acc: any | null; note: string }> {
  const { cfZones } = await import("./providers.server");
  const { data: accs } = await db.from("provider_accounts").select("*").eq("provider", "cloudflare");
  const ordered = [...(accs ?? [])].sort((a: any) => (a.id === d.account_id ? -1 : 1));
  let acc: any = null, zoneId: string | null = null, note = "";
  for (const a of ordered) {
    try {
      const zones = await cfZones(a);
      const z = zones.filter((x) => d.domain === x.name || d.domain.endsWith("." + x.name)).sort((x, y) => y.name.length - x.name.length)[0];
      if (z) { acc = a; zoneId = z.id; break; }
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

export const listDomains = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data } = await db.from("sending_domains").select(PUBLIC).order("created_at");
    const { expectedRecords } = await import("./domains.server");
    type Row = { id: string; domain: string; account_id: string | null; zone_id: string | null; ip: string | null; selector_a: string; selector_b: string; dkim_pub_a: string; dkim_pub_b: string; checked_at: string | null; synced_at: string | null; created_at: string };
    return ((data ?? []) as any[]).map((d): Row & { checks: Record<string, { ok: boolean; found: string | null }>; records: ReturnType<typeof expectedRecords> } => ({ ...d, checks: (d.checks ?? {}) as Record<string, { ok: boolean; found: string | null }>, records: expectedRecords(d) }));
  });

export const addDomain = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { domain: string; ip?: string | undefined; accountId?: string | undefined; zoneId?: string | undefined }) => {
    const domain = String(i.domain).trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) throw new Error("Nom de domaine invalide");
    const ip = i.ip ? String(i.ip).trim() : null;
    if (ip && !IP_RE.test(ip)) throw new Error("Adresse IP invalide");
    return { domain, ip, accountId: i.accountId || null, zoneId: i.zoneId || null };
  })
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { genDkim } = await import("./domains.server");
    const [a, b] = await Promise.all([genDkim(), genDkim()]);
    const ym = new Date().toISOString().slice(0, 7).replace("-", "");
    const { error } = await db.from("sending_domains").insert({
      domain: data.domain, ip: data.ip, account_id: data.accountId, zone_id: data.zoneId,
      selector_a: `ed${ym}a`, selector_b: `ed${ym}b`, dkim_pub_a: a.pub, dkim_pub_b: b.pub, dkim_priv_a: a.priv, dkim_priv_b: b.priv,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message.includes("duplicate") ? "Ce domaine existe déjà" : error.message);
    return { ok: true };
  });

export const updateDomain = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; ip?: string | null; accountId?: string | null; zoneId?: string | null }) => {
    if (i.ip && !IP_RE.test(i.ip)) throw new Error("Adresse IP invalide");
    return { id: String(i.id), ip: i.ip || null, accountId: i.accountId || null, zoneId: i.zoneId || null };
  })
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    await db.from("sending_domains").update({ ip: data.ip, account_id: data.accountId, zone_id: data.zoneId }).eq("id", data.id);
    return { ok: true };
  });

export const checkDomainDns = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => ({ id: String(i.id) }))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { data: d } = await db.from("sending_domains").select(PUBLIC).eq("id", data.id).single();
    if (!d) throw new Error("Domaine introuvable");
    const { checkDomain } = await import("./domains.server");
    const checks = await checkDomain(d);
    await db.from("sending_domains").update({ checks, checked_at: new Date().toISOString() }).eq("id", data.id);
    return checks;
  });

export const syncDomainDns = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => ({ id: String(i.id) }))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { data: d } = await db.from("sending_domains").select(PUBLIC).eq("id", data.id).single();
    if (!d) throw new Error("Domaine introuvable");
    const healed = await healDomain(db, d);
    if (!healed.acc) throw new Error(healed.note);
    const { expectedRecords } = await import("./domains.server");
    const { cfUpsert } = await import("./providers.server");
    const res = await cfUpsert(healed.acc, healed.d.zone_id, expectedRecords(healed.d));
    const bad = res.filter((r) => !r.ok);
    if (bad.length === res.length) throw new Error(bad[0]?.error ?? "Cloudflare a refusé la publication");
    await db.from("sending_domains").update({ synced_at: new Date().toISOString() }).eq("id", data.id);
    // Auto-push DKIM keys: bind domain to every connected KumoMTA server; agents pull keys on next heartbeat.
    let serversBound = 0;
    const agents = await db.from("server_agents").select("server_id,status").neq("status", "awaiting");
    for (const a of agents.data ?? []) {
      const ex = await db.from("server_domain_bindings").select("id").eq("server_id", a.server_id).eq("domain_id", data.id).maybeSingle();
      if (!ex.data) { const ins = await db.from("server_domain_bindings").insert({ server_id: a.server_id, domain_id: data.id }); if (!ins.error) serversBound++; }
      else serversBound++;
    }
    void serversBound;
    return res;
  });

export const deleteDomain = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => ({ id: String(i.id) }))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    await db.from("sending_domains").delete().eq("id", data.id);
    return { ok: true };
  });


const LABEL: Record<string, string> = { spf: "SPF", dkim_a: "DKIM (clé A)", dkim_b: "DKIM (clé B)", dmarc: "DMARC", mta_sts: "MTA-STS", tls_rpt: "TLS-RPT", a: "Serveur mail (A)", mx: "MX" };

/** Auto-fix from a Mail-Tester result: detect already-published records (awaiting provider propagation), publish only the missing ones. */
export const autoFixDomain = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { domain: string }) => ({ domain: String(i.domain ?? "").trim().toLowerCase() }))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { data: list } = await db.from("sending_domains").select(PUBLIC);
    const doms = (list ?? []) as any[];
    const d0 = doms.find((x) => x.domain === data.domain) ?? doms.filter((x) => data.domain.endsWith("." + x.domain)).sort((a, b) => b.domain.length - a.domain.length)[0];
    if (!d0) return { ok: false as const, domain: data.domain, message: `Le domaine « ${data.domain || "inconnu"} » n'est pas encore dans vos Domaines. Ajoutez-le d'abord.`, items: [] as { key: string; label: string; state: "done" | "pending" | "fixed" | "manual" }[] };
    const healed = await healDomain(db, d0);
    const d = healed.d;
    const { checkDomain, expectedRecords } = await import("./domains.server");
    const before = await checkDomain(d);
    const recs = expectedRecords(d);
    // SPF must also authorize the sending IP, not just exist.
    const spf = before["spf"];
    if (d.ip && spf?.ok && !String(spf.found ?? "").includes(d.ip)) before["spf"] = { ...spf, ok: false };
    const missing = recs.filter((r) => !before[r.key]?.ok);
    let published = false;
    let note = healed.note;
    if (missing.length && healed.acc) {
      const { cfUpsert } = await import("./providers.server");
      const res = await cfUpsert(healed.acc, d.zone_id, missing);
      const bad = res.filter((r) => !r.ok);
      published = bad.length < res.length;
      if (bad.length) note = `Cloudflare a refusé : ${bad.map((b) => `${LABEL[b.key] ?? b.key} (${b.error})`).join(", ")}`;
      if (published) await db.from("sending_domains").update({ synced_at: new Date().toISOString() }).eq("id", d.id);
    } else if (missing.length) note = note || "Domaine non relié à Cloudflare : correction manuelle nécessaire.";
    // Ensure DKIM keys reach every connected server.
    const agents = await db.from("server_agents").select("server_id").neq("status", "awaiting");
    for (const a of agents.data ?? []) {
      const ex = await db.from("server_domain_bindings").select("id").eq("server_id", a.server_id).eq("domain_id", d.id).maybeSingle();
      if (!ex.data) await db.from("server_domain_bindings").insert({ server_id: a.server_id, domain_id: d.id });
    }
    const after = published ? await checkDomain(d) : before;
    await db.from("sending_domains").update({ checks: after, checked_at: new Date().toISOString() }).eq("id", d.id);
    const items = recs.map((r) => ({
      key: r.key, label: LABEL[r.key] ?? r.key,
      state: (before[r.key]?.ok ? "done" : published ? (after[r.key]?.ok ? "fixed" : "pending") : "manual") as "done" | "pending" | "fixed" | "manual",
    }));
    return { ok: true as const, domain: d.domain, message: note, items };
  });

export const recheckDomainDns = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { domain: string }) => ({ domain: String(i.domain ?? "").trim().toLowerCase() }))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { data: d } = await db.from("sending_domains").select(PUBLIC).eq("domain", data.domain).maybeSingle();
    if (!d) return { checks: {} as Record<string, boolean> };
    const { checkDomain } = await import("./domains.server");
    const res = await checkDomain(d as any);
    await db.from("sending_domains").update({ checks: res, checked_at: new Date().toISOString() }).eq("id", (d as any).id);
    return { checks: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.ok])) as Record<string, boolean> };
  });

/** Branded tracking: publish t.<domain> → sending server; Caddy on that server proxies open/click URLs to the site with on-demand TLS. */
export const setupTracking = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; disable?: boolean }) => ({ id: String(i.id), disable: Boolean(i.disable) }))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { data: d } = await db.from("sending_domains").select(PUBLIC).eq("id", data.id).single();
    if (!d) throw new Error("Domaine introuvable");
    if (data.disable) { await db.from("sending_domains").update({ tracking_host: null }).eq("id", d.id); return { host: null, live: false }; }
    const healed = await healDomain(db, d);
    if (!healed.acc) throw new Error(healed.note);
    if (!healed.d.ip) throw new Error("Aucun serveur d'envoi connecté pour héberger le suivi.");
    const host = `t.${d.domain}`;
    const { cfUpsert } = await import("./providers.server");
    const [r] = await cfUpsert(healed.acc, healed.d.zone_id, [{ key: "tracking", type: "A", name: host, content: healed.d.ip }]);
    if (!r?.ok) throw new Error(r?.error ?? "Cloudflare a refusé l'enregistrement");
    await db.from("sending_domains").update({ tracking_host: host }).eq("id", d.id);
    return { host, live: await trackingLive(host) };
  });

async function trackingLive(host: string) {
  try { const r = await fetch(`https://${host}/api/public/t/health`, { signal: AbortSignal.timeout(6000) }); return r.ok; } catch { return false; }
}

export const trackingStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data } = await db.from("sending_domains").select("id,domain,tracking_host").order("created_at");
    return Promise.all(((data ?? []) as { id: string; domain: string; tracking_host: string | null }[]).map(async x => ({ ...x, live: x.tracking_host ? await trackingLive(x.tracking_host) : false })));
  });
