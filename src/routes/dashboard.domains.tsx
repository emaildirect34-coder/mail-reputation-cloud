import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, RefreshCw, CloudUpload, Download, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";
import { listDomains, addDomain, updateDomain, checkDomainDns, syncDomainDns, deleteDomain, exportDkimKey } from "@/lib/domains.functions";
import { listAccounts, listZones } from "@/lib/providers.functions";

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
const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function Domains() {
  const qc = useQueryClient();
  const fList = useServerFn(listDomains), fAdd = useServerFn(addDomain), fUpd = useServerFn(updateDomain);
  const fCheck = useServerFn(checkDomainDns), fSync = useServerFn(syncDomainDns), fDel = useServerFn(deleteDomain);
  const fKey = useServerFn(exportDkimKey), fAcc = useServerFn(listAccounts), fZones = useServerFn(listZones);

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
        <Stat label="Double DKIM" value={`${domains.filter((d) => d.checks.dkim_a?.ok && d.checks.dkim_b?.ok).length} / ${domains.length}`} />
        <Stat label="DMARC" value={`${cnt("dmarc")} / ${domains.length}`} />
        <Stat label="MTA-STS" value={`${cnt("mta_sts")} / ${domains.length}`} />
        <Stat label="Prêts à envoyer" value={`${ready} / ${domains.length}`} />
      </div>

      <Panel title="Ajouter un domaine">
        <form className="grid gap-2 sm:grid-cols-[1fr_200px_auto]" onSubmit={(e) => { e.preventDefault(); run("add", async () => { await fAdd({ data: { domain: form.domain, ip: form.ip || undefined } }); setForm({ domain: "", ip: "" }); }, "Domaine ajouté, 2 clés DKIM générées"); }}>
          <Input placeholder="ex. news.monsite.fr" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} required />
          <Input placeholder="IP d'envoi (optionnel)" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} />
          <Button disabled={busy === "add"}><Plus className="h-4 w-4" /> Ajouter</Button>
        </form>
      </Panel>

      {cur && (
        <Panel title={`Détails — ${cur.domain}`}>
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
                  <button className="flex max-w-[320px] items-center gap-1 text-left" title="Copier" onClick={() => { navigator.clipboard.writeText(r.content); toast("Copié"); }}><code className="truncate text-xs">{r.priority != null ? `${r.priority} ` : ""}{r.content}</code><Copy className="h-3 w-3 shrink-0" /></button>,
                  !c ? <Pill>Non vérifié</Pill> : <Pill tone={c.ok ? "ok" : "bad"}>{c.ok ? "OK" : "Absent"}</Pill>];
              })} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Sélecteurs DKIM : {cur.selector_a} / {cur.selector_b} · Dernier contrôle : {cur.checked_at ? new Date(cur.checked_at).toLocaleString("fr-FR") : "jamais"} · Dernière publication : {cur.synced_at ? new Date(cur.synced_at).toLocaleString("fr-FR") : "jamais"}</p>
        </Panel>
      )}

      <Panel title="Vos domaines">
        {q.isLoading ? <p className="p-3 text-sm text-muted-foreground">Chargement…</p> : domains.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Aucun domaine. Ajoutez-en un ci-dessus.</p> :
          <DataTable cols={["Domaine", "IP", "SPF", "DKIM ×2", "DMARC", "Score", ""]}
            rows={domains.map((d) => {
              const p = (k: string) => !d.checks[k] ? <Pill>—</Pill> : <Pill tone={d.checks[k].ok ? "ok" : "bad"}>{d.checks[k].ok ? "OK" : "Manquant"}</Pill>;
              return [<span className="block min-w-0 truncate font-medium">{d.domain}</span>, d.ip ?? "—", p("spf"),
                <Pill tone={d.checks.dkim_a?.ok && d.checks.dkim_b?.ok ? "ok" : d.checks.dkim_a ? "bad" : "neutral"}>{d.checks.dkim_a ? `${Number(!!d.checks.dkim_a?.ok) + Number(!!d.checks.dkim_b?.ok)}/2` : "—"}</Pill>,
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
            {(["a", "b"] as const).map((w) => (
              <Button key={w} size="sm" variant="outline" onClick={async () => {
                try { const k = await fKey({ data: { id: cur.id, which: w } }); const u = URL.createObjectURL(new Blob([k.pem], { type: "text/plain" })); const l = document.createElement("a"); l.href = u; l.download = k.filename; l.click(); URL.revokeObjectURL(u); }
                catch (e) { toast.error((e as Error).message); }
              }}><Download className="h-4 w-4" /> Clé privée DKIM {w === "a" ? 1 : 2}</Button>
            ))}
            <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => { if (confirm(`Supprimer ${cur.domain} et ses clés DKIM ? (les DNS Cloudflare ne sont pas touchés)`)) run("del", () => fDel({ data: { id: cur.id } }), "Domaine supprimé"); }}><Trash2 className="h-4 w-4" /> Supprimer</Button>
          </div>
        </Panel>
      )}
      <StatusBar>{domains.length} domaine(s) · {ready} prêt(s) à envoyer · contrôle par DNS public</StatusBar>
    </>
  );
}
