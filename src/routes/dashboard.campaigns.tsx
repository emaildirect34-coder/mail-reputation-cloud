import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers, Plus } from "lucide-react";
import { CampaignTabs, ModuleHeader } from "@/components/dash/campaign-tabs";
import { DataTable, Panel, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { CampaignOutcomeComparison } from "@/components/dash/campaign-outcomes";
import { readCampaignList, readDeliverySourceQuality } from "@/lib/sending.functions";

export const Route = createFileRoute("/dashboard/campaigns")({
  head: () => ({ meta: [{ title: "Campagnes — Email Direct" }] }),
  component: Overview,
});

function Overview() {
  const read = useServerFn(readCampaignList);
  const q = useQuery({ queryKey: ["campaign-list"], queryFn: () => read(), refetchInterval: 30_000 });
  const readQuality = useServerFn(readDeliverySourceQuality);
  const quality = useQuery({ queryKey: ["campaign-source-quality"], queryFn: () => readQuality(), enabled: q.data?.isAdmin === true });
  const rows = q.data?.rows ?? [];
  const n = (value: number) => q.data ? value.toLocaleString("fr-FR") : "—";
  return <div className="space-y-3">
    <ModuleHeader icon={<Layers />} title="Campagnes" desc="Suivi des 50 dernières campagnes enregistrées." actions={
      q.data?.isAdmin && <Button asChild><Link to="/dashboard/campaigns/new"><Plus />Nouvelle campagne</Link></Button>
    } />
    <CampaignTabs active="overview" />
    {q.error && <p role="alert" className="text-destructive">{q.error.message}</p>}
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Campagnes en file" value={n(rows.filter(row => row.status === "queued").length)} />
      <Stat label="Campagnes suspendues" value={n(rows.filter(row => row.status === "paused").length)} />
      <Stat label="Messages en file" value={n(rows.reduce((sum, row) => sum + row.queued, 0))} />
      <Stat label="Messages injectés" value={n(rows.reduce((sum, row) => sum + row.injected, 0))} />
    </div>
    <Panel title="Dernières campagnes" action={<Button asChild variant="outline"><Link to="/dashboard/campaigns/list">Voir la liste</Link></Button>}>
      {q.isPending && <p role="status">Chargement des campagnes…</p>}
      {q.data && !rows.length && <p className="text-sm text-muted-foreground">Aucune campagne enregistrée.</p>}
      {!!rows.length && <DataTable cols={["Campagne", "Objet", "En file", "Injectés"]} rows={rows.slice(0, 8).map(row => [
        row.name, row.subject, n(row.queued), n(row.injected),
      ])} />}
    </Panel>
    {q.data?.isAdmin && <CampaignOutcomeComparison campaigns={rows} />}
    {q.data?.isAdmin && <Panel title="Qualité par liste sur les 7 derniers jours">
      {quality.isPending ? <p role="status">Chargement…</p> : quality.error ? <p role="alert">{quality.error.message}</p>
        : quality.data?.length ? <DataTable cols={["Liste source", "SMTP acceptés", "Rebonds", "Plaintes reçues", "Désabonnements"]}
          rows={quality.data.map(row => [row.source, row.accepted, row.hard_bounces, row.complaints, row.unsubscribes])} />
          : <p className="text-sm text-muted-foreground">{quality.data ? "Aucun événement observé." : "Données indisponibles. Appliquez la migration 0051."}</p>}
    </Panel>}
  </div>;
}
