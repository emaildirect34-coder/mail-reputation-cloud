import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";
import { listPreflightCampaigns, runPreflight, type Check } from "@/lib/preflight.functions";

export const Route = createFileRoute("/dashboard/preflight")({
  head: () => ({ meta: [
    { title: "Pre-Flight Gate — Email Direct" },
    { name: "description", content: "Contrôle avant envoi : authentification, contenu, liens, liste et conformité." },
    { property: "og:title", content: "Pre-Flight Gate — Email Direct" },
    { property: "og:description", content: "Vérifications automatiques avant chaque campagne." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Preflight,
});

type Res = Awaited<ReturnType<typeof runPreflight>>;
const word = { ok: "Validé", warn: "Attention", bad: "Bloquant" } as const;

function Preflight() {
  const list = useServerFn(listPreflightCampaigns);
  const run = useServerFn(runPreflight);
  const [camps, setCamps] = useState<{ id: string; name: string; status: string }[]>([]);
  const [sel, setSel] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { list().then(r => { setCamps(r.campaigns as any); if (r.campaigns[0]) setSel(r.campaigns[0].id); }).catch(e => toast.error(e.message)); }, []);

  const analyse = async () => {
    if (!sel) return;
    setBusy(true);
    try { setRes(await run({ data: { campaignId: sel } })); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const groups = res ? Array.from(new Set(res.checks.map(c => c.group))) : [];

  return (
    <>
      <PageHeader title="Audit de campagne" desc="Vérifications DNS, en-têtes générés et qualité du contenu, à la demande." />
      <Panel title="Campagne à contrôler">
        {camps.length === 0 ? <p className="text-sm text-muted-foreground">Aucune campagne. <Link to="/dashboard/campaigns/new" className="underline">Créer une campagne</Link></p> : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" value={sel} onChange={e => { setSel(e.target.value); setRes(null); }}>
              {camps.map(c => <option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}
            </select>
            <Button disabled={busy || !sel} onClick={analyse}>{busy ? "Analyse…" : res ? "Relancer l'analyse" : "Lancer l'analyse"}</Button>
          </div>
        )}
      </Panel>

      {res && <>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Score de l’audit" value={`${res.score} / 100`} />
          <Stat label="Contrôles" value={String(res.checks.length)} />
          <Stat label="Bloquants" value={String(res.blockers)} />
          <Stat label="Avertissements" value={String(res.warns)} />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {groups.map(g => (
            <Panel key={g} title={g}>
              <DataTable cols={["Contrôle", "Détail", "Résultat"]} rows={res.checks.filter(c => c.group === g).map((c: Check) => [
                c.name,
                <div><div className="break-all text-sm">{c.detail}</div>{c.fix && <div className="mt-1 text-xs text-muted-foreground">→ {c.fix}</div>}</div>,
                <Pill tone={c.tone}>{word[c.tone]}</Pill>,
              ])} />
            </Panel>
          ))}
        </div>
        <Panel title="Décision">
          <p className="text-sm text-muted-foreground">
            {res.blockers ? `${res.blockers} point(s) à corriger pour « ${res.campaign.name} ».` : 'Aucune anomalie bloquante détectée par cet audit.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link to="/dashboard/lab">Ouvrir le Lab</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/dashboard/validation">Nettoyer la liste</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/dashboard/domains">Domaines</Link></Button>
          </div>
        </Panel>
      </>}
      <StatusBar>{res ? `Score ${res.score}/100 · ${res.blockers} bloquant(s) · ${res.warns} avertissement(s)` : "Choisissez une campagne puis lancez l'analyse"}</StatusBar>
    </>
  );
}
