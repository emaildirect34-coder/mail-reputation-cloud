import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { dmarcDomain } from './dmarc-policy';
import { recipientDomain } from './email-address';

async function admin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superadmin" });
  if (!data) throw new Error("Accès réservé au Superadmin");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
const PUBLIC = "id, domain, account_id, zone_id, ip, selector_a, selector_b, dkim_pub_a, dkim_pub_b, checks, checked_at, synced_at, created_at";
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

const quotaDomain = z.string().trim().toLowerCase().max(253).regex(DOMAIN_RE);

export const readSenderDomainQuota = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ domain: quotaDomain }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context) as SupabaseClient<Database>;
    const result = await db.rpc('read_sender_domain_quota', { _domain: data.domain }).maybeSingle();
    if (result.error?.code === 'PGRST202') return null;
    if (result.error || !result.data) throw new Error('Le compteur d’envoi du domaine est indisponible.');
    return result.data;
  });

export const setSenderDomainQuota = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ domain: quotaDomain, limit: z.number().int().min(1).max(100_000_000).nullable() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context) as SupabaseClient<Database>;
    const domain = await db.from('sending_domains').select('id').eq('domain', data.domain).maybeSingle();
    if (domain.error || !domain.data) throw new Error('Domaine d’envoi introuvable.');
    const result = await db.rpc('set_sender_domain_quota', { _domain: data.domain, _daily_limit: data.limit });
    if (result.error || !result.data) throw new Error('Impossible d’enregistrer le plafond de ce domaine.');
    const { recordAuditEvent } = await import('./audit-log.server');
    await recordAuditEvent(db, { actorId: context.userId, action: 'domain.quota_changed', entityType: 'sending_domain', entityId: data.domain, summary: { limit: data.limit } });
  });

export const listDomains = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data, error } = await db.from("sending_domains").select(PUBLIC).order("created_at");
    if (error) throw new Error("Impossible de charger les domaines d’envoi.");
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
    const { recordAuditEvent } = await import('./audit-log.server');
    const created = await db.from('sending_domains').select('id').eq('domain', data.domain).maybeSingle();
    if (created.data) await recordAuditEvent(db, { actorId: context.userId, action: 'domain.created', entityType: 'sending_domain', entityId: created.data.id });
    return { ok: true };
  });

export const updateDomain = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; ip?: string | null; accountId?: string | null; zoneId?: string | null }) => {
    if (i.ip && !IP_RE.test(i.ip)) throw new Error("Adresse IP invalide");
    return { id: String(i.id), ip: i.ip || null, accountId: i.accountId || null, zoneId: i.zoneId || null };
  })
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const changed = await db.from("sending_domains").update({ ip: data.ip, account_id: data.accountId, zone_id: data.zoneId }).eq("id", data.id).select('id').maybeSingle();
    if (changed.error) throw new Error('Impossible de modifier le domaine.');
    const { recordAuditEvent } = await import('./audit-log.server');
    await recordAuditEvent(db, { actorId: context.userId, action: 'domain.updated', entityType: 'sending_domain', entityId: data.id });
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

export const checkDomainTls = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
 .inputValidator(i => z.object({id:z.string().uuid()}).parse(i))
 .handler(async ({data,context}) => {
  const db = await admin(context);
  const {data:d,error} = await db.from('sending_domains').select(PUBLIC).eq('id',data.id).single();
  if(error||!d) throw new Error('Domaine introuvable.');
  const {healDomain} = await import('./domains.server');const healed=await healDomain(db,d);
  if(!healed.acc||!healed.d.zone_id) throw new Error(healed.note||'Zone Cloudflare introuvable.');
  const {cfCertificatePacks}=await import('./providers.server');const packs=await cfCertificatePacks(healed.acc,healed.d.zone_id);
  const matches=packs.filter(p=>p.host.split(', ').some((host:string)=>host===healed.d.domain||host==='*.'+healed.d.domain));
  const nearest=matches.filter(p=>p.expires_on).sort((a,b)=>Date.parse(a.expires_on)-Date.parse(b.expires_on))[0]??null;
  const alreadyAlerted=nearest&&Date.parse(nearest.expires_on??'')-Date.now()<30*86400000
    ? await db.from('tls_certificate_checks').select('id').eq('domain_id',data.id).eq('expires_on',nearest.expires_on).gte('last_alerted_at',new Date(Date.now()-7*86400000).toISOString()).limit(1)
    : {data:[]};
  if(matches.length){const saved=await db.from('tls_certificate_checks').upsert(matches.map(p=>({domain_id:data.id,certificate_host:p.host,certificate_status:p.status,expires_on:p.expires_on,checked_at:new Date().toISOString()})),{onConflict:'domain_id,certificate_host'});if(saved.error)throw new Error('Le résultat TLS a été trouvé mais son historique ne peut pas être enregistré (migration 0085).');}
  if(nearest&&Date.parse(nearest.expires_on??'')-Date.now()<30*86400000&&!alreadyAlerted.data?.length){const {fireWebhooks}=await import('./webhooks.server');const delivered=await fireWebhooks('tls_expiration',{domain:healed.d.domain,certificate_host:nearest.host,expires_on:nearest.expires_on,status:nearest.status,days_remaining:Math.ceil((Date.parse(nearest.expires_on??'')-Date.now())/86400000)});if(delivered)await db.from('tls_certificate_checks').update({last_alerted_at:new Date().toISOString()}).eq('domain_id',data.id).eq('certificate_host',nearest.host);}
  const {recordAuditEvent}=await import('./audit-log.server');await recordAuditEvent(db,{actorId:context.userId,action:'domain.tls_checked',entityType:'sending_domain',entityId:data.id,summary:{certificates:matches.length,expiresOn:nearest?.expires_on??null}});
  return {certificates:matches,nearest,checkedAt:new Date().toISOString()};
 });

export const syncDomainDns = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => ({ id: String(i.id) }))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { data: d } = await db.from("sending_domains").select(PUBLIC).eq("id", data.id).single();
    if (!d) throw new Error("Domaine introuvable");
    const { healDomain } = await import("./domains.server");
    const healed = await healDomain(db, d);
    if (!healed.acc) throw new Error(healed.note);
    const { expectedRecords } = await import("./domains.server");
    const { cfUpsert, cfCaptureDnsRecords } = await import("./providers.server");
    const desiredRecords=expectedRecords(healed.d);
    const managedRecords=desiredRecords.map(({type,name,content})=>({type,name,marker:type==='A'?'*':type==='MX'?content:(content.match(/^v=[^; ]+/i)?.[0]??content)}));
    const snapshot=await cfCaptureDnsRecords(healed.acc,healed.d.zone_id,managedRecords);
    const revision=await db.from('dns_config_revisions').insert({domain_id:data.id,account_id:healed.acc.id,zone_id:healed.d.zone_id,records:snapshot.records,managed_records:snapshot.managed,reason:'before_publish',created_by:context.userId});
    if(revision.error)throw new Error('Impossible de conserver l’historique DNS. Appliquez la migration 0085 avant de publier.');
    const res = await cfUpsert(healed.acc, healed.d.zone_id, desiredRecords);
    const bad = res.filter((r) => !r.ok);
    if (bad.length === res.length) throw new Error(bad[0]?.error ?? "Cloudflare a refusé la publication");
    const { recordAuditEvent } = await import('./audit-log.server');
    await recordAuditEvent(db, { actorId: context.userId, action: 'domain.dns_records_published', entityType: 'sending_domain', entityId: data.id, summary: { records: res.filter(row => row.ok).length } });
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

export const listDnsRevisions=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(i=>z.object({domainId:z.string().uuid()}).parse(i))
 .handler(async ({context,data})=>{const db=await admin(context);const {data:rows,error}=await db.from('dns_config_revisions').select('id,domain_id,reason,created_at,created_by,managed_records,records').eq('domain_id',data.domainId).order('created_at',{ascending:false}).limit(30);if(error)throw new Error('Historique DNS indisponible. Appliquez la migration 0085.');return rows??[];});

export const restoreDnsRevision=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(i=>z.object({revisionId:z.string().uuid(),confirmed:z.literal(true)}).parse(i))
 .handler(async ({context,data})=>{
  const db=await admin(context);const revision=await db.from('dns_config_revisions').select('*').eq('id',data.revisionId).single();if(revision.error||!revision.data)throw new Error('Révision DNS introuvable.');
  const domain=await db.from('sending_domains').select(PUBLIC).eq('id',revision.data.domain_id).single();if(domain.error||!domain.data)throw new Error('Domaine introuvable.');
  const {healDomain}=await import('./domains.server');const healed=await healDomain(db,domain.data);if(!healed.acc||!healed.d.zone_id)throw new Error(healed.note||'Zone Cloudflare introuvable.');
  if(healed.d.zone_id!==revision.data.zone_id)throw new Error('La zone Cloudflare de ce domaine a changé depuis cette révision. Cette sauvegarde ne peut pas être appliquée à une autre zone.');
  const {cfCaptureDnsRecords,cfRestoreDnsRecords}=await import('./providers.server');
  const managed=revision.data.managed_records as {type:string;name:string;marker:string}[];const before=await cfCaptureDnsRecords(healed.acc,healed.d.zone_id,managed);
  const history=await db.from('dns_config_revisions').insert({domain_id:domain.data.id,account_id:healed.acc.id,zone_id:healed.d.zone_id,records:before.records,managed_records:before.managed,reason:'before_restore',created_by:context.userId});if(history.error)throw new Error('Impossible de créer le point de retour courant.');
  const restored=await cfRestoreDnsRecords(healed.acc,healed.d.zone_id,managed,revision.data.records as any[]);const failed=restored.filter(row=>!row.ok);
  if(failed.length)throw new Error(`Restauration partielle (${failed.length}/${restored.length}). Vérifiez les autorisations Cloudflare avant un nouvel essai.`);
  const {recordAuditEvent}=await import('./audit-log.server');await recordAuditEvent(db,{actorId:context.userId,action:'domain.dns_revision_restored',entityType:'sending_domain',entityId:domain.data.id,summary:{revisionId:data.revisionId,recordCount:restored.length}});
  return {ok:true,restored:restored.length};
 });

export const publishInitialDane = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ domain: z.string().max(253), mx: z.string().max(253),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/), verifiedLiveSmtp: z.literal(true) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const { publishDane } = await import('./domains.server');
    return publishDane(db, data);
  });

export const publishExternalDmarcAuthorization = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({ domain: z.string().max(253), aggregate: z.string().max(254) }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const source = dmarcDomain(data.domain);
    const mailbox = data.aggregate.trim().toLowerCase();
    const destination = recipientDomain(mailbox);
    if (!source || !destination || source === destination || mailbox !== process.env['DMARC_REPORT_DESTINATION']?.trim().toLowerCase()) {
      throw new Error('Cette adresse n’est pas la boîte de rapports autorisée par l’application.');
    }
    const { data: domains, error } = await db.from('sending_domains').select('id,domain,account_id,zone_id,ip').in('domain', [source, destination]);
    const receiving = domains?.find((entry: { domain: string }) => entry.domain === destination);
    if (error || !receiving || !domains?.some((entry: { domain: string }) => entry.domain === source)) {
      throw new Error('Ajoutez les domaines expéditeur et destinataire dans Domaines.');
    }
    const { readDmarcAuthorization } = await import('./dmarc-policy.server');
    const dns = await readDmarcAuthorization(source, destination);
    if (dns.status === 'authorized') return 'present' as const;
    if (dns.status !== 'missing') throw new Error('Le contrôle DNS a échoué. Réessayez avant de publier.');
    const { healDomain } = await import('./domains.server');
    const { d, acc, note } = await healDomain(db, receiving);
    if (!acc || !d.zone_id) throw new Error(note || 'Zone destinataire Cloudflare introuvable.');
    const { cfPublishDmarcAuthorization } = await import('./providers.server');
    return cfPublishDmarcAuthorization(acc, d.zone_id, dns.name);
  });

export const deleteDomain = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => ({ id: String(i.id) }))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const removed = await db.from("sending_domains").select('domain').eq("id", data.id).maybeSingle();
    const deleted = await db.from("sending_domains").delete().eq("id", data.id);
    if (deleted.error) throw new Error('Impossible de supprimer ce domaine.');
    const { recordAuditEvent } = await import('./audit-log.server');
    await recordAuditEvent(db, { actorId: context.userId, action: 'domain.deleted', entityType: 'sending_domain', entityId: data.id, summary: { domain: removed.data?.domain ?? 'unknown' } });
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
    const { healDomain } = await import("./domains.server");
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
    const { healDomain } = await import("./domains.server");
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
