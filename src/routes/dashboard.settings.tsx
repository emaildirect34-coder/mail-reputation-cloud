import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Email Direct" }] }),
  component: Settings,
});

function Settings() {
  return (
    <>
      <PageHeader title="Paramètres" desc="Compte, entreprise et notifications." />
      <Panel title="Entreprise">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>Nom de l'entreprise</Label><Input placeholder="Ma société" /></div>
          <div className="space-y-2"><Label>Email de facturation</Label><Input placeholder="compta@monsite.fr" /></div>
        </div>
        <Button className="mt-4">Enregistrer</Button>
      </Panel>
      <Panel title="Notifications">
        {["Alerte blacklist", "Taux de rebond élevé", "Fin de warmup", "Facturation"].map((n) => (
          <div key={n} className="flex items-center justify-between border-b py-3 last:border-0">
            <span className="text-sm">{n}</span><Switch defaultChecked />
          </div>
        ))}
      </Panel>
    </>
  );
}
