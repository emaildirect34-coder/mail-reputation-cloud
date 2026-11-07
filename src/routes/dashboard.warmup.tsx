import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Pill, DataTable, Bar } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/warmup")({
  head: () => ({ meta: [{ title: "Warmup par FAI — Email Direct" }, { name: "description", content: "Plans de chauffe d'IPs par fournisseur de messagerie." }] }),
  component: Warmup,
});

const isps = [
  { isp: "Gmail", day: 12, quota: "8 000", hourly: "400", sent: 72 },
  { isp: "Microsoft 365 / Outlook", day: 12, quota: "5 000", hourly: "250", sent: 54 },
  { isp: "Yahoo / AOL", day: 12, quota: "4 000", hourly: "200", sent: 88 },
  { isp: "Orange / Wanadoo", day: 12, quota: "2 500", hourly: "120", sent: 31 },
  { isp: "Free / SFR", day: 12, quota: "2 000", hourly: "100", sent: 45 },
  { isp: "Autres", day: 12, quota: "10 000", hourly: "600", sent: 60 },
];
const profiles = [
  { n: "Conservateur", d: "45 jours", desc: "Pour IPs neuves sur listes froides" },
  { n: "Standard", d: "30 jours", desc: "Recommandé pour la plupart des envois" },
  { n: "Agressif", d: "15 jours", desc: "Listes très engagées uniquement" },
];

function Warmup() {
  return (
    <>
      <PageHeader title="Warmup par FAI" desc="Quotas journaliers et horaires appliqués automatiquement par KumoMTA." action={<Button>Nouveau plan</Button>} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {profiles.map((p, i) => (
          <div key={p.n} className={`rounded-lg border bg-card p-5 ${i === 1 ? "ring-2 ring-primary" : ""}`}>
            <div className="flex items-center justify-between"><h3 className="font-display font-semibold">{p.n}</h3><Pill tone={i === 1 ? "ok" : "neutral"}>{p.d}</Pill></div>
            <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
          </div>
        ))}
      </div>
      <Panel title="IP 203.0.113.24 · Pool Marketing · Jour 12/30">
        <DataTable cols={["FAI", "Jour", "Quota / jour", "Max / heure", "Consommé aujourd'hui"]}
          rows={isps.map((r) => [r.isp, r.day, r.quota, r.hourly, <div className="flex w-40 items-center gap-2"><Bar value={r.sent} /><span className="text-xs">{r.sent}%</span></div>])} />
      </Panel>
      <Panel title="Règles automatiques">
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>• Pause automatique si taux de rebond &gt; 5 % sur un FAI</li>
          <li>• Réduction du quota de 50 % si taux de plainte &gt; 0,1 %</li>
          <li>• Passage au jour suivant uniquement si délivrabilité &gt; 95 %</li>
        </ul>
      </Panel>
      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Plan conservateur appliqué à l'IP 203.0.113.24.")}>Appliquer le plan conservateur</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Passage au jour 13 demandé pour les FAI éligibles.")}>Passer au jour suivant</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Rapport de chauffe exporté.")}>Exporter le rapport de chauffe</Button>
        </div>
      </Panel>
      <StatusBar>Chauffe en cours · 6 FAI suivis · 12 500 emails/jour autorisés</StatusBar>
    </>
  );
}
