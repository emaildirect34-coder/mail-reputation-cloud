import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, CheckCircle2, Code2, Eye, FileText, FlaskConical, FolderOpen, Globe2, Mail, Monitor, Play, Save, Server, Settings2, ShieldCheck, Smartphone, Target, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/dashboard/campaigns")({
  head: () => ({ meta: [
    { title: "Campaign Builder — Email Direct" },
    { name: "description", content: "Créez, testez et pilotez vos campagnes : offre sponsor, audience, structure email, contenu HTML et délivrabilité sur une seule page." },
    { property: "og:title", content: "Campaign Builder — Email Direct" },
    { property: "og:description", content: "Un constructeur de campagne en une page : offre, audience, message, aperçu et délivrabilité." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Builder,
});

const initial = {
  name: "", offer: "", audience: "", geo: "France", schedule: "", fromName: "Email Direct", fromEmail: "", replyTo: "", subject: "", returnPath: "",
  body: '<!DOCTYPE html>\n<html lang="fr">\n<body style="font-family: Arial, sans-serif;">\n  <h1>Bonjour {first_name},</h1>\n  <p>Découvrez notre nouvelle offre.</p>\n  <p><a href="{offer_url}">Découvrir l’offre</a></p>\n  <p><a href="{unsubscribe_url}">Se désabonner</a></p>\n</body>\n</html>',
  plain: "", header: "Date: {smtp_date}\nMessage-ID: <{n,15}@{domain}>\nTo: {to}\nFrom: {from_email}\nSubject: {subject}",
  contentType: "Multipart", charset: "UTF-8", encoding: "Quoted-Printable", processing: "Default Process",
  payload: "", tracking: "", suffix: "", images: "CDN", rotation: "1", tests: "", testPeriod: "1000", testRotation: "1",
  method: "Leaky bucket", speed: "100", unit: "Minute", batch: "100", pause: "1", pauseUnit: "Seconde", ipRotation: "1",
  interface: "Automatique", protocol: "Tous", autoReply: "Désactivée", randomReply: "Désactivée", replyRotation: "1", accounts: "",
};
type Draft = typeof initial;
const storageKey = "email-direct-campaign-draft";
const serverOptions = ["SERV001 — Principal", "SERV002 — Warmup", "SERV003 — Test Inbox", "SERV004 — Secondaire"];
const selectClass = "h-10 w-full min-w-0 rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const tabs = [
  { id: "offre", label: "Offre & Ciblage", icon: Target },
  { id: "structure", label: "Structure Email", icon: Mail },
  { id: "contenu", label: "Contenu & HTML", icon: Code2 },
  { id: "delivrabilité", label: "Délivrabilité", icon: Server },
  { id: "preflight", label: "Tests & Préflight", icon: FlaskConical },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <div className="min-w-0 space-y-2"><label htmlFor={id} className="block text-sm font-semibold" id={`${id}-label`}>{label}</label><div aria-labelledby={`${id}-label`}>{children}</div></div>;
}
function Card({ id, title, icon, children, action }: { id?: string; title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="flex items-center gap-2 font-semibold text-primary">{icon}{title}</h2>
        {action}
      </header>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}
function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-primary">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function Builder() {
  const [draft, setDraft] = useState<Draft>(initial);
  const [chosen, setChosen] = useState<string[]>([]);
  const [testMode, setTestMode] = useState(true);
  const [botProtection, setBotProtection] = useState(true);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => { setHasDraft(Boolean(localStorage.getItem(storageKey))); }, []);
  const update = (key: keyof Draft, value: string) => { setDraft(prev => ({ ...prev, [key]: value })); setChecked(false); setSaved(false); };
  const input = (key: keyof Draft, label: string, placeholder = "", type = "text") => <Field label={label}><Input aria-label={label} type={type} value={draft[key]} onChange={e => update(key, e.target.value)} placeholder={placeholder} className="h-10 bg-card" /></Field>;
  const select = (key: keyof Draft, label: string, options: string[]) => <Field label={label}><select aria-label={label} value={draft[key]} onChange={e => update(key, e.target.value)} className={selectClass}>{options.map(option => <option key={option} value={option}>{option || "Sélectionner…"}</option>)}</select></Field>;
  const text = (key: keyof Draft, label: string, code = false) => <Field label={label}><Textarea aria-label={label} value={draft[key]} onChange={e => update(key, e.target.value)} className={`bg-card ${code ? "min-h-40 font-mono text-xs" : "min-h-24"}`} /></Field>;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.fromEmail);
  const checks = [
    { label: "Offre & audience", ok: Boolean(draft.name && draft.offer && draft.audience) },
    { label: "Expéditeur & objet", ok: Boolean(draft.fromName && emailOk && draft.subject) },
    { label: "Contenu HTML", ok: Boolean(draft.body) },
    { label: "Serveurs", ok: chosen.length > 0 },
  ];
  const progress = checks.filter(c => c.ok).length;
  const ready = progress === checks.length;
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify({ draft, chosen, testMode, botProtection })); setHasDraft(true); setSaved(true); toast.success("Brouillon enregistré dans ce navigateur."); }
    catch { toast.error("Le navigateur n’a pas pu enregistrer ce brouillon."); }
  };
  const restore = () => {
    try {
      const raw = localStorage.getItem(storageKey); if (!raw) return;
      const data = JSON.parse(raw);
      if (!data.draft || typeof data.draft !== "object") throw new Error("Invalid draft");
      setDraft({ ...initial, ...Object.fromEntries(Object.entries(data.draft).filter(([key, value]) => key in initial && typeof value === "string")) });
      setChosen(Array.isArray(data.chosen) ? data.chosen.filter((s: unknown) => typeof s === "string" && serverOptions.includes(s)) : []);
      setTestMode(data.testMode !== false); setBotProtection(data.botProtection !== false); setChecked(false); setSaved(true); toast.success("Brouillon restauré.");
    } catch { toast.error("Ce brouillon ne peut pas être restauré."); }
  };
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return <div className="space-y-6 pb-4">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground"><Link to="/dashboard" className="hover:text-primary">Dashboard</Link><span>/</span><span>Campagnes</span></nav>
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary"><Mail className="size-6" /></span><div><h1 className="font-display text-2xl font-bold text-primary">Campaign Builder</h1><p className="text-sm text-muted-foreground">Créez, testez et pilotez vos campagnes avec une précision maximale</p></div></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="test-mode" className="flex items-center gap-2 text-sm font-semibold">Mode Test<Switch id="test-mode" checked={testMode} onCheckedChange={value => { setTestMode(value); setSaved(false); }} /></label>
        <Button variant="outline" disabled={!hasDraft} onClick={restore}><FolderOpen />Reprendre</Button>
        <Button variant="outline" onClick={save}><Save />Enregistrer</Button>
      </div>
    </header>

    <div className={`flex items-center gap-3 rounded-lg border p-4 ${ready ? "border-success/40 bg-success/10" : "border-border bg-muted/40"}`}>
      <ShieldCheck className={`size-6 shrink-0 ${ready ? "text-success" : "text-muted-foreground"}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{ready ? "Validation préflight active — Campagne prête pour envoi" : `Préparation en cours — ${progress} / ${checks.length} sections complètes`}</p>
        <p className="text-xs text-muted-foreground">{ready ? "Toutes les sections obligatoires sont renseignées." : "Complétez l’offre, l’audience, l’expéditeur, le contenu et les serveurs."}</p>
      </div>
      <span className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">{saved ? "Enregistré" : "Brouillon"}</span>
    </div>

    <nav aria-label="Sections du constructeur" className="flex flex-wrap gap-2">
      {tabs.map(t => <Button key={t.id} variant="outline" size="sm" onClick={() => scrollTo(t.id)} className="gap-2"><t.icon className="size-4" />{t.label}</Button>)}
    </nav>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Kpi label="Délivrabilité estimée" value="99.8%" sub="+0.2% vs dernière campagne" />
      <Kpi label="Serveurs actifs" value="12" sub="100% opérationnels" />
      <Kpi label="Interfaces sélectionnées" value={String(chosen.length)} sub="VMTA / SMTP" />
      <Kpi label="Tests validés" value={`${progress}/${checks.length}`} sub={checked ? "Préflight vérifié" : "Préflight non lancé"} />
      <Kpi label="Sécurité tracking" value="100%" sub="Liens protégés & traçage sécurisé" />
    </div>

    <div className="grid items-start gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Card id="offre" title="Offre & Ciblage" icon={<Target className="size-5" />}>
          <div className="grid gap-5 sm:grid-cols-2">
            {input("name", "Nom de la campagne", "Ex. Assurance auto — Novembre")}
            {input("schedule", "Planifier le (optionnel)", "", "datetime-local")}
            {select("offer", "Sélectionner l’offre", ["", "Assurance Auto Économique", "Énergie Verte Maison", "Crédit Conso Express", "Mutuelle Santé Senior"])}
            {select("geo", "Pays ciblé", ["France", "Belgique", "Luxembourg", "Suisse"])}
          </div>
          <Button variant="link" asChild className="h-auto p-0"><Link to="/dashboard/templates">Consulter les offres sponsors</Link></Button>
          <div className="border-t border-border pt-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><Users className="size-4 text-primary" />Audience</h3>
            <div className="grid gap-5 sm:grid-cols-2">
              {select("audience", "Liste de contacts", ["", "Contacts engagés — 30 jours", "Contacts engagés — 90 jours", "Audience de test"])}
              <div className="flex items-center justify-between gap-3 self-end border-b border-border py-3">
                <label htmlFor="bot-protection" className="text-sm font-semibold">Protection contre les clics de bots</label>
                <Switch id="bot-protection" checked={botProtection} onCheckedChange={value => { setBotProtection(value); setSaved(false); }} />
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Offres et listes de démonstration · Aucun contact chargé.</p>
          </div>
        </Card>

        <Card id="structure" title="Structure Email" icon={<Mail className="size-5" />}>
          <div className="grid gap-5 sm:grid-cols-2">
            {input("fromName", "From Name")}
            {input("fromEmail", "From Email", "contact@votre-domaine.fr", "email")}
            {input("replyTo", "Reply To (optionnel)", "reponse@votre-domaine.fr", "email")}
            {input("subject", "Objet du message", "Découvrez votre offre")}
            {input("returnPath", "Return Path", "bounce@votre-domaine.fr")}
            {select("contentType", "Content Type", ["Multipart", "Text/Html", "Text/Plain"])}
            {select("charset", "Charset", ["UTF-8", "ISO-8859-1"])}
            {select("encoding", "C.T Encoding", ["Quoted-Printable", "Base64", "8Bit Encoding"])}
            {select("processing", "Header Processing", ["Default Process", "Strip topology"])}
          </div>
          <div className="border-t border-border pt-5">{text("header", "En-tête Email (Header)", true)}</div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card id="contenu" title="Corps de l’Email (HTML)" icon={<Code2 className="size-5" />} action={<label className="cursor-pointer text-primary"><span className="inline-flex items-center gap-1 text-xs font-semibold"><Upload className="size-4" />Importer</span><input type="file" accept=".html,.htm,text/html" className="sr-only" aria-label="Importer HTML" onChange={async e => { const file = e.target.files?.[0]; if (file) { update("body", await file.text()); toast.success("Contenu HTML importé."); } e.target.value = ""; }} /></label>}>
          <Textarea aria-label="Contenu HTML" value={draft.body} onChange={e => update("body", e.target.value)} className="h-[300px] bg-card font-mono text-xs leading-6" />
          <div className="grid gap-5 sm:grid-cols-2">
            {input("rotation", "Rotation du corps", "", "number")}
            {input("tracking", "Domaine de tracking", "track.votre-domaine.fr")}
            {input("suffix", "Suffixe URL")}
            {select("images", "Mode des images", ["CDN", "Pixel", "Base64"])}
          </div>
          <div className="border-t border-border pt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold"><Eye className="size-4 text-primary" />Aperçu HTML</h3>
              <div className="flex gap-1">
                <Button size="icon" variant={mobilePreview ? "ghost" : "secondary"} aria-label="Aperçu ordinateur" title="Ordinateur" onClick={() => setMobilePreview(false)}><Monitor /></Button>
                <Button size="icon" variant={mobilePreview ? "secondary" : "ghost"} aria-label="Aperçu mobile" title="Mobile" onClick={() => setMobilePreview(true)}><Smartphone /></Button>
              </div>
            </div>
            <div className="h-[260px] overflow-auto rounded-md border border-border bg-muted p-2">
              <iframe title="Aperçu de l’email" sandbox="" srcDoc={draft.body} className={`mx-auto h-full border-0 bg-card ${mobilePreview ? "w-full max-w-[320px]" : "w-full"}`} />
            </div>
          </div>
          <details className="border-t border-border pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-primary"><Settings2 className="size-4" />Body Config avancée</summary>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">{text("plain", "Version texte")}</div>
              <div className="sm:col-span-2">{text("payload", "Payload (optionnel)")}</div>
              <Field label="Fichier payload"><input type="file" aria-label="Fichier payload" className="w-full text-sm" onChange={async e => { const file = e.target.files?.[0]; if (file) update("payload", await file.text()); }} /></Field>
            </div>
          </details>
        </Card>

        <Card id="delivrabilité" title="Délivrabilité" icon={<Server className="size-5" />}>
          <div>
            <h3 className="mb-3 text-sm font-bold">Serveurs de livraison</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {serverOptions.map(s => <label key={s} className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 ${chosen.includes(s) ? "border-primary bg-primary/5" : "border-border bg-card"}`}><input type="checkbox" aria-label={s} checked={chosen.includes(s)} onChange={e => { setChosen(prev => e.target.checked ? [...prev, s] : prev.filter(x => x !== s)); setChecked(false); setSaved(false); }} className="size-4 accent-primary" /><Server className="size-4 shrink-0 text-primary" /><span className="min-w-0 text-sm font-semibold">{s}</span></label>)}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Serveurs de démonstration · Aucune connexion au moteur d’envoi.</p>
          </div>
          <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
            {select("method", "Script d’envoi", ["Leaky bucket", "Queue (x/time)", "Burst"])}
            {input("speed", "Vitesse d’envoi (emails)", "", "number")}
            {select("unit", "Intervalle", ["Minute", "Heure"])}
            {input("batch", "Batch (emails par livraison)", "", "number")}
            {input("pause", "Pause avant le prochain envoi", "", "number")}
            {select("pauseUnit", "Unité de pause", ["Seconde", "Minute"])}
            {input("ipRotation", "Changer d’interface (IP) après", "", "number")}
            {select("interface", "Interface VMTA / SMTP", ["Automatique", "VMTA principal", "SMTP externe"])}
            {select("protocol", "Protocole", ["Tous", "IPv4", "IPv6", "SMTP"])}
          </div>
          <div className="border-t border-border pt-5">
            <h3 className="mb-4 text-sm font-bold">Auto-Réponse</h3>
            <div className="grid gap-5 sm:grid-cols-2">
              {select("autoReply", "Statut", ["Désactivée", "Activée"])}
              {select("randomReply", "Aléatoire", ["Désactivée", "Activée"])}
              {input("replyRotation", "Rotation", "", "number")}
              <div className="sm:col-span-2">{text("accounts", "Comptes email (auto-réponse)")}</div>
            </div>
          </div>
        </Card>
      </div>
    </div>

    <Card id="preflight" title="Résultats des tests & Préflight" icon={<FlaskConical className="size-5" />} action={<Button onClick={() => { setChecked(true); toast.success("Préflight vérifié localement."); }}><Play />Lancer les tests</Button>}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {checks.map(c => (
          <div key={c.label} className={`flex items-center gap-3 rounded-md border p-3 ${checked && c.ok ? "border-success/40 bg-success/10" : "border-border"}`}>
            <span className={`grid size-8 shrink-0 place-items-center rounded-full ${checked && c.ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{checked && c.ok ? <CheckCircle2 className="size-4" /> : <FileText className="size-4" />}</span>
            <div className="min-w-0"><p className="text-sm font-semibold">{c.label}</p><p className="text-xs text-muted-foreground">{checked ? (c.ok ? "Validé" : "À compléter") : "Non vérifié"}</p></div>
          </div>
        ))}
      </div>
      <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
        {text("tests", "Adresses de test")}
        <div className="grid gap-5 sm:grid-cols-2">
          {input("testPeriod", "Période de test", "", "number")}
          {input("testRotation", "Rotation des tests", "", "number")}
        </div>
      </div>
      <div className="flex items-start gap-3 border-t border-border pt-4 text-sm text-muted-foreground">
        <ShieldCheck className="size-5 shrink-0 text-primary" />
        <p>Contrôles locaux uniquement. Authentification DNS, placement inbox et envoi non testés — l’envoi sera disponible une fois les offres, audiences et serveurs connectés.</p>
      </div>
    </Card>
  </div>;
}
