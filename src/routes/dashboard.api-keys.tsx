import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

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
      <PageHeader title="Clés API & SMTP" desc="Identifiants pour envoyer via REST ou SMTP." action={<Button onClick={() => toast("Nouvelle clé API créée en mode brouillon.")}><Plus className="h-4 w-4" /> Nouvelle clé</Button>} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Clés actives" value={String(keys.length)} />
        <Stat label="Droits d'envoi" value={String(keys.filter((k) => k.scope === "Envoi").length)} />
        <Stat label="Lecture seule" value={String(keys.filter((k) => k.scope === "Lecture").length)} />
        <Stat label="Endpoints SMTP" value="1" sub="smtp.emaildirect.io" />
      </div>

      <Panel title="Clés API">
        <DataTable cols={["Nom", "Clé", "Droits", "Dernière utilisation", ""]}
          rows={keys.map((k) => [k.name, <code>{k.key}</code>, <Pill>{k.scope}</Pill>, k.last, <Button size="sm" variant="outline" onClick={() => toast(`Clé « ${k.name} » révoquée.`)}>Révoquer</Button>])} />
      </Panel>

      <Panel title="Identifiants SMTP">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Serveur :</span> smtp.emaildirect.io</p>
          <p><span className="text-muted-foreground">Ports :</span> 587 (TLS), 465 (SSL)</p>
        </div>
      </Panel>

      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Clé de test créée (aucun envoi réel).")}>Créer une clé de test</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Rotation de la clé Production programmée dans 24 h.")}>Faire tourner une clé</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Envoi de vérification SMTP envoyé sur 3 ports.")}>Tester SMTP</Button>
        </div>
      </Panel>
      <StatusBar>2 clés actives · 1 clé d'envoi · SMTP prêt sur 587 / 465</StatusBar>
    </>
  );
}
