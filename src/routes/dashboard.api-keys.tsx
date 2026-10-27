import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/api-keys")({
  head: () => ({ meta: [{ title: "Clés API — Email Direct" }] }),
  component: ApiKeys,
});

const keys = [
  { name: "Production", key: "ed_live_••••••••4f2a", scope: "Envoi", last: "il y a 2 min" },
  { name: "Lecture stats", key: "ed_live_••••••••91bc", scope: "Lecture", last: "hier" },
];

function ApiKeys() {
  return (
    <>
      <PageHeader title="Clés API & SMTP" desc="Identifiants pour envoyer via REST ou SMTP." action={<Button><Plus className="h-4 w-4" /> Nouvelle clé</Button>} />
      <Panel title="Clés API">
        <DataTable cols={["Nom", "Clé", "Droits", "Dernière utilisation", ""]}
          rows={keys.map((k) => [k.name, <code>{k.key}</code>, <Pill>{k.scope}</Pill>, k.last, <Button size="sm" variant="outline">Révoquer</Button>])} />
      </Panel>
      <Panel title="Identifiants SMTP">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Serveur :</span> smtp.emaildirect.io</p>
          <p><span className="text-muted-foreground">Ports :</span> 587 (TLS), 465 (SSL)</p>
        </div>
      </Panel>
    </>
  );
}
