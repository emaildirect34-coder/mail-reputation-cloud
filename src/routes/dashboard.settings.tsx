import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/settings")({
  head: () => ({
    meta: [
      { title: "Paramètres & Intégrations — Email Direct" },
      { name: "description", content: "Compte, sécurité, notifications, facturation et intégrations Email Direct." },
    ],
  }),
  component: Settings,
});

const TABS = ["Général", "Intégrations", "Sécurité", "Notifications", "Facturation"] as const;
type Tab = (typeof TABS)[number];

type Status = "connected" | "off" | "error";
const INTEGRATIONS: { cat: string; items: { name: string; desc: string; status: Status }[] }[] = [
  { cat: "Cloud & VPS", items: [
    { name: "Linode / Akamai", desc: "Création automatique des VPS KumoMTA, IPs dédiées et rDNS.", status: "connected" },
    { name: "Hetzner Cloud", desc: "Serveurs d'envoi haute performance à faible coût.", status: "off" },
    { name: "OVHcloud", desc: "Blocs d'IP Failover /28 à /24.", status: "off" },
    { name: "AWS EC2", desc: "Serveurs et relais d'appoint.", status: "off" },
    { name: "Vultr", desc: "VPS et IPs additionnelles par API.", status: "off" },
  ]},
  { cat: "DNS", items: [
    { name: "Cloudflare", desc: "SPF, double DKIM, DMARC, MTA-STS et BIMI en un clic.", status: "connected" },
    { name: "Amazon Route 53", desc: "Zones DNS haute disponibilité.", status: "off" },
    { name: "Google Cloud DNS", desc: "Synchronisation des zones.", status: "off" },
  ]},
  { cat: "Réputation FAI", items: [
    { name: "Google Postmaster Tools", desc: "Réputation IP/domaine et taux de plainte Gmail.", status: "connected" },
    { name: "Microsoft SNDS & JMRP", desc: "Statut des IPs chez Outlook et plaintes.", status: "error" },
    { name: "Yahoo CFL", desc: "Boucle de plaintes Yahoo / AOL.", status: "off" },
    { name: "Spamhaus DQS", desc: "Contrôle ZEN, SBL, XBL, DBL en temps réel.", status: "connected" },
    { name: "Barracuda / Abusix", desc: "Surveillance blacklists complémentaire.", status: "off" },
  ]},
  { cat: "Alertes & Hermes", items: [
    { name: "Slack", desc: "Alertes rebonds, blacklists et coupe-circuits.", status: "connected" },
    { name: "Discord", desc: "Salon d'alertes pour l'équipe.", status: "off" },
    { name: "Telegram", desc: "Alertes 24/7 et validation des actions Hermes.", status: "off" },
    { name: "PagerDuty", desc: "Escalade d'astreinte en cas de panne.", status: "off" },
  ]},
  { cat: "Validation & Anti-spam", items: [
    { name: "ZeroBounce", desc: "Nettoyage des listes à l'import.", status: "off" },
    { name: "NeverBounce", desc: "Vérification en masse.", status: "off" },
    { name: "SpamAssassin", desc: "Score antispam au Pre-Flight.", status: "connected" },
    { name: "Mail-Tester", desc: "Test de contenu avant envoi.", status: "off" },
  ]},
  { cat: "Stockage & Données", items: [
    { name: "Cloudflare R2", desc: "Archivage des messages et logs KumoMTA.", status: "off" },
    { name: "AWS S3", desc: "Archives chiffrées.", status: "off" },
    { name: "ClickHouse", desc: "Analytics événements en temps réel.", status: "off" },
    { name: "Datadog", desc: "Métriques et dashboards SRE.", status: "off" },
  ]},
  { cat: "CRM & Automatisation", items: [
    { name: "Zapier", desc: "Déclencheurs sur événements email.", status: "off" },
    { name: "HubSpot", desc: "Synchronisation des contacts.", status: "off" },
    { name: "Stripe", desc: "Facturation et revenus par campagne.", status: "off" },
  ]},
];

const STATUS: Record<Status, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  connected: { label: "Connecté", variant: "default" },
  off: { label: "Non configuré", variant: "secondary" },
  error: { label: "Erreur", variant: "destructive" },
};

function Settings() {
  const [tab, setTab] = useState<Tab>("Intégrations");
  return (
    <>
      <PageHeader title="Paramètres" desc="Compte, intégrations, sécurité et notifications." />
      <nav className="mb-6 flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Général" && <General />}
      {tab === "Intégrations" && <Integrations />}
      {tab === "Sécurité" && <Security />}
      {tab === "Notifications" && <Notifications />}
      {tab === "Facturation" && <Billing />}
      <StatusBar>Paramètres enregistrés automatiquement · 5 intégrations connectées</StatusBar>
    </>
  );
}

function Integrations() {
  const [q, setQ] = useState("");
  const f = q.toLowerCase();
  return (
    <div className="space-y-8">
      <Input placeholder="Rechercher une intégration…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      {INTEGRATIONS.map((g) => {
        const items = g.items.filter((i) => (i.name + i.desc).toLowerCase().includes(f));
        if (!items.length) return null;
        return (
          <section key={g.cat}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.cat}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((i) => (
                <div key={i.name} className="flex min-w-0 flex-col rounded-lg border bg-card p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-bold">{i.name[0]}</div>
                      <span className="min-w-0 truncate font-medium" title={i.name}>{i.name}</span>
                    </div>
                    <Badge variant={STATUS[i.status].variant}>{STATUS[i.status].label}</Badge>
                  </div>
                  <p className="flex-1 text-sm text-muted-foreground">{i.desc}</p>
                  <Button size="sm" variant={i.status === "connected" ? "outline" : "default"} className="mt-4 self-start">
                    {i.status === "connected" ? "Gérer" : "Configurer"}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function General() {
  return (
    <Panel title="Entreprise">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Nom de l'entreprise</Label><Input placeholder="Ma société" /></div>
        <div className="space-y-2"><Label>Email de facturation</Label><Input placeholder="compta@monsite.fr" /></div>
        <div className="space-y-2"><Label>Fuseau horaire</Label><Input placeholder="Europe/Paris" /></div>
      </div>
      <Button className="mt-4">Enregistrer</Button>
    </Panel>
  );
}

function Security() {
  return (
    <Panel title="Sécurité">
      {["Double authentification (TOTP)", "Validation Telegram des actions sensibles", "Restreindre l'accès par IP"].map((n) => (
        <div key={n} className="flex items-center justify-between border-b py-3 last:border-0">
          <span className="text-sm">{n}</span><Switch />
        </div>
      ))}
    </Panel>
  );
}

function Notifications() {
  return (
    <Panel title="Notifications">
      {["Alerte blacklist", "Taux de rebond élevé", "Fin de warmup", "Facturation"].map((n) => (
        <div key={n} className="flex items-center justify-between border-b py-3 last:border-0">
          <span className="text-sm">{n}</span><Switch defaultChecked />
        </div>
      ))}
    </Panel>
  );
}

function Billing() {
  return (
    <Panel title="Facturation">
      <p className="text-sm text-muted-foreground">Plan actuel : <b className="text-foreground">Pro</b> — 1 250 000 / 2 000 000 emails ce mois.</p>
      <Button className="mt-4" variant="outline">Changer de plan</Button>
    </Panel>
  );
}
