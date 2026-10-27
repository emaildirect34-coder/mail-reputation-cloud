import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable } from "@/components/dash/kit";

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
      <PageHeader title="Webhooks" desc="Recevez les événements d'envoi sur vos serveurs." action={<Button><Plus className="h-4 w-4" /> Ajouter</Button>} />
      <Panel>
        <DataTable
          cols={["URL", "Événements", "Statut", ""]}
          rows={hooks.map((h) => [<code className="text-xs">{h.url}</code>, h.events, <Pill tone={h.ok ? "ok" : "bad"}>{h.ok ? "Actif" : "Échecs"}</Pill>, <Button size="sm" variant="outline">Tester</Button>])}
        />
      </Panel>
    </>
  );
}
