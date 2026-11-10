import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, Panel, DataTable } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { readProtection } from "@/lib/ops.functions";
import { setCampaignStatus } from "@/lib/sending.functions";

export const Route = createFileRoute("/dashboard/shield")({
  head: () => ({ meta: [{ title: "Protection & Urgence — Email Direct" }] }),
  component: Shield,
});

const format = (date: string) => new Date(date).toLocaleString("fr-FR");
const names: Record<string, string> = { hard_bounce: "Rebonds définitifs", complaint: "Plaintes", throttle: "Ralentissement SMTP" };

function Shield() {
  const read = useServerFn(readProtection);
  const change = useServerFn(setCampaignStatus);
  const state = useQuery({ queryKey: ["protection"], queryFn: () => read(), refetchInterval: 30_000 });
  const [busy, setBusy] = useState(false);

  async function pause(id: string) {
    setBusy(true);
    try {
      const result = await change({ data: { id, status: "paused" } });
      if (result.ok) toast.success("Campagne suspendue.");
      else toast.info("La campagne est déjà terminée ou annulée.");
      await state.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de suspendre la campagne.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageHeader title="Protection & Urgence" desc="Alertes enregistrées, campagnes bloquées et IP en quarantaine." />
    {state.isPending && <p role="status">Chargement des protections…</p>}
    {state.error && <p role="alert" className="text-destructive">{state.error.message}</p>}
    {state.data && <>
      <Panel title="Dernières alertes">
        {state.data.alerts.length ? <DataTable cols={["Date", "Campagne", "Fournisseur", "Règle", "Échantillon"]} rows={state.data.alerts.map(row => [
          format(row.created_at), row.campaign_name, row.isp, names[row.rule] ?? row.rule, row.sample_size,
        ])} /> : <p className="text-sm text-muted-foreground">Aucune alerte enregistrée.</p>}
      </Panel>
      <Panel title="Campagnes en cours et suspendues">
        {state.data.campaigns.length ? <DataTable cols={["Campagne", "État", "Motif", "Action"]} rows={state.data.campaigns.map(row => [
          row.name, row.status === "queued" ? "En file" : "Suspendue", row.auto_pause_reason ?? "—",
          state.data.isAdmin && row.status === "queued" ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void pause(row.id)}>Suspendre</Button> : "—",
        ])} /> : <p className="text-sm text-muted-foreground">Aucune campagne en cours.</p>}
      </Panel>
      <Panel title="IP en quarantaine" action={<Button asChild variant="outline" size="sm"><Link to="/dashboard/ips">Voir les IP</Link></Button>}>
        {state.data.ips.length ? <DataTable cols={["Adresse", "Depuis", "Motif"]} rows={state.data.ips.map(row => [
          row.address, row.quarantined_at ? format(row.quarantined_at) : "—", row.quarantine_reason ?? "—",
        ])} /> : <p className="text-sm text-muted-foreground">Aucune IP active en quarantaine.</p>}
      </Panel>
    </>}
  </>;
}
