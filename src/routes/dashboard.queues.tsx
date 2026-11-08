import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { readQueues } from "@/lib/ops.functions";
import { setCampaignStatus } from "@/lib/sending.functions";

export const Route = createFileRoute("/dashboard/queues")({
  head: () => ({ meta: [
    { title: "Files KumoMTA — Email Direct" },
    { name: "description", content: "Files d'envoi réelles par domaine destinataire et serveur." },
    { property: "og:title", content: "Files KumoMTA — Email Direct" },
    { property: "og:description", content: "Supervision des files d'envoi en temps réel." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Queues,
});

const n = (v: number) => v.toLocaleString("fr");

function Queues() {
  const read = useServerFn(readQueues);
  const setStatus = useServerFn(setCampaignStatus);
  const q = useQuery({ queryKey: ["queues"], queryFn: () => read(), refetchInterval: 15000 });
  const d = q.data;
  const act = async (id: string, status: "queued" | "paused") => {
    try { await setStatus({ data: { id, status } }); toast.success(status === "paused" ? "Campagne suspendue" : "Campagne relancée"); q.refetch(); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
      <PageHeader title="Files KumoMTA" desc="Messages réels en attente, pris par les agents, différés ou en échec." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="En file" value={d ? n(d.totals.queued) : "…"} />
        <Stat label="Pris par agents" value={d ? n(d.totals.claimed) : "…"} />
        <Stat label="Différés" value={d ? n(d.totals.deferred) : "…"} />
        <Stat label="Injectés / heure" value={d ? n(d.totals.sentHour) : "…"} />
      </div>
      {q.error && <Panel title="Erreur"><p className="text-sm text-destructive">{(q.error as Error).message}</p></Panel>}
      <Panel title="Files par domaine et serveur" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}><RefreshCw className="mr-1 h-3 w-3" />Actualiser</Button>}>
        {d && d.rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucun message en file pour l'instant.</p> :
        <DataTable cols={["Domaine", "Serveur", "En file", "Pris", "Différés", "Échecs", "État"]}
          rows={(d?.rows ?? []).map((r) => [r.domain, r.server, n(r.queued), n(r.claimed), n(r.deferred), n(r.failed),
            <Pill tone={r.failed > r.queued / 10 ? "bad" : r.deferred > 0 ? "warn" : "ok"}>{r.failed > r.queued / 10 ? "Bloqué" : r.deferred > 0 ? "Ralenti" : "Fluide"}</Pill>])} />}
      </Panel>
      <Panel title="Campagnes actives — actions">
        {d && d.campaigns.length === 0 ? <p className="text-sm text-muted-foreground">Aucune campagne en cours.</p> :
        <DataTable cols={["Campagne", "Statut", "Raison", ""]}
          rows={(d?.campaigns ?? []).map((c: any) => [c.name, <Pill tone={c.status === "paused" ? "warn" : "ok"}>{c.status}</Pill>, c.auto_pause_reason ?? "—",
            c.status === "paused"
              ? <Button size="sm" variant="outline" disabled={!!c.auto_pause_reason} onClick={() => act(c.id, "queued")}>Relancer</Button>
              : <Button size="sm" variant="outline" onClick={() => act(c.id, "paused")}>Suspendre</Button>])} />}
      </Panel>
      <StatusBar>{d ? `Données réelles · actualisé ${new Date(d.fetchedAt).toLocaleTimeString("fr")}` : "Chargement…"}</StatusBar>
    </>
  );
}
