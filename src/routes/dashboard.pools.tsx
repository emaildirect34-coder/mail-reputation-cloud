import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Pill, DataTable, Stat, Bar } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard/pools")({
  head: () => ({ meta: [
    { title: "Pools VMTA & Auto-Tiering — Email Direct" },
    { name: "description", content: "Pools d'IP Gold, Silver et Quarantaine avec bascule automatique selon la réputation." },
    { property: "og:title", content: "Pools VMTA & Auto-Tiering — Email Direct" },
    { property: "og:description", content: "Gestion des pools d'IP par niveau de réputation." },
  ] }),
  component: Pools,
});

const pools = [
  { n: "Gold", d: "Transactionnel & engagés", ips: 8, score: 96, tone: "ok" as const },
  { n: "Silver", d: "Marketing régulier", ips: 14, score: 81, tone: "warn" as const },
  { n: "Quarantaine", d: "IPs en réhabilitation", ips: 3, score: 42, tone: "bad" as const },
];
const moves = [
  ["51.79.12.14", "Silver → Quarantaine", "Listée Spamhaus SBL", "Hermes · 13:47"],
  ["51.79.12.22", "Silver → Gold", "30 j sans plainte, réputation élevée", "Hermes · 09:12"],
  ["51.79.12.09", "Quarantaine → Silver", "Délistée + warmup terminé", "Manuel · hier"],
];

function Pools() {
  return (
    <>
      <PageHeader title="Pools VMTA & Auto-Tiering" desc="Les IPs montent ou descendent de niveau automatiquement selon leur réputation." action={<Button>Nouveau pool</Button>} />
      <div className="grid gap-4 sm:grid-cols-3">
        {pools.map((p) => (
          <Panel key={p.n} title={p.n} action={<Pill tone={p.tone}>{p.ips} IPs</Pill>}>
            <p className="mb-3 text-sm text-muted-foreground">{p.d}</p>
            <div className="mb-1 flex justify-between text-sm"><span>Santé</span><span>{p.score}</span></div>
            <Bar value={p.score} />
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="IPs totales" value="25" /><Stat label="Bascules 7j" value="6" /><Stat label="Isolation tenant" value="Stricte" /><Stat label="Rotation" value="Pondérée" />
      </div>
      <Panel title="Règles de bascule">
        <DataTable cols={["Condition", "Action", "Statut"]} rows={[
          ["Plaintes > 0,3 % sur 24 h", "Descendre d'un niveau", <Pill tone="ok">Active</Pill>],
          ["Listée RBL majeure", "Quarantaine immédiate", <Pill tone="ok">Active</Pill>],
          ["30 jours propres + réputation élevée", "Monter d'un niveau", <Pill tone="ok">Active</Pill>],
        ]} />
      </Panel>
      <Panel title="Historique des bascules">
        <DataTable cols={["IP", "Mouvement", "Raison", "Par"]} rows={moves} />
      </Panel>
    </>
  );
}
