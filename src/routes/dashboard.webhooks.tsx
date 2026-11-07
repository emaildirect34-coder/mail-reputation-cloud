import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/webhooks")({
  head: () => ({ meta: [{ title: "Webhooks — Email Direct" }] }),
  component: Webhooks,
});

const hooks = [
  { url: "https://monsite.fr/hooks/email", events: "delivered, bounced, complained", ok: true },
  { url: "https://crm.exemple.io/api/mail", events: "opened, clicked", ok: false },
];

function Webhooks() {
  return (
    <>
      <PageHeader title="Webhooks" desc="Recevez les événements d'envoi sur vos serveurs." action={<Button onClick={() => toast("Formulaire d'ajout de webhook ouvert.")}><Plus className="h-4 w-4" /> Ajouter</Button>} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Webhooks" value={String(hooks.length)} />
        <Stat label="Actifs" value={String(hooks.filter((h) => h.ok).length)} />
        <Stat label="En échec" value={String(hooks.filter((h) => !h.ok).length)} />
        <Stat label="Événements / min" value="240" />
      </div>

      <Panel title="Endpoints configurés">
        <DataTable
          cols={["URL", "Événements", "Statut", ""]}
          rows={hooks.map((h) => [
            <code className="text-xs">{h.url}</code>,
            <span className="text-muted-foreground">{h.events}</span>,
            <Pill tone={h.ok ? "ok" : "bad"}>{h.ok ? "Actif" : "Échecs"}</Pill>,
            <Button size="sm" variant="outline" onClick={() => toast(`Test envoyé sur ${h.url}.`)}>Tester</Button>,
          ])}
        />
      </Panel>

      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Reprise des livraisons en échec sur crm.exemple.io.")}>Relancer les échecs</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Journal des 500 derniers appels webhook ouvert.")}>Voir le journal des appels</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Secret de signature régénéré pour tous les endpoints.")}>Régénérer la signature</Button>
        </div>
      </Panel>
      <StatusBar>2 endpoints · 1 actif · 1 en échec à corriger</StatusBar>
    </>
  );
}
