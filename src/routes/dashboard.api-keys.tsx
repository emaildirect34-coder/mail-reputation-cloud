import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, Panel } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard/api-keys")({
  head: () => ({ meta: [{ title: "API & SMTP — Email Direct" }] }),
  component: ApiKeys,
});

function ApiKeys() {
  return <>
    <PageHeader title="API & SMTP" desc="Accès aux intégrations et aux agents d’envoi." />
    <Panel title="Authentification des agents KumoMTA">
      <p className="mb-3 text-sm text-muted-foreground">Les jetons sont associés aux serveurs. Un superadmin peut les gérer dans la fiche du serveur.</p>
      <Button asChild variant="outline"><Link to="/dashboard/servers">Ouvrir les serveurs</Link></Button>
    </Panel>
    <Panel title="Intégrations API">
      <p className="mb-3 text-sm text-muted-foreground">Configurez les comptes fournisseurs et les webhooks dans leurs espaces dédiés.</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link to="/dashboard/providers">Comptes fournisseurs</Link></Button>
        <Button asChild variant="outline"><Link to="/dashboard/webhooks">Webhooks</Link></Button>
      </div>
    </Panel>
    <Panel title="Envoi depuis une application externe">
      <p className="text-sm text-muted-foreground">L’API d’envoi publique et le relais SMTP authentifié ne sont pas configurés sur cette plateforme.</p>
    </Panel>
  </>;
}
