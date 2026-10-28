import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";

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
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="En file" value="9 270" /><Stat label="En retry" value="2 254" /><Stat label="Débit" value="1 820/min" /><Stat label="Suspendues" value="1" />
      </div>
      <Panel title="Files actives">
        <DataTable cols={["Domaine", "Serveur", "Messages", "Retries", "État", ""]}
          rows={queues.map((q) => [q.d, q.srv, q.q.toLocaleString("fr"), q.ret, <Pill tone={q.st}>{q.st === "ok" ? "Fluide" : q.st === "warn" ? "Ralenti" : "Bloqué"}</Pill>,
            <div className="flex gap-1"><Button size="sm" variant="outline">Pause</Button><Button size="sm" variant="outline">Vider</Button></div>])} />
      </Panel>
      <Panel title="Traffic shaping">
        <DataTable cols={["Domaine", "Connexions max", "Msg / connexion", "Backoff", "Statut"]} rows={shaping} />
      </Panel>
    </>
  );
}
