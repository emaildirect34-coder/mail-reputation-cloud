import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CampaignTabs, ModuleHeader } from "@/components/dash/campaign-tabs";
import { CampaignDeliveryMonitor } from "@/components/dash/campaign-delivery-monitor";
import { DataTable, Panel, Pill } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readCampaignList, setCampaignStatus } from "@/lib/sending.functions";

export const Route = createFileRoute("/dashboard/campaigns_/list")({
  head: () => ({ meta: [{ title: "Mes campagnes — Email Direct" }] }),
  component: ListPage,
});

const statuses: Record<string, string> = {
  queued: "En file", paused: "En pause", done: "Terminée", cancelled: "Annulée",
};
const number = new Intl.NumberFormat("fr-FR");

function ListPage() {
  const read = useServerFn(readCampaignList);
  const changeStatus = useServerFn(setCampaignStatus);
  const campaigns = useQuery({ queryKey: ["campaign-list"], queryFn: () => read(), refetchInterval: 30_000 });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [monitor, setMonitor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = campaigns.data?.rows.filter(row =>
    (!filter || row.status === filter) && (row.name + " " + row.subject).toLowerCase().includes(search.trim().toLowerCase())) ?? [];

  async function toggle(id: string, status: "queued" | "paused") {
    setBusy(id);
    try {
      const result = await changeStatus({ data: { id, status } });
      await campaigns.refetch();
      if (!result.ok) toast.info("La campagne est déjà terminée ou annulée.");
      else toast.success(status === "paused" ? "Campagne mise en pause." : "Campagne remise en file.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de modifier la campagne.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="space-y-3">
    <ModuleHeader icon={<Layers />} title="Mes campagnes" desc="Consultez la file et le résultat d’injection de vos campagnes." actions={<>
      <Button variant="outline" onClick={() => void campaigns.refetch()} disabled={campaigns.isFetching}><RefreshCw />Actualiser</Button>
      {campaigns.data?.isAdmin && <Button asChild><Link to="/dashboard/campaigns/new"><Plus />Nouvelle campagne</Link></Button>}
    </>} />
    <CampaignTabs active="list" />
    <Panel title="Campagnes enregistrées">
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-sm" aria-label="Rechercher une campagne" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nom ou objet" />
        <select className="rounded-md border bg-background px-2 text-sm" aria-label="Filtrer par statut" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      {campaigns.isPending && <p role="status">Chargement des campagnes…</p>}
      {campaigns.error && <p role="alert" className="text-destructive">{campaigns.error.message}</p>}
      {campaigns.data && !rows.length && <p className="text-muted-foreground">Aucune campagne pour ces filtres.</p>}
      {!!rows.length && <DataTable cols={["Campagne", "État", "Audience", "En file", "Injectés", "Échecs", "Actions"]} rows={rows.map(row => [
        <div><strong>{row.name}</strong><p className="text-xs text-muted-foreground">{row.subject}</p></div>,
        <div><Pill tone={row.status === "done" ? "ok" : row.status === "paused" ? "warn" : "neutral"}>{statuses[row.status] ?? row.status}</Pill>{row.auto_pause_reason && <p className="mt-1 text-xs text-muted-foreground">{row.auto_pause_reason}</p>}</div>,
        number.format(row.total), number.format(row.queued), number.format(row.injected), number.format(row.failed),
        campaigns.data?.isAdmin ? <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setMonitor(row.id)}>Suivi</Button>
          {row.status === "queued" && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggle(row.id, "paused")}>Suspendre</Button>}
          {row.status === "paused" && !row.auto_pause_reason && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggle(row.id, "queued")}>Reprendre</Button>}
        </div> : "—",
      ])} />}
    </Panel>
    <CampaignDeliveryMonitor id={monitor} close={() => setMonitor(null)} />
  </div>;
}
