import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Database, Upload, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, Stat } from "@/components/dash/kit";
import { toast } from "sonner";
import { vaultOverview, vaultImport, vaultCount } from "@/lib/vault.functions";

export const Route = createFileRoute("/dashboard/vault")({
  head: () => ({ meta: [
    { title: "Base clients — Email Direct" },
    { name: "description", content: "Pilotez votre grande base de contacts hébergée sur un serveur dédié : import, nettoyage et segments." },
    { property: "og:title", content: "Base clients — Email Direct" },
    { property: "og:description", content: "Import massif et segments en 2 clics." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Vault,
});

const ISPS = ["gmail", "outlook", "yahoo", "orange", "sfr", "free", "laposte", "other"];
const fmt = (n?: number) => (n ?? 0).toLocaleString("fr-FR");
const gb = (b?: number) => ((b ?? 0) / 1e9).toFixed(1) + " Go";

function Vault() {
  const read = useServerFn(vaultOverview);
  const imp = useServerFn(vaultImport);
  const count = useServerFn(vaultCount);
  const [data, setData] = useState<Awaited<ReturnType<typeof vaultOverview>> | null>(null);
  const [src, setSrc] = useState("");
  const [delim, setDelim] = useState<"," | ";">(",");
  const [isp, setIsp] = useState<string[]>([]);
  const [country, setCountry] = useState("FR");
  const [days, setDays] = useState(90);
  const [result, setResult] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => read().then(setData).catch(e => toast.error(e.message));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  if (data && !data.configured) return (
    <div className="space-y-4">
      <PageHeader title="Base clients" desc="Votre grande base de contacts vit sur un serveur dédié, piloté d'ici." />
      <Panel title="Serveur de base pas encore connecté">
        <p className="text-sm text-muted-foreground">Le cahier des charges est prêt pour Codex. Dès que le serveur est en ligne, donnez-moi son adresse et sa clé : les chiffres, imports et segments apparaîtront ici.</p>
      </Panel>
    </div>
  );
  const s = data?.stats;
  return (
    <div className="space-y-4">
      <PageHeader title="Base clients" desc="Import massif, nettoyage automatique et segments." action={<Pill tone="ok">Connecté</Pill>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Contacts" value={fmt(s?.total)} />
        <Stat label="Actifs" value={fmt(s?.active)} />
        <Stat label="Invalides" value={fmt(s?.invalid)} />
        <Stat label="Supprimés" value={fmt(s?.suppressed)} />
        <Stat label="Espace utilisé" value={gb(s?.disk_bytes)} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Importer un fichier">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Lien du fichier CSV (colonnes : email, prénom, pays). Le serveur le lit en continu, retire les doublons, les adresses invalides et les désinscrits.</p>
            <Input value={src} onChange={e => setSrc(e.target.value)} placeholder="https://… ou sftp://…/clients.csv" />
            <div className="flex gap-2">
              {([",", ";"] as const).map(d => <Button key={d} size="sm" variant={delim === d ? "default" : "outline"} onClick={() => setDelim(d)}>Séparateur {d}</Button>)}
              <Button className="ml-auto" disabled={busy || src.length < 5} onClick={async () => {
                setBusy(true);
                try { await imp({ data: { source_url: src, delimiter: delim } }); toast.success("Import lancé"); setSrc(""); load(); }
                catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
              }}><Upload className="mr-1 h-4 w-4" />Lancer</Button>
            </div>
          </div>
        </Panel>
        <Panel title="Créer un segment">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {ISPS.map(i => <Button key={i} size="sm" variant={isp.includes(i) ? "default" : "outline"} onClick={() => setIsp(x => x.includes(i) ? x.filter(y => y !== i) : [...x, i])}>{i}</Button>)}
            </div>
            <div className="flex gap-2">
              <Input className="w-24" value={country} maxLength={2} onChange={e => setCountry(e.target.value.toUpperCase())} placeholder="Pays" />
              <Input className="w-32" type="number" value={days} onChange={e => setDays(Number(e.target.value))} />
              <span className="self-center text-sm text-muted-foreground">jours d'activité</span>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={async () => {
                try { const r = await count({ data: { filters: { isp, country: country.length === 2 ? [country] : [], active_days: days, status: "active" } } }); setResult(r.count); }
                catch (e: any) { toast.error(e.message); }
              }}><Filter className="mr-1 h-4 w-4" />Compter</Button>
              {result !== null && <span className="text-lg font-semibold">{fmt(result)} contacts</span>}
            </div>
          </div>
        </Panel>
      </div>
      <Panel title="Imports récents">
        {(data?.imports ?? []).length === 0 ? <p className="text-sm text-muted-foreground"><Database className="mr-1 inline h-4 w-4" />Aucun import pour l'instant.</p> : (
          <div className="space-y-2">
            {data!.imports.map((i: any) => (
              <div key={i.import_id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2 text-sm">
                <Pill tone={i.status === "done" ? "ok" : i.status === "failed" ? "bad" : "warn"}>{i.status}</Pill>
                <span>{fmt(i.rows_read)} lus</span><span>{fmt(i.rows_inserted)} ajoutés</span><span>{fmt(i.rows_rejected)} rejetés</span>
                {i.error && <span className="text-destructive">{i.error}</span>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
