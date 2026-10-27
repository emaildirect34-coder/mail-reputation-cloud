import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Stat, Panel, Pill } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({ meta: [{ title: "Vue d'ensemble — Email Direct" }] }),
  component: Overview,
});

const steps = [
  { t: "Connecter un serveur KumoMTA", d: "Créez un VPS automatiquement ou ajoutez le vôtre.", to: "/dashboard/servers" },
  { t: "Ajouter un domaine d'envoi", d: "SPF, DKIM, DMARC configurés pour vous.", to: "/dashboard/domains" },
  { t: "Attribuer et chauffer vos IPs", d: "Pools d'envoi et warmup progressif.", to: "/dashboard/ips" },
  { t: "Créer une clé API", d: "Envoyez via REST ou SMTP.", to: "/dashboard/api-keys" },
] as const;

function Overview() {
  return (
    <>
      <PageHeader title="Vue d'ensemble" desc="Activité des 30 derniers jours." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Envoyés" value="0" sub="30 derniers jours" />
        <Stat label="Délivrés" value="—" sub="taux de délivrabilité" />
        <Stat label="Rebonds" value="—" sub="hard + soft" />
        <Stat label="Plaintes" value="—" sub="spam reports" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Démarrage rapide">
            <ol className="divide-y">
              {steps.map((s, i) => (
                <li key={s.t} className="flex items-center gap-4 py-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border font-display text-sm">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.t}</p>
                    <p className="text-sm text-muted-foreground">{s.d}</p>
                  </div>
                  <Button asChild variant="outline" size="sm"><Link to={s.to}>Ouvrir</Link></Button>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Réputation">
            <p className="text-sm text-muted-foreground">Aucune IP ni domaine surveillé.</p>
            <div className="mt-3"><Pill tone="ok">Aucune alerte</Pill></div>
          </Panel>
          <Panel title="Serveurs">
            <p className="text-sm text-muted-foreground">0 serveur actif · 0 IP</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
