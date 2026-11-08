import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PROVIDERS = [
  { id: "linode", name: "Linode (Akamai)", kind: "servers" },
  { id: "vultr", name: "Vultr", kind: "servers" },
  { id: "hetzner", name: "Hetzner Cloud", kind: "servers" },
  { id: "digitalocean", name: "DigitalOcean", kind: "servers" },
  { id: "cloudflare", name: "Cloudflare", kind: "dns" },
  { id: "google_postmaster", name: "Google Postmaster Tools", kind: "reputation" },
] as const;
const IDS = PROVIDERS.map((p) => p.id) as string[];

async function admin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superadmin" });
  if (!data) throw new Error("Accès réservé au Superadmin");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function loadAccount(db: any, id: string) {
  const { data, error } = await db.from("provider_accounts").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Compte introuvable");
  return data;
}
const idInput = (i: { id: string }) => ({ id: String(i.id) });

export const listAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data } = await db.from("provider_accounts").select("id, provider, label, auth_type, email, status, info, created_at, checked_at").order("created_at");
    return (data ?? []).map((a: any) => ({ ...a, info: (a.info ?? {}) as Record<string, string | number | null> }));
  });

export const addAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { provider: string; label: string; authType: string; secret: string; email?: string }) => {
    if (!IDS.includes(i.provider)) throw new Error("Fournisseur inconnu");
    const label = String(i.label).trim().slice(0, 80);
    const secret = String(i.secret).trim();
    if (!label || secret.length < 8) throw new Error("Nom et clé API obligatoires");
    const authType = i.provider === "cloudflare" && i.authType === "global" ? "global" : "token";
    const email = i.email ? String(i.email).trim() : null;
    if (authType === "global" && !email) throw new Error("Email du compte Cloudflare requis pour la clé globale");
    return { provider: i.provider, label, authType, secret, email };
  })
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { verifyAccount } = await import("./providers.server");
    const info = await verifyAccount({ provider: data.provider, auth_type: data.authType, secret: data.secret, email: data.email });
    const { error } = await db.from("provider_accounts").insert({
      provider: data.provider, label: data.label, auth_type: data.authType, secret: data.secret, email: data.email,
      status: data.provider === "google_postmaster" ? "pending" : "ok", info: info as any, created_by: context.userId, checked_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const recheckAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const acc = await loadAccount(db, data.id);
    const { verifyAccount } = await import("./providers.server");
    let status = "ok", info: any = {};
    try { info = await verifyAccount(acc); } catch (e) { status = "error"; info = { error: (e as Error).message }; }
    await db.from("provider_accounts").update({ status, info, checked_at: new Date().toISOString() }).eq("id", data.id);
    return { status };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    await db.from("provider_accounts").delete().eq("id", data.id);
    return { ok: true };
  });

export const getCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { catalog } = await import("./providers.server");
    return catalog(await loadAccount(db, data.id));
  });

export const deployServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accountId: string; plan: string; region: string; label: string; monthly: number }) => {
    const label = String(i.label).trim();
    if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(label)) throw new Error("Nom invalide (minuscules, chiffres, tirets)");
    return { accountId: String(i.accountId), plan: String(i.plan), region: String(i.region), label, monthly: Number(i.monthly) || 0 };
  })
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const acc = await loadAccount(db, data.accountId);
    const { deploy, agentCloudInit } = await import("./providers.server");
    const { newToken, sha256 } = await import("./kumo.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    const ins = await db.from("managed_servers").insert({
      account_id: acc.id, provider: acc.provider, external_id: `pending-${crypto.randomUUID()}`, label: data.label, region: data.region,
      plan: data.plan, monthly_price: data.monthly, status: "provisioning", created_by: context.userId,
    }).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    const token = newToken();
    const ag = await db.from("server_agents").upsert({ server_id: ins.data.id, token_hash: await sha256(token), status: "awaiting", last_error: null }, { onConflict: "server_id" });
    if (ag.error) { await db.from("managed_servers").delete().eq("id", ins.data.id); throw new Error(ag.error.message); }
    try {
      const r = await deploy(acc, { ...data, userData: agentCloudInit(origin, token) });
      await db.from("managed_servers").update({ external_id: r.id, ipv4: r.ipv4 }).eq("id", ins.data.id);
      return r;
    } catch (e) {
      await db.from("managed_servers").delete().eq("id", ins.data.id);
      throw e;
    }
  });

export const listManagedServers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data } = await db.from("managed_servers").select("*").order("created_at", { ascending: false });
    return data ?? [];
  });

export const listZones = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { cfZones } = await import("./providers.server");
    return cfZones(await loadAccount(db, data.id));
  });

export const deployMailDns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accountId: string; zoneId: string; domain: string; ip: string }) => {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(i.ip))) throw new Error("Adresse IP invalide");
    return { accountId: String(i.accountId), zoneId: String(i.zoneId), domain: String(i.domain), ip: String(i.ip) };
  })
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { cfMailDns } = await import("./providers.server");
    return cfMailDns(await loadAccount(db, data.accountId), data.zoneId, data.domain, data.ip);
  });
