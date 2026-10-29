import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Pill, DataTable, Stat, Bar } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard/postmaster")({
  head: () => ({ meta: [
    { title: "Google Postmaster & SNDS — Email Direct" },
    { name: "description", content: "Réputation Gmail et Microsoft : taux de plainte, réputation IP/domaine, authentification." },
    { property: "og:title", content: "Google Postmaster & SNDS — Email Direct" },
    { property: "og:description", content: "Suivi de réputation officielle Gmail et Microsoft." },
  ] }),
  component: Postmaster,
});

const spam = [0.04, 0.05, 0.06, 0.05, 0.08, 0.12, 0.09, 0.07, 0.06, 0.05, 0.04, 0.05, 0.06, 0.05];
const domains = [
  ["news.client.com", <Pill tone="ok">Élevée</Pill>, "0,05 %", "100 %", "100 %", "100 %"],
  ["promo.client.com", <Pill tone="warn">Moyenne</Pill>, "0,18 %", "100 %", "99,8 %", "98 %"],
  ["mail.shop.io", <Pill tone="bad">Faible</Pill>, "0,34 %", "97 %", "95 %", "90 %"],
];
const snds = [
  ["51.79.12.10", <Pill tone="ok">Vert</Pill>, "0,02 %", "0", "Non"],
  ["51.79.12.11", <Pill tone="warn">Jaune</Pill>, "0,2 %", "1", "Non"],
  ["51.79.12.14", <Pill tone="bad">Rouge</Pill>, "0,6 %", "4", "Oui"],
];

function Postmaster() {
  const max = Math.max(...spam);
  return (
    <>
      <PageHeader title="Google Postmaster & Microsoft SNDS" desc="Réputation officielle des FAI, synchronisée chaque jour par API." action={<Button variant="outline">Connecter Postmaster</Button>} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Taux de plainte Gmail" value="0,05 %" sub="Seuil 0,10 % / max 0,30 %" />
        <Stat label="Réputation domaine" value="Élevée" /><Stat label="TLS entrant" value="100 %" /><Stat label="IPs SNDS rouges" value="1" />
      </div>
      <Panel title="Taux de plainte Gmail — 14 jours">
        <div className="flex h-40 items-end gap-2">
          {spam.map((v, i) => (
            <div key={i} className={`flex-1 rounded-t ${v > 0.1 ? "bg-destructive" : "bg-primary"}`} style={{ height: `${(v / max) * 100}%` }} title={`${v} %`} />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Rouge = au-dessus de 0,10 % (zone d'alerte Google).</p>
      </Panel>
      <Panel title="Domaines (Gmail)">
        <DataTable cols={["Domaine", "Réputation", "Plaintes", "SPF", "DKIM", "DMARC"]} rows={domains} />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Microsoft SNDS — IPs">
          <DataTable cols={["IP", "Statut", "Plaintes", "Trap hits", "JMRP"]} rows={snds} />
        </Panel>
        <Panel title="Conformité expéditeurs (Gmail/Yahoo 2024)">
          {[["SPF + DKIM alignés", 100], ["DMARC publié", 100], ["One-click unsub RFC 8058", 96], ["FCrDNS valide", 100], ["TLS", 100]].map(([l, v]) => (
            <div key={l as string} className="mb-3"><div className="mb-1 flex justify-between text-sm"><span>{l}</span><span>{v} %</span></div><Bar value={v as number} /></div>
          ))}
        </Panel>
      </div>
    </>
  );
}
