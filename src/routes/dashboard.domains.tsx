import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

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
  const count = (k: "spf" | "dkim" | "dmarc" | "rdns") => domains.filter((d) => d[k]).length;
  const ready = domains.filter((d) => d.spf && d.dkim && d.dmarc && d.rdns).length;
  return (
    <>
      <PageHeader
        title="Domaines d'envoi"
        desc="Authentification SPF, DKIM, DMARC et rDNS."
        action={<Button onClick={() => toast("Formulaire d'ajout de domaine ouvert.")}><Plus className="h-4 w-4" /> Ajouter un domaine</Button>}
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Domaines" value={String(domains.length)} />
        <Stat label="SPF" value={`${count("spf")} / ${domains.length}`} />
        <Stat label="DKIM" value={`${count("dkim")} / ${domains.length}`} />
        <Stat label="DMARC" value={`${count("dmarc")} / ${domains.length}`} />
        <Stat label="rDNS" value={`${count("rdns")} / ${domains.length}`} />
        <Stat label="Prêts à envoyer" value={`${ready} / ${domains.length}`} />
      </div>

      <Panel title={`Enregistrements DNS — ${sel}`}>
        <DataTable
          cols={["Type", "Nom", "Valeur"]}
          rows={records.map((r) => [<Pill>{r[0]}</Pill>, <span className="block min-w-0 truncate" title={r[1]}>{r[1]}</span>, <code className="text-xs">{r[2]}</code>])}
        />
      </Panel>

      <Panel title="Vos domaines">
        <DataTable
          cols={["Domaine", "SPF", "DKIM", "DMARC", "rDNS", ""]}
          rows={domains.map((d) => [
            <span className="block min-w-0 truncate font-medium" title={d.name}>{d.name}</span>, ok(d.spf), ok(d.dkim), ok(d.dmarc), ok(d.rdns),
            <Button size="sm" variant={sel === d.name ? "default" : "outline"} onClick={() => setSel(d.name)}>DNS</Button>,
          ])}
        />
      </Panel>

      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast(`Synchronisation Cloudflare lancée pour ${sel}.`)}>Synchroniser via API</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Contrôle SPF / DKIM / DMARC lancé sur 3 domaines.")}>Contrôler l'authentification</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Configuration rDNS / PTR vérifiée sur 14 IPs.")}>Vérifier le rDNS</Button>
        </div>
      </Panel>
      <StatusBar>3 domaines suivis · 1 entièrement conforme · DMARC manquant sur 1 domaine</StatusBar>
    </>
  );
}
