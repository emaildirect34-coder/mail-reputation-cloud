import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Pill, DataTable, Stat, Bar } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/shaping")({
  head: () => ({ meta: [
    { title: "Traffic Shaping FAI — Email Direct" },
    { name: "description", content: "Règles de débit KumoMTA par FAI : connexions, messages/min, backoff et micro-pacing." },
    { property: "og:title", content: "Traffic Shaping FAI — Email Direct" },
    { property: "og:description", content: "Politiques de débit par FAI pour KumoMTA." },
  ] }),
  component: Shaping,
});

const rules = [
  { isp: "Gmail", conn: 20, rate: "3 000/h", mpc: 50, back: "5m → 1h", tls: "Requis", ipv6: "Off", load: 62, st: "ok" as const },
  { isp: "Microsoft", conn: 8, rate: "1 200/h", mpc: 20, back: "10m → 2h", tls: "Opportuniste", ipv6: "Off", load: 88, st: "warn" as const },
  { isp: "Yahoo / AOL", conn: 12, rate: "2 000/h", mpc: 30, back: "5m → 1h", tls: "Requis", ipv6: "Off", load: 40, st: "ok" as const },
  { isp: "Orange / SFR", conn: 4, rate: "400/h", mpc: 10, back: "15m → 4h", tls: "Opportuniste", ipv6: "Off", load: 97, st: "bad" as const },
  { isp: "Apple iCloud", conn: 10, rate: "1 500/h", mpc: 25, back: "5m → 1h", tls: "Requis", ipv6: "Off", load: 30, st: "ok" as const },
];
const signals = [
  ["14:02", "Microsoft", "421 4.7.650 throttled", "Débit réduit de 30 %", <Pill tone="warn">Auto</Pill>],
  ["13:47", "Orange", "550 5.7.1 blocked IP", "Circuit ouvert 30 min", <Pill tone="bad">Breaker</Pill>],
  ["13:10", "Gmail", "421 4.7.28 rate limited", "Leaky bucket ralenti", <Pill tone="warn">Auto</Pill>],
];

function Shaping() {
  return (
    <>
      <PageHeader title="Traffic Shaping par FAI" desc="Politiques KumoMTA adaptatives : le débit s'ajuste selon les réponses SMTP de chaque FAI." action={<Button>Publier les règles</Button>} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Débit global" value="8 100/h" /><Stat label="Throttles 24h" value="37" sub="-12 %" /><Stat label="Circuits ouverts" value="1" /><Stat label="Mode" value="Adaptatif" />
      </div>
      <Panel title="Règles par FAI">
        <DataTable cols={["FAI", "Conn. max", "Débit", "Msg/conn", "Backoff", "TLS", "IPv6", "Charge", "État"]}
          rows={rules.map((r) => [r.isp, r.conn, r.rate, r.mpc, r.back, r.tls, r.ipv6, <div className="w-24"><Bar value={r.load} /></div>,
            <Pill tone={r.st}>{r.st === "ok" ? "Fluide" : r.st === "warn" ? "Ralenti" : "Bloqué"}</Pill>])} />
      </Panel>
      <div className="space-y-3">
        <Panel title="Réactions automatiques (codes SMTP)">
          <DataTable cols={["Heure", "FAI", "Réponse", "Action", "Type"]} rows={signals} />
        </Panel>
        <Panel title="Aperçu politique KumoMTA (Lua)">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">{`kumo.make_egress_path {
  connection_limit = 20,
  max_deliveries_per_connection = 50,
  max_message_rate = "3000/h",
  enable_tls = "Required",
  -- micro-pacing leaky bucket
}`}</pre>
        </Panel>
      </div>
      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Règles publiées sur les 3 nœuds KumoMTA.")}>Publier les règles</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Circuit de Orange rouvert pour test.")}>Rouvrir un circuit</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Simulation de débit lancée sur 5 FAI.")}>Simuler le débit</Button>
        </div>
      </Panel>
      <StatusBar>Traffic shaping adaptatif · 8 100 emails/h · 1 circuit ouvert</StatusBar>
    </>
  );
}
