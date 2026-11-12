import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Layers, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CampaignTabs, ModuleHeader } from "@/components/dash/campaign-tabs";
import { CampaignDeliveryMonitor } from "@/components/dash/campaign-delivery-monitor";
import { CampaignCalendar } from "@/components/dash/campaign-workspace";
import { CampaignFollowup } from "@/components/dash/campaign-outcomes";
import { CampaignExclusionExport } from "@/components/dash/campaign-exclusions";
import { DataTable, Panel, Pill } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readCampaignList, setCampaignStatus } from "@/lib/sending.functions";

export const Route = createFileRoute("/dashboard/campaigns_/list")({
  validateSearch: (search: Record<string, unknown>): { monitor?: string } => {
    const monitor = z.string().uuid().safeParse(search["monitor"]);
    return monitor.success ? { monitor: monitor.data } : {};
  },
  head: () => ({ meta: [{ title: "Mes campagnes — Email Direct" }] }),
  component: ListPage,
});

const statuses: Record<string, string> = {
  queued: "En file", paused: "En pause", done: "Terminée", cancelled: "Annulée",
};
const number = new Intl.NumberFormat("fr-FR");

function ListPage() {
  const searchParams = Route.useSearch();
  const navigate = Route.useNavigate();
  const read = useServerFn(readCampaignList);
  const changeStatus = useServerFn(setCampaignStatus);
  const campaigns = useQuery({ queryKey: ["campaign-list"], queryFn: () => read(), refetchInterval: 30_000 });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const monitor = campaigns.data?.isAdmin ? searchParams.monitor ?? null : null;
  const [busy, setBusy] = useState<string | null>(null);
  const rows = campaigns.data?.rows.filter(row =>
    (!filter || row.status === filter) && (row.name + " " + row.subject).toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  const controlRows = campaigns.data?.rows.filter(row => row.status === 'paused' || row.failed > 0 || (row.status === 'queued' && row.queued > 0)) ?? [];

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

  async function cancel(id: string, name: string) {
    if (!window.confirm(`Annuler « ${name} » ? Les messages encore dans la file ne seront plus envoyés.`)) return;
    setBusy(id);
    try {
      await changeStatus({ data: { id, status: 'cancelled' } });
      await campaigns.refetch();
      toast.success('Campagne annulée.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible d’annuler la campagne.');
    } finally { setBusy(null); }
  }

  return <div className="space-y-3">
    <ModuleHeader icon={<Layers />} title="Mes campagnes" desc="Consultez la file et le résultat d’injection de vos campagnes." actions={<>
      <Button variant="outline" onClick={() => void campaigns.refetch()} disabled={campaigns.isFetching}><RefreshCw />Actualiser</Button>
      {campaigns.data?.isAdmin && <Button asChild><Link to="/dashboard/campaigns/new"><Plus />Nouvelle campagne</Link></Button>}
    </>} />
    <CampaignTabs active="list" />
    {campaigns.data?.isAdmin && <CampaignCalendar />}
    {campaigns.data?.isAdmin && <CampaignFollowup campaigns={rows} />}
    {campaigns.data?.isAdmin && <CampaignExclusionExport campaigns={campaigns.data.rows} />}
    {campaigns.data?.isAdmin && <Panel title="Centre de contrôle des campagnes">
      <p className="mb-3 text-sm text-muted-foreground">Les pauses de protection restent bloquées tant que leur cause n’est pas résolue. Ouvrez le suivi pour voir les fournisseurs, les validations requises et les détails des échecs.</p>
      {controlRows.length === 0 ? <p className="text-sm">Aucune campagne active ne demande d’attention.</p> : <DataTable cols={["Campagne", "État", "Raison / progression", "Actions"]} rows={controlRows.map(row => [
        <div><strong>{row.name}</strong><p className="text-xs text-muted-foreground">{row.subject}</p></div>,
        <Pill tone={row.status === 'paused' || row.failed > 0 ? 'warn' : 'neutral'}>{row.status === 'paused' ? 'En pause' : row.failed > 0 ? 'Échecs à examiner' : 'En cours / en attente'}</Pill>,
        <span className="text-sm">{row.auto_pause_reason ? `Protection automatique : ${row.auto_pause_reason}` : row.status === 'paused' ? 'Suspendue manuellement.' : row.failed > 0 ? `${number.format(row.failed)} échec(s) d’injection à diagnostiquer.` : `${number.format(row.queued)} message(s) encore en file.`}</span>,
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void navigate({ search: { monitor: row.id } })}>Diagnostic</Button>
          {row.status === 'paused' && !row.auto_pause_reason && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggle(row.id, 'queued')}>Reprendre</Button>}
          {row.status === 'queued' && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggle(row.id, 'paused')}>Suspendre</Button>}
          {row.status !== 'done' && row.status !== 'cancelled' && <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void cancel(row.id, row.name)}>Annuler</Button>}
        </div>,
      ])} />}
    </Panel>}
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
      {!!rows.length && <DataTable cols={["Campagne", ...(campaigns.data?.isAdmin ? ["Serveur d’envoi"] : []), "État", "Audience", "En file", "Injectés", "Échecs", "Actions"]} rows={rows.map(row => [
        <div><strong>{row.name}</strong><p className="text-xs text-muted-foreground">{row.subject}</p></div>,
        ...(campaigns.data?.isAdmin ? [row.serverNames.join(", ") || "—"] : []),
        <div><Pill tone={row.status === "done" ? "ok" : row.status === "paused" ? "warn" : "neutral"}>{statuses[row.status] ?? row.status}</Pill>{row.auto_pause_reason && <p className="mt-1 text-xs text-muted-foreground">{row.auto_pause_reason}</p>}</div>,
        number.format(row.total), number.format(row.queued), number.format(row.injected), number.format(row.failed),
        campaigns.data?.isAdmin ? <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void navigate({ search: { monitor: row.id } })}>Suivi</Button>
          {row.status === "queued" && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggle(row.id, "paused")}>Suspendre</Button>}
          {row.status === "paused" && !row.auto_pause_reason && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggle(row.id, "queued")}>Reprendre</Button>}
        </div> : "—",
      ])} />}
    </Panel>
    <CampaignDeliveryMonitor id={monitor} close={() => void navigate({ search: {}, replace: true })} />
  </div>;
}
