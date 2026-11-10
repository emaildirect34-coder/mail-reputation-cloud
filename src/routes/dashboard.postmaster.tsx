import { createFileRoute, Link } from "@tanstack/react-router";
import { DeliveryDashboard } from "@/components/dash/delivery-dashboard";
import { PageHeader } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard/postmaster")({
  head: () => ({ meta: [{ title: "Rebonds & plaintes — Email Direct" }] }),
  component: Postmaster,
});

function Postmaster() {
  return <>
    <PageHeader title="Rebonds & plaintes" desc="Événements SMTP enregistrés par les serveurs d’envoi." action={
      <Button asChild variant="outline"><Link to="/dashboard/gmail-postmaster">Google Postmaster Tools</Link></Button>
    } />
    <DeliveryDashboard area="/dashboard/postmaster" />
  </>;
}
