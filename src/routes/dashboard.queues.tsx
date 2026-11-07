import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/queues")({
  head: () => ({ meta: [{ title: "Queues KumoMTA — Email Direct" }, { name: "description", content: "Files d'attente, retries et traffic shaping." }] }),
  component: Queues,
});

const queues = [
  { d: "gmail.com", srv: "SRV011", q: 1240, ret: 32, st: "ok" as const },
  { d: "outlook.com", srv: "SRV011", q: 4310, ret: 410, st: "warn" as const },
  { d: "yahoo.com", srv: "SRV012", q: 820, ret: 12, st: "ok" as const },
  { d: "orange.fr", srv: "SRV020", q: 2900, ret: 1800, st: "bad" as const },
];
const shaping = [
  ["gmail.com", "20", "50", "5m → 1h", "Actif"],
  ["outlook.com", "10", "20", "10m → 2h", "Actif"],
  ["yahoo.com", "15", "30", "5m → 1h", "Actif"],
  ["orange.fr", "4", "10", "15m → 4h", "Restreint"],
];

function Queues() {
  return (
    <>
      <PageHeader title="Queues KumoMTA" desc="Supervision temps réel des files d'attente par domaine destinataire." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="En file" value="9 270" /><Stat label="En retry" value="2 254" /><Stat label="Débit" value="1 820/min" /><Stat label="Suspendues" value="1" />
      </div>
      <Panel title="Files actives">
        <DataTable cols={["Domaine", "Serveur", "Messages", "Retries", "État", ""]}
          rows={queues.map((q) => [q.d, q.srv, q.q.toLocaleString("fr"), q.ret, <Pill tone={q.st}>{q.st === "ok" ? "Fluide" : q.st === "warn" ? "Ralenti" : "Bloqué"}</Pill>,
            <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => toast(`File ${q.d} mise en pause.`)}>Pause</Button><Button size="sm" variant="outline" onClick={() => toast(`File ${q.d} vidée : ${q.q.toLocaleString("fr")} messages relancés.`)}>Vider</Button></div>])} />
      </Panel>
      <Panel title="Traffic shaping">
        <DataTable cols={["Domaine", "Connexions max", "Msg / connexion", "Backoff", "Statut"]} rows={shaping} />
      </Panel>
      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Toutes les files suspendues.")}>Suspendre toutes les files</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Retries relancés sur les 4 domaines.")}>Relancer les retries</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Vidage des files bloquées programmé.")}>Vider les files bloquées</Button>
        </div>
      </Panel>
      <StatusBar>Files KumoMTA sous contrôle · 9 270 en file · 1 file suspendue</StatusBar>
    </>
  );
}
