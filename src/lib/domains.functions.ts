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
    if (!d.account_id || !d.zone_id) throw new Error("Choisissez d'abord un compte et une zone Cloudflare");
    const { data: acc } = await db.from("provider_accounts").select("*").eq("id", d.account_id).single();
    if (!acc) throw new Error("Compte Cloudflare introuvable");
    const { expectedRecords } = await import("./domains.server");
    const { cfUpsert } = await import("./providers.server");
    const res = await cfUpsert(acc, d.zone_id, expectedRecords(d));
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

