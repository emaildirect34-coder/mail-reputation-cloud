import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, RefreshCw, CloudUpload, Link2, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";
import { listDomains, addDomain, updateDomain, checkDomainDns, syncDomainDns, deleteDomain } from "@/lib/domains.functions";
import { listAccounts, listZones, listManagedServers } from "@/lib/providers.functions";
import { bindDomainServer, listDomainBindings } from '@/lib/infrastructure.functions';
import { AiDiagnostic } from '@/components/dash/ai-diagnostic';

export const Route = createFileRoute("/dashboard/domains")({
  head: () => ({ meta: [
    { title: "Domaines d'envoi — Email Direct" },
    { name: "description", content: "Double DKIM, SPF, DMARC strict, MTA-STS et synchronisation Cloudflare de vos domaines d'envoi." },
    { property: "og:title", content: "Domaines d'envoi — Email Direct" },
    { property: "og:description", content: "Authentification email et DNS automatisés." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Domains,
});

const LABELS: Record<string, string> = { a: "A mail", mx: "MX", spf: "SPF", dkim_a: "DKIM 1", dkim_b: "DKIM 2", dmarc: "DMARC", mta_sts: "MTA-STS", tls_rpt: "TLS-RPT" };
const SUB_PREFIXES = ["news", "mail", "info", "promo", "offres", "contact", "letter", "send", "mx", "go", "deals", "club", "pro", "hello", "alert", "notify", "update", "service", "client", "bonus"];
export function planDomains(zone: string, mode: "root" | "auto" | "both", count: number, custom: string): string[] {
  if (!zone) return [];
  const out: string[] = mode === "auto" ? [] : [zone];
  if (mode === "root") return out;
  const own = custom.split(/[\s,;]+/).map((s) => s.toLowerCase().replace(/[^a-z0-9-]/g, "")).filter(Boolean);
  const pool = [...new Set([...own, ...SUB_PREFIXES])];
  for (let i = 0; out.length < (mode === "both" ? count + 1 : count); i++) out.push(`${pool[i] ?? `m${i - pool.length + 1}`}.${zone}`);
  return out;
}
const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function Domains() {
  const qc = useQueryClient();
  const fList = useServerFn(listDomains), fAdd = useServerFn(addDomain), fUpd = useServerFn(updateDomain);
  const fCheck = useServerFn(checkDomainDns), fSync = useServerFn(syncDomainDns), fDel = useServerFn(deleteDomain);
  const fAcc = useServerFn(listAccounts), fZones = useServerFn(listZones);
  const fServers = useServerFn(listManagedServers), fBind = useServerFn(bindDomainServer), fBindings = useServerFn(listDomainBindings);
  const servers = useQuery({queryKey:['domain-servers'],queryFn:()=>fServers()});
  const bindings = useQuery({queryKey:['domain-bindings'],queryFn:()=>fBindings()});
  const [serverId,setServerId] = useState('');

  const q = useQuery({ queryKey: ["domains"], queryFn: () => fList() });
  const acc = useQuery({ queryKey: ["provider-accounts"], queryFn: () => fAcc() });
  const cfAccounts = (acc.data ?? []).filter((a) => a.provider === "cloudflare");
  const domains = q.data ?? [];

  const [selId, setSelId] = useState<string | null>(null);
  const cur = domains.find((d) => d.id === selId) ?? domains[0];
  const [form, setForm] = useState({ domain: "", ip: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [cfAcc, setCfAcc] = useState(""); const [zone, setZone] = useState(""); const [ip, setIp] = useState("");
  useEffect(() => { setCfAcc(cur?.account_id ?? ""); setZone(cur?.zone_id ?? ""); setIp(cur?.ip ?? ""); }, [cur?.id]);
  const zones = useQuery({ queryKey: ["zones", cfAcc], queryFn: () => fZones({ data: { id: cfAcc } }), enabled: !!cfAcc });

  const [manual, setManual] = useState(false);
  const [addAcc, setAddAcc] = useState(""); const [addZone, setAddZone] = useState("");
  const [mode, setMode] = useState<"root" | "auto" | "both">("auto");
  const [count, setCount] = useState(3); const [custom, setCustom] = useState("");
  useEffect(() => { if (!addAcc && cfAccounts[0]) setAddAcc(cfAccounts[0].id); }, [cfAccounts.length]);
  const addZones = useQuery({ queryKey: ["zones", addAcc], queryFn: () => fZones({ data: { id: addAcc } }), enabled: !!addAcc });
  const zoneName = (addZones.data ?? []).find((z) => z.id === addZone)?.name ?? "";
  const planned = planDomains(zoneName, mode, count, custom);

  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(k);
    try { await fn(); toast.success(ok); await qc.invalidateQueries({ queryKey: ["domains"] }); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const score = (d: (typeof domains)[number]) => { const v = Object.values(d.checks); return v.length ? v.filter((c) => c.ok).length : 0; };
  const cnt = (k: string) => domains.filter((d) => d.checks[k]?.ok).length;
  const ready = domains.filter((d) => d.records.every((r) => d.checks[r.key]?.ok)).length;

  return (
    <>
      <PageHeader title="Domaines d'envoi" desc="Double DKIM, SPF, DMARC strict, MTA-STS — générés, publiés sur Cloudflare et contrôlés en direct." />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Domaines" value={String(domains.length)} />
        <Stat label="SPF" value={`${cnt("spf")} / ${domains.length}`} />
        <Stat label="Double DKIM" value={`${domains.filter((d) => d.checks["dkim_a"]?.ok && d.checks["dkim_b"]?.ok).length} / ${domains.length}`} />
        <Stat label="DMARC" value={`${cnt("dmarc")} / ${domains.length}`} />
        <Stat label="MTA-STS" value={`${cnt("mta_sts")} / ${domains.length}`} />
        <Stat label="Prêts à envoyer" value={`${ready} / ${domains.length}`} />
      </div>

      <Panel title="Ajouter un domaine">
        {manual || cfAccounts.length === 0 ? (
          <form className="grid gap-2 sm:grid-cols-[1fr_200px_auto]" onSubmit={(e) => { e.preventDefault(); run("add", async () => { await fAdd({ data: { domain: form.domain, ip: form.ip || undefined } }); setForm({ domain: "", ip: "" }); }, "Domaine ajouté, 2 clés DKIM générées"); }}>
            <Input placeholder="ex. news.monsite.fr" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} required />
            <Input placeholder="IP d'envoi (optionnel)" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} />
            <Button disabled={busy === "add"}><Plus className="h-4 w-4" /> Ajouter</Button>
          </form>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs font-semibold text-muted-foreground">Compte Cloudflare
                <select className={sel} value={addAcc} onChange={(e) => { setAddAcc(e.target.value); setAddZone(""); }}>
                  <option value="">— choisir —</option>{cfAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select></label>
              <label className="text-xs font-semibold text-muted-foreground">Domaine Cloudflare
                <select aria-label="Domaine Cloudflare" className={sel} value={addZone} onChange={(e) => setAddZone(e.target.value)} disabled={!addAcc}>
                  <option value="">{addZones.isFetching ? "Chargement…" : "— choisir un domaine —"}</option>{(addZones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select></label>
              <label className="text-xs font-semibold text-muted-foreground">IP d'envoi (optionnel)
                <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="203.0.113.10" /></label>
            </div>
            {addZones.error && <p role="alert" className="text-sm text-destructive">{addZones.error.message}</p>}
            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs font-semibold text-muted-foreground">Mode d'envoi
                <select className={sel} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  <option value="root">Domaine principal seulement</option>
                  <option value="auto">Sous-domaines automatiques</option>
                  <option value="both">Domaine principal + sous-domaines</option>
                </select></label>
              {mode !== "root" && <label className="text-xs font-semibold text-muted-foreground">Nombre de sous-domaines
                <Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></label>}
              {mode !== "root" && <label className="text-xs font-semibold text-muted-foreground">Préfixes personnalisés (optionnel)
                <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="news, promo, offres" /></label>}
            </div>
            {zoneName && <div className="flex flex-wrap gap-1">{planned.map((d) => <Pill key={d}>{d}</Pill>)}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!zoneName || busy === "add"} onClick={() => run("add", async () => {
                const exist = new Set(domains.map((d) => d.domain)); let n = 0;
                for (const d of planned) { if (exist.has(d)) continue; await fAdd({ data: { domain: d, ip: form.ip || undefined, accountId: addAcc, zoneId: addZone } }); n++; }
                if (!n) throw new Error("Tous ces domaines existent déjà");
              }, `${planned.length} domaine(s) ajouté(s) avec double DKIM`)}><Plus className="h-4 w-4" /> Ajouter {planned.length > 1 ? `${planned.length} domaines` : "ce domaine"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setManual(true)}>Saisie manuelle</Button>
            </div>
          </div>
        )}
        {manual && cfAccounts.length > 0 && <Button variant="ghost" size="sm" className="mt-2" onClick={() => setManual(false)}>Choisir depuis Cloudflare</Button>}
      </Panel>

      {cur && (
        <Panel title={`Détails — ${cur.domain}`} action={<AiDiagnostic compact input={{skill:'dns',domainId:cur.id}}/>}>
          <div className="grid gap-2 md:grid-cols-4">
            <label className="text-xs font-semibold text-muted-foreground">Compte Cloudflare
              <select className={sel} value={cfAcc} onChange={(e) => { setCfAcc(e.target.value); setZone(""); }}>
                <option value="">— choisir —</option>{cfAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select></label>
            <label className="text-xs font-semibold text-muted-foreground">Zone
              <select className={sel} value={zone} onChange={(e) => setZone(e.target.value)} disabled={!cfAcc}>
                <option value="">{zones.isFetching ? "Chargement…" : "— choisir —"}</option>{(zones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select></label>
            <label className="text-xs font-semibold text-muted-foreground">IP d'envoi
              <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.10" /></label>
            <div className="flex items-end"><Button className="w-full" variant="outline" disabled={busy === "upd"} onClick={() => run("upd", () => fUpd({ data: { id: cur.id, ip, accountId: cfAcc, zoneId: zone } }), "Réglages enregistrés")}>Enregistrer</Button></div>
          </div>
          {cfAccounts.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Ajoutez un compte Cloudflare dans Fournisseurs pour publier automatiquement.</p>}
          <div className="mt-3">
            <DataTable cols={["Contrôle", "Type", "Nom", "Valeur attendue", "En ligne"]}
              rows={cur.records.map((r) => {
                const c = cur.checks[r.key];
                return [<b>{LABELS[r.key]}</b>, <Pill>{r.type}</Pill>, <span className="block max-w-[220px] truncate" title={r.name}>{r.name}</span>,
                  <Button variant="ghost" className="flex max-w-[320px] items-center gap-1 text-left" title="Copier" onClick={() => { navigator.clipboard.writeText(r.content); toast("Copié"); }}><code className="truncate text-xs">{r.priority != null ? `${r.priority} ` : ""}{r.content}</code><Copy className="h-3 w-3 shrink-0" /></Button>,
                  !c ? <Pill>Non vérifié</Pill> : <Pill tone={c.ok ? "ok" : "bad"}>{c.ok ? "OK" : "Absent"}</Pill>];
              })} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Sélecteurs DKIM : {cur.selector_a} / {cur.selector_b} · Dernier contrôle : {cur.checked_at ? new Date(cur.checked_at).toLocaleString("fr-FR") : "jamais"} · Dernière publication : {cur.synced_at ? new Date(cur.synced_at).toLocaleString("fr-FR") : "jamais"}</p>
          <div className="mt-4 grid items-end gap-2 sm:grid-cols-[1fr_auto]">
            <label className="text-xs font-semibold text-muted-foreground">Serveur pour installation DKIM automatique
              <select aria-label="Serveur DKIM" className={sel} value={serverId} onChange={e=>setServerId(e.target.value)}><option value="">Choisir un serveur</option>{(servers.data ?? []).filter(s=>s.status!=='absent').map(s=><option key={s.id} value={s.id}>{s.label} · {s.ipv4 ?? 'IP en attente'}</option>)}</select>
            </label>
            <Button variant="outline" disabled={!serverId||!!busy} onClick={()=>run('bind',async()=>{await fBind({data:{serverId,domainId:cur.id}});await qc.invalidateQueries({queryKey:['domain-bindings']});},'Serveur associé — installation en attente de l’agent KumoMTA')}><Link2 className="h-4 w-4"/> Associer</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Les clés restent côté serveur. Installation automatique dès connexion de l’agent KumoMTA (phase 3).</p>
          {(bindings.data ?? []).filter(b=>b.domain_id===cur.id).map(b=><p key={b.id} className="mt-2 text-sm">{servers.data?.find(s=>s.id===b.server_id)?.label ?? 'Serveur'} · <Pill tone={b.status==='installed'?'ok':b.status==='error'?'bad':'warn'}>{b.status==='installed'?'Installé':b.status==='error'?'Erreur':'En attente de l’agent'}</Pill></p>)}
          {servers.error && <p role="alert" className="mt-2 text-sm text-destructive">{servers.error.message}</p>}
        </Panel>
      )}

      <Panel title="Vos domaines">
        {q.isLoading ? <p className="p-3 text-sm text-muted-foreground">Chargement…</p> : domains.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Aucun domaine. Ajoutez-en un ci-dessus.</p> :
          <DataTable cols={["Domaine", "IP", "SPF", "DKIM ×2", "DMARC", "Score", ""]}
            rows={domains.map((d) => {
              const p = (k: string) => !d.checks[k] ? <Pill>—</Pill> : <Pill tone={d.checks[k].ok ? "ok" : "bad"}>{d.checks[k].ok ? "OK" : "Manquant"}</Pill>;
              return [<span className="block min-w-0 truncate font-medium">{d.domain}</span>, d.ip ?? "—", p("spf"),
                <Pill tone={d.checks["dkim_a"]?.ok && d.checks["dkim_b"]?.ok ? "ok" : d.checks["dkim_a"] ? "bad" : "neutral"}>{d.checks["dkim_a"] ? `${Number(!!d.checks["dkim_a"]?.ok) + Number(!!d.checks["dkim_b"]?.ok)}/2` : "—"}</Pill>,
                p("dmarc"), `${score(d)} / ${d.records.length}`,
                <Button size="sm" variant={cur?.id === d.id ? "default" : "outline"} onClick={() => setSelId(d.id)}>Détails</Button>];
            })} />}
      </Panel>

      {cur && (
        <Panel title="Actions rapides">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!!busy} onClick={() => run("sync", async () => {
              const r = await fSync({ data: { id: cur.id } }); const bad = r.filter((x) => !x.ok);
              const first = bad[0];
              if (bad.length) throw new Error(`${bad.length} enregistrement(s) refusé(s) : ${first?.error ?? ""}`);
            }, "Enregistrements publiés sur Cloudflare")}><CloudUpload className="h-4 w-4" /> Publier sur Cloudflare</Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("check", () => fCheck({ data: { id: cur.id } }), "Contrôle DNS terminé")}><RefreshCw className={`h-4 w-4 ${busy === "check" ? "animate-spin" : ""}`} /> Vérifier en direct</Button>
            <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => { if (confirm(`Supprimer ${cur.domain} et ses clés DKIM ? (les DNS Cloudflare ne sont pas touchés)`)) run("del", () => fDel({ data: { id: cur.id } }), "Domaine supprimé"); }}><Trash2 className="h-4 w-4" /> Supprimer</Button>
          </div>
        </Panel>
      )}
      <StatusBar>{domains.length} domaine(s) · {ready} prêt(s) à envoyer · contrôle par DNS public</StatusBar>
    </>
  );
}
