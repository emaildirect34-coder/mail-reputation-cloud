import { createFileRoute } from "@tanstack/react-router";
import { Plus, Cloud, ShieldAlert, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/providers")({
  head: () => ({ meta: [{ title: "Fournisseurs & Clés — Email Direct" }] }),
  component: Providers,
});

const providers = [
  { name: "Linode", role: "Provisionnement VPS, IPs additionnelles, rDNS/PTR", scope: "Lecture/Écriture", status: "ok", last: "il y a 5 min" },
  { name: "Cloudflare", role: "Automatisation DNS (SPF, DKIM, DMARC, MX)", scope: "DNS Édition", status: "ok", last: "il y a 12 min" },
  { name: "Spamhaus DQS", role: "Requêtes de blacklists en temps réel", scope: "Clé DQS", status: "warn", last: "quota à 82 %" },
  { name: "Barracuda", role: "Surveillance réputation Barracuda Central", scope: "Compte enregistré", status: "neutral", last: "jamais" },
] as const;

function Providers() {
  return (
    <>
      <PageHeader
        title="Fournisseurs & Clés API"
        desc="Connectez vos comptes cloud et services de réputation : l'agent Hermes les utilise pour tout automatiser."
        action={<Button><Plus className="h-4 w-4" /> Ajouter un fournisseur</Button>}
      />

      <Panel title="Connexions configurées">
        <DataTable
          cols={["Fournisseur", "Rôle", "Droits", "Statut", "Dernière utilisation"]}
          rows={providers.map((p) => [
            <span className="flex items-center gap-2 font-medium"><Cloud className="h-4 w-4 text-muted-foreground" /> {p.name}</span>,
            <span className="text-muted-foreground">{p.role}</span>,
            <Pill>{p.scope}</Pill>,
            p.status === "ok" ? <Pill tone="ok">Actif</Pill> : p.status === "warn" ? <Pill tone="warn">Attention</Pill> : <Pill>Inactif</Pill>,
            <span className="text-muted-foreground">{p.last}</span>,
          ])}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Clés chiffrées">
          <p className="text-sm text-muted-foreground">
            Toutes les clés API sont stockées chiffrées et ne sont jamais affichées en clair après enregistrement.
            L'agent Hermes y accède uniquement pour exécuter les actions que vous avez autorisées.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline"><KeyRound className="h-4 w-4" /> Rotation des clés</Button>
            <Button size="sm" variant="outline"><ShieldAlert className="h-4 w-4" /> Journal d'accès</Button>
          </div>
        </Panel>
        <Panel title="Quotas & limites">
          <DataTable
            cols={["Service", "Utilisation", "Limite"]}
            rows={[
              ["Linode API", "312 requêtes / h", "1 600 / h"],
              ["Cloudflare API", "98 requêtes / h", "1 200 / 5 min"],
              ["Spamhaus DQS", "82 % du quota", "300 000 / mois"],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
