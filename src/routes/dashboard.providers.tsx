import { createFileRoute } from "@tanstack/react-router";
import { Plus, Cloud, ShieldAlert, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

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
        action={<Button onClick={() => toast("Sélection d'un fournisseur à connecter.")}><Plus className="h-4 w-4" /> Ajouter un fournisseur</Button>}
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Fournisseurs" value={String(providers.length)} />
        <Stat label="Actifs" value={String(providers.filter((p) => p.status === "ok").length)} />
        <Stat label="Attention" value={String(providers.filter((p) => p.status === "warn").length)} />
        <Stat label="Inactifs" value={String(providers.filter((p) => p.status === "neutral").length)} />
      </div>

      <Panel title="Clés chiffrées">
        <p className="text-sm text-muted-foreground">
          Toutes les clés API sont stockées chiffrées et ne sont jamais affichées en clair après enregistrement.
          L'agent Hermes y accède uniquement pour exécuter les actions que vous avez autorisées.
        </p>
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

      <Panel title="Connexions configurées">
        <DataTable
          cols={["Fournisseur", "Rôle", "Droits", "Statut", "Dernière utilisation"]}
          rows={providers.map((p) => [
            <span className="flex min-w-0 items-center gap-2 font-medium"><Cloud className="h-4 w-4 shrink-0 text-muted-foreground" /> <span className="min-w-0 truncate" title={p.name}>{p.name}</span></span>,
            <span className="text-muted-foreground">{p.role}</span>,
            <Pill>{p.scope}</Pill>,
            p.status === "ok" ? <Pill tone="ok">Actif</Pill> : p.status === "warn" ? <Pill tone="warn">Attention</Pill> : <Pill>Inactif</Pill>,
            <span className="text-muted-foreground">{p.last}</span>,
          ])}
        />
      </Panel>

      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Rotation des clés API programmée sur 2 fournisseurs.")}><KeyRound className="h-4 w-4" /> Rotation des clés</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Journal d'accès aux clés ouvert sur 30 jours.")}><ShieldAlert className="h-4 w-4" /> Journal d'accès</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Connexion à Barracuda à finaliser.")}>Connecter Barracuda</Button>
        </div>
      </Panel>
      <StatusBar>4 fournisseurs suivis · 2 actifs · quota Spamhaus à 82 %</StatusBar>
    </>
  );
}
