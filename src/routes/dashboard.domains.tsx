import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/domains")({
  head: () => ({ meta: [{ title: "Domaines — Email Direct" }] }),
  component: Domains,
});

const domains = [
  { name: "mail.monsite.fr", spf: true, dkim: true, dmarc: true, rdns: true },
  { name: "news.boutique.com", spf: true, dkim: true, dmarc: false, rdns: true },
  { name: "promo.exemple.io", spf: false, dkim: false, dmarc: false, rdns: false },
];
const ok = (v: boolean) => <Pill tone={v ? "ok" : "bad"}>{v ? "OK" : "Manquant"}</Pill>;

const records = [
  ["TXT", "mail.monsite.fr", "v=spf1 ip4:203.0.113.10 ~all"],
  ["TXT", "ed1._domainkey.mail.monsite.fr", "k=rsa; p=MIIBIjANBgkq…"],
  ["TXT", "_dmarc.mail.monsite.fr", "v=DMARC1; p=quarantine; rua=mailto:dmarc@monsite.fr"],
  ["MX", "mail.monsite.fr", "10 mx.emaildirect.io"],
  ["CNAME", "track.mail.monsite.fr", "track.emaildirect.io"],
];

function Domains() {
  const [sel, setSel] = useState("mail.monsite.fr");
  return (
    <>
      <PageHeader title="Domaines d'envoi" desc="Authentification SPF, DKIM, DMARC et rDNS." action={<Button><Plus className="h-4 w-4" /> Ajouter un domaine</Button>} />
      <Panel title="Vos domaines">
        <DataTable
          cols={["Domaine", "SPF", "DKIM", "DMARC", "rDNS", ""]}
          rows={domains.map((d) => [
            <span className="font-medium">{d.name}</span>, ok(d.spf), ok(d.dkim), ok(d.dmarc), ok(d.rdns),
            <Button size="sm" variant={sel === d.name ? "default" : "outline"} onClick={() => setSel(d.name)}>DNS</Button>,
          ])}
        />
      </Panel>
      <Panel title={`Enregistrements DNS — ${sel}`} action={<Button size="sm" variant="outline">Synchroniser via API</Button>}>
        <DataTable cols={["Type", "Nom", "Valeur"]} rows={records.map((r) => [<Pill>{r[0]}</Pill>, r[1], <code className="text-xs">{r[2]}</code>])} />
      </Panel>
    </>
  );
}
