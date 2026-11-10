import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAccounts } from "@/lib/providers.functions";
import { listPlacementSeeds, removePlacementSeed, savePlacementSeed } from "@/lib/ops.functions";
import { supabase } from "@/integrations/supabase/client";
import { campaignTimeZone } from "@/lib/campaign-schedule";
import { readCampaignFrequencyPolicy, setCampaignFrequencyPolicy } from "@/lib/sending.functions";

export const Route = createFileRoute("/dashboard/settings")({
  head: () => ({
    meta: [
      { title: "Paramètres & Intégrations — Email Direct" },
      { name: "description", content: "Compte, sécurité, notifications, facturation et intégrations Email Direct." },
    ],
  }),
  component: Settings,
});

const TABS = ["Général", "Intégrations", "Boîtes témoins Gmail", "Sécurité", "Notifications", "Facturation"] as const;
type Tab = (typeof TABS)[number];

type Status = "connected" | "off" | "error" | "unknown";
const INTEGRATIONS: { cat: string; items: { name: string; desc: string; provider?: string }[] }[] = [
  { cat: "Cloud & VPS", items: [
    { name: "Linode / Akamai", provider: "linode", desc: "Création automatique des VPS KumoMTA, IPs dédiées et rDNS." },
    { name: "Hetzner Cloud", provider: "hetzner", desc: "Serveurs d'envoi haute performance à faible coût." },
    { name: "OVHcloud", desc: "Blocs d'IP Failover /28 à /24." },
    { name: "AWS EC2", desc: "Serveurs et relais d'appoint." },
    { name: "Vultr", provider: "vultr", desc: "VPS et IPs additionnelles par API." },
  ]},
  { cat: "DNS", items: [
    { name: "Cloudflare", provider: "cloudflare", desc: "SPF, double DKIM, DMARC, MTA-STS et BIMI en un clic." },
    { name: "Amazon Route 53", desc: "Zones DNS haute disponibilité." },
    { name: "Google Cloud DNS", desc: "Synchronisation des zones." },
  ]},
  { cat: "Réputation FAI", items: [
    { name: "Google Postmaster Tools", provider: "google_postmaster", desc: "Réputation IP/domaine et taux de plainte Gmail." },
    { name: "Microsoft SNDS & JMRP", desc: "Statut des IPs chez Outlook et plaintes." },
    { name: "Yahoo CFL", desc: "Boucle de plaintes Yahoo / AOL." },
    { name: "Spamhaus DQS", desc: "Contrôle ZEN, SBL, XBL, DBL en temps réel." },
    { name: "Barracuda / Abusix", desc: "Surveillance blacklists complémentaire." },
  ]},
  { cat: "Alertes & Hermes", items: [
    { name: "Slack", desc: "Alertes rebonds, blacklists et coupe-circuits." },
    { name: "Discord", desc: "Salon d'alertes pour l'équipe." },
    { name: "Telegram", desc: "Alertes 24/7 et validation des actions Hermes." },
    { name: "PagerDuty", desc: "Escalade d'astreinte en cas de panne." },
  ]},
  { cat: "Validation & Anti-spam", items: [
    { name: "ZeroBounce", desc: "Nettoyage des listes à l'import." },
    { name: "NeverBounce", desc: "Vérification en masse." },
    { name: "SpamAssassin", desc: "Score antispam au Pre-Flight." },
    { name: "Mail-Tester", desc: "Test de contenu avant envoi." },
  ]},
  { cat: "Stockage & Données", items: [
    { name: "Cloudflare R2", desc: "Archivage des messages et logs KumoMTA." },
    { name: "AWS S3", desc: "Archives chiffrées." },
    { name: "ClickHouse", desc: "Analytics événements en temps réel." },
    { name: "Datadog", desc: "Métriques et dashboards SRE." },
  ]},
  { cat: "CRM & Automatisation", items: [
    { name: "Zapier", desc: "Déclencheurs sur événements email." },
    { name: "HubSpot", desc: "Synchronisation des contacts." },
    { name: "Stripe", desc: "Facturation et revenus par campagne." },
  ]},
];

const STATUS: Record<Status, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  connected: { label: "Connecté", variant: "default" },
  off: { label: "Non configuré", variant: "secondary" },
  error: { label: "Erreur", variant: "destructive" },
  unknown: { label: "Statut indisponible", variant: "secondary" },
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
            aria-pressed={tab === t}
            className={cn(
              "whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Général" && <><General /><CampaignFrequency /></>}
      {tab === "Intégrations" && <Integrations />}
      {tab === "Boîtes témoins Gmail" && <GmailSeeds />}
      {tab === "Sécurité" && <Security />}
      {tab === "Notifications" && <Notifications />}
      {tab === "Facturation" && <Billing />}
      <StatusBar>Paramètres du compte</StatusBar>
    </>
  );
}

function GmailSeeds() {
  const list = useServerFn(listPlacementSeeds);
  const save = useServerFn(savePlacementSeed);
  const remove = useServerFn(removePlacementSeed);
  const accounts = useQuery({ queryKey: ["placement-seeds"], queryFn: () => list(), retry: false });
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function update(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
      setMessage(success);
      await accounts.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de modifier les boîtes témoins.");
    } finally {
      setBusy(false);
    }
  }

  return <Panel title="Boîtes témoins Gmail">
    <p className="mb-4 text-sm text-muted-foreground">Utilisez des comptes Gmail dédiés aux tests de placement. Mail-Tester vérifie la connexion IMAP avant d’enregistrer le mot de passe d’application.</p>
    {accounts.isPending && <p>Chargement…</p>}
    {accounts.isError && <p role="alert">{accounts.error.message}</p>}
    {accounts.data?.configured === false && <p role="alert">Mail-Tester n’est pas configuré.</p>}
    {accounts.data?.configured && <>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => {
        event.preventDefault();
        const secret = password;
        setPassword("");
        void update(async () => { await save({ data: { address, password: secret } }); setAddress(""); }, "Connexion Gmail vérifiée. Boîte enregistrée.");
      }}>
        <label className="space-y-1 text-sm font-medium">Adresse Gmail<Input type="email" value={address} onChange={e => setAddress(e.target.value)} required disabled={busy} /></label>
        <label className="space-y-1 text-sm font-medium">Mot de passe d’application<Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} maxLength={24} required disabled={busy} /></label>
        <Button className="justify-self-start" disabled={busy}>{busy ? "Veuillez patienter…" : "Vérifier et enregistrer"}</Button>
      </form>
      <ul className="mt-4 divide-y">
        {accounts.data.accounts.map(account => <li key={account.address} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <span className="break-all">{account.address}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void update(() => remove({ data: account.address }), "Boîte retirée.")}>Retirer</Button>
        </li>)}
      </ul>
    </>}
    {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
  </Panel>;
}

function Integrations() {
  const [q, setQ] = useState("");
  const f = q.toLowerCase();
  const load = useServerFn(listAccounts);
  const accounts = useQuery({ queryKey: ["provider-accounts"], queryFn: () => load(), retry: false });

  function statusFor(provider: string): Status {
    if (!accounts.data) return "unknown";
    const matching = accounts.data.filter(account => account.provider === provider);
    if (matching.some(account => account.status === "ok")) return "connected";
    return matching.some(account => account.status === "error") ? "error" : "off";
  }
  return (
    <div className="space-y-8">
      <Input placeholder="Rechercher une intégration…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      {INTEGRATIONS.map((g) => {
        const items = g.items.filter((i) => (i.name + i.desc).toLowerCase().includes(f));
        if (!items.length) return null;
        return (
          <section key={g.cat}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.cat}</h2>
            <div className="space-y-2">
              {items.map((i) => {
                const status = i.provider ? STATUS[statusFor(i.provider)] : null;
                return (
                <div key={i.name} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-bold">{i.name[0]}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={i.name}>{i.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{i.desc}</p>
                  </div>
                  {status && <Badge variant={status.variant}>{status.label}</Badge>}
                  {i.provider && <Button size="sm" variant="outline" asChild><Link to="/dashboard/providers">Gérer les comptes</Link></Button>}
                  {i.name === "Mail-Tester" && <Button size="sm" variant="outline" asChild><Link to="/dashboard/lab">Ouvrir le Lab</Link></Button>}
                </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function General() {
  const [zone, setZone] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const profile = useQuery({ queryKey: ["campaign-time-zone"], queryFn: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return campaignTimeZone(data.user?.user_metadata['campaign_time_zone'] ?? "UTC");
  } });

  async function saveZone() {
    setSaving(true);
    try {
      const timeZone = campaignTimeZone(zone ?? profile.data ?? "UTC");
      const { error } = await supabase.auth.updateUser({ data: { campaign_time_zone: timeZone } });
      if (error) throw error;
      await supabase.auth.refreshSession();
      await profile.refetch();
      setZone(null);
      setNotice(`Fuseau horaire enregistré (${timeZone}).`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Entreprise">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="campaign-time-zone">Fuseau horaire des campagnes</Label><Input id="campaign-time-zone" value={zone ?? profile.data ?? ""} onChange={e => setZone(e.target.value)} placeholder="Europe/Paris" /></div>
      </div>
      <Button className="mt-4" disabled={saving || zone === null} onClick={() => void saveZone()}>Enregistrer le fuseau horaire</Button>
      {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
    </Panel>
  );
}

function CampaignFrequency() {
  const read = useServerFn(readCampaignFrequencyPolicy);
  const save = useServerFn(setCampaignFrequencyPolicy);
  const policy = useQuery({ queryKey: ['campaign-frequency-policy'], queryFn: () => read(), retry: false });
  const [choice, setChoice] = useState<0 | 24 | 48 | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  if (policy.isPending || policy.error) return null;
  async function update() {
    if (choice === null) return;
    setSaving(true);
    try {
      await save({ data: choice });
      await policy.refetch();
      setChoice(null);
      setNotice('Plafond global enregistré.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }
  return <Panel title="Fréquence maximale des campagnes">
    {policy.data === null ? <p className="text-sm">Appliquez la migration 0046 pour activer ce réglage.</p> : <>
      <p className="mb-3 text-sm text-muted-foreground">La limite s’applique à une adresse même si elle est inscrite sur plusieurs listes. Le prochain message est différé dès qu’un envoi a été autorisé dans la fenêtre choisie.</p>
      <label className="block text-sm">Intervalle minimum entre deux envois
        <select className="ml-2 rounded border bg-background px-2 py-1" value={choice ?? policy.data} disabled={saving} onChange={event => {
          setNotice('');
          setChoice(event.target.value === '48' ? 48 : event.target.value === '24' ? 24 : 0);
        }}>
          <option value={0}>Désactivé</option>
          <option value={24}>24 heures</option>
          <option value={48}>48 heures</option>
        </select>
      </label>
      <Button className="mt-3" size="sm" disabled={saving || choice === null || choice === policy.data} onClick={() => void update()}>Enregistrer le plafond</Button>
      {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
    </>}
  </Panel>;
}

function Security() {
  return <Panel title="Sécurité">
    <p className="mb-3 text-sm text-muted-foreground">Les rôles et les accès des collaborateurs se gèrent dans l’espace Équipe.</p>
    <Button variant="outline" asChild><Link to="/dashboard/team">Gérer l’équipe et les accès</Link></Button>
  </Panel>;
}

function Notifications() {
  return <Panel title="Notifications">
    <p className="mb-3 text-sm text-muted-foreground">Consultez les alertes d’envoi enregistrées et gérez les destinations webhook.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" asChild><Link to="/dashboard/shield">Voir les alertes</Link></Button>
      <Button variant="outline" asChild><Link to="/dashboard/webhooks">Gérer les webhooks</Link></Button>
    </div>
  </Panel>;
}

function Billing() {
  return <Panel title="Finances">
    <p className="mb-3 text-sm text-muted-foreground">Consultez les revenus, dépenses et paiements enregistrés.</p>
    <Button variant="outline" asChild><Link to="/dashboard/finance">Ouvrir le journal financier</Link></Button>
  </Panel>;
}
