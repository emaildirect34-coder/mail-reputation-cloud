import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useId, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Code2, Eye, FileText, FlaskConical, FolderOpen, Globe2, Mail, Monitor, Save, Server, Settings2, ShieldCheck, Smartphone, Target, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/dashboard/campaigns")({
  head: () => ({ meta: [
    { title: "Nouvelle campagne — Email Direct" },
    { name: "description", content: "Préparez votre campagne : offre sponsor, audience, message, contenu et paramètres de livraison." },
    { property: "og:title", content: "Nouvelle campagne — Email Direct" },
    { property: "og:description", content: "Un parcours de création de campagne en cinq étapes avec aperçu et récapitulatif." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Builder,
});

const steps = [
  { label: "Offre & audience", icon: Target }, { label: "Expéditeur & objet", icon: Mail },
  { label: "Contenu & aperçu", icon: Code2 }, { label: "Livraison", icon: Server },
  { label: "Vérification", icon: ShieldCheck },
];
const initial = {
  name: "", offer: "", audience: "", geo: "France", schedule: "", fromName: "Email Direct", fromEmail: "", replyTo: "", subject: "", returnPath: "",
  body: '<!DOCTYPE html>\n<html lang="fr">\n<body>\n  <h1>Bonjour {first_name},</h1>\n  <p>Découvrez notre nouvelle offre.</p>\n  <p><a href="{offer_url}">Découvrir l’offre</a></p>\n  <p><a href="{unsubscribe_url}">Se désabonner</a></p>\n</body>\n</html>',
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <div className="min-w-0 space-y-2"><label htmlFor={id} className="block text-sm font-semibold" id={`${id}-label`}>{label}</label><div aria-labelledby={`${id}-label`}>{children}</div></div>;
}
function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="space-y-5"><h2 className="flex items-center gap-2 text-lg font-bold text-primary">{icon}{title}</h2>{children}</section>;
}
function Advanced({ children }: { children: ReactNode }) {
  return <details className="border-t border-border pt-5"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-primary"><Settings2 className="size-4" />Réglages avancés<ChevronDown className="ml-auto size-4" /></summary><div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div></details>;
}

function Builder() {
  const [step, setStep] = useState(0);
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
  const completed = [Boolean(draft.name && draft.offer && draft.audience), Boolean(draft.fromName && draft.fromEmail && draft.subject), Boolean(draft.body), chosen.length > 0, checked];
  const progress = completed.filter(Boolean).length;
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
  const checks = [
    { label: "Offre et audience", ok: completed[0], detail: "Nom, offre sponsor et audience renseignés", to: 0 },
    { label: "Expéditeur et objet", ok: Boolean(draft.fromName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.fromEmail) && draft.subject), detail: "Nom, adresse email et objet renseignés", to: 1 },
    { label: "Contenu du message", ok: completed[2], detail: "Contenu HTML renseigné", to: 2 },
    { label: "Serveurs sélectionnés", ok: completed[3], detail: `${chosen.length} serveur(s) sélectionné(s)`, to: 3 },
  ];

  return <div className="space-y-6 pb-4">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div className="space-y-2"><nav className="flex items-center gap-2 text-xs text-muted-foreground"><Link to="/dashboard" className="hover:text-primary">Dashboard</Link><span>/</span><span>Campagnes</span></nav><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary"><Mail className="size-6" /></span><h1 className="font-display text-2xl font-bold text-primary">Nouvelle campagne</h1></div><p className="text-sm text-muted-foreground">{draft.name || "Brouillon sans titre"}<span className="mx-2">·</span>{saved ? "Enregistré sur cet appareil" : "Non enregistré"}</p></div>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={!hasDraft} onClick={restore}><FolderOpen />Reprendre</Button><Button variant="outline" onClick={save}><Save />Enregistrer le brouillon</Button></div>
    </header>

    <nav aria-label="Étapes de création" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {steps.map((s, index) => <Button key={s.label} variant={step === index ? "default" : "outline"} onClick={() => setStep(index)} aria-current={step === index ? "step" : undefined} className="h-auto min-h-14 justify-start whitespace-normal px-3 py-3 text-left"><span className={`grid size-7 shrink-0 place-items-center rounded-full ${step === index ? "bg-primary-foreground/15" : "bg-muted text-primary"}`}>{completed[index] ? <Check className="size-4" /> : index + 1}</span><span className="text-xs font-semibold">{s.label}</span></Button>)}
    </nav>

    <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-4"><div><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Étape {step + 1} / 5</p><h2 className="font-display text-xl font-bold">{steps[step]?.label}</h2></div><span className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">Brouillon</span></div>

        {step === 0 && <div className="space-y-7">
          <Section title="Votre campagne" icon={<FileText className="size-5" />}><div className="grid gap-5 sm:grid-cols-2">{input("name", "Nom de la campagne", "Ex. Assurance auto — Novembre")}{input("schedule", "Date d’envoi (optionnelle)", "", "datetime-local")}</div></Section>
          <Section title="Offre sponsor" icon={<Target className="size-5" />}><div className="grid gap-5 sm:grid-cols-2">{select("offer", "Offre", ["", "Assurance Auto Économique", "Énergie Verte Maison", "Crédit Conso Express", "Mutuelle Santé Senior"])}{select("geo", "Pays ciblé", ["France", "Belgique", "Luxembourg", "Suisse"])}</div><Button variant="link" asChild className="h-auto p-0"><Link to="/dashboard/templates">Consulter les offres sponsors<ArrowRight /></Link></Button></Section>
          <Section title="Audience" icon={<Globe2 className="size-5" />}><div className="grid gap-5 sm:grid-cols-2">{select("audience", "Liste de contacts", ["", "Contacts engagés — 30 jours", "Contacts engagés — 90 jours", "Audience de test"])}<div className="flex items-center justify-between gap-3 self-end border-b border-border py-3"><label htmlFor="bot-protection" className="text-sm font-semibold">Protection contre les clics de bots</label><Switch id="bot-protection" checked={botProtection} onCheckedChange={value => { setBotProtection(value); setSaved(false); }} /></div></div></Section>
          <p className="text-xs text-muted-foreground">Offres et listes de démonstration · Aucun contact chargé.</p>
        </div>}

        {step === 1 && <div className="space-y-7"><Section title="Identité de l’expéditeur" icon={<Mail className="size-5" />}><div className="grid gap-5 sm:grid-cols-2">{input("fromName", "Nom de l’expéditeur")}{input("fromEmail", "Email de l’expéditeur", "contact@votre-domaine.fr", "email")}{input("replyTo", "Adresse de réponse (optionnelle)", "reponse@votre-domaine.fr", "email")}{input("subject", "Objet du message", "Découvrez votre offre")}</div></Section><Advanced>{input("returnPath", "Return-Path", "bounce@votre-domaine.fr")}{select("contentType", "Type de contenu", ["Multipart", "Text/Html", "Text/Plain"])}{select("charset", "Jeu de caractères", ["UTF-8", "ISO-8859-1"])}{select("encoding", "Encodage", ["Quoted-Printable", "Base64", "8Bit Encoding"])}{select("processing", "Traitement des en-têtes", ["Default Process", "Strip topology"])}<div className="sm:col-span-2">{text("header", "En-têtes personnalisés", true)}</div></Advanced></div>}

        {step === 2 && <div className="space-y-6"><div className="grid gap-5 2xl:grid-cols-2"><section className="min-w-0 space-y-3"><div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold"><Code2 className="size-4 text-primary" />Contenu HTML</h3><label className="cursor-pointer text-primary"><span className="inline-flex items-center gap-1 text-xs font-semibold"><Upload className="size-4" />Importer</span><input type="file" accept=".html,.htm,text/html" className="sr-only" aria-label="Importer HTML" onChange={async e => { const file = e.target.files?.[0]; if (file) { update("body", await file.text()); toast.success("Contenu HTML importé."); } e.target.value = ""; }} /></label></div><Textarea aria-label="Contenu HTML" value={draft.body} onChange={e => update("body", e.target.value)} className="h-[380px] bg-card font-mono text-xs leading-6" /></section><section className="min-w-0 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-bold"><Eye className="size-4 text-primary" />Aperçu du message</h3><div className="flex gap-1"><Button size="icon" variant={mobilePreview ? "ghost" : "secondary"} aria-label="Aperçu ordinateur" title="Ordinateur" onClick={() => setMobilePreview(false)}><Monitor /></Button><Button size="icon" variant={mobilePreview ? "secondary" : "ghost"} aria-label="Aperçu mobile" title="Mobile" onClick={() => setMobilePreview(true)}><Smartphone /></Button></div></div><div className="h-[380px] overflow-auto rounded-md border border-border bg-muted p-2"><iframe title="Aperçu de l’email" sandbox="" srcDoc={draft.body} className={`mx-auto h-full border-0 bg-card ${mobilePreview ? "w-full max-w-[320px]" : "w-full"}`} /></div></section></div><Advanced><div className="sm:col-span-2">{text("plain", "Version texte")}</div>{input("rotation", "Rotation du corps", "", "number")}{input("tracking", "Domaine de tracking", "track.votre-domaine.fr")}{input("suffix", "Suffixe URL")}{select("images", "Mode des images", ["CDN", "Pixel", "Base64"])}<div className="sm:col-span-2">{text("payload", "Payload (optionnel)")}</div><Field label="Fichier payload"><input type="file" aria-label="Fichier payload" className="w-full text-sm" onChange={async e => { const file = e.target.files?.[0]; if (file) update("payload", await file.text()); }} /></Field></Advanced></div>}

        {step === 3 && <div className="space-y-7"><Section title="Serveurs de livraison" icon={<Server className="size-5" />}><div className="grid gap-3 sm:grid-cols-2">{serverOptions.map(s => <label key={s} className={`flex cursor-pointer items-center gap-3 rounded-md border p-4 ${chosen.includes(s) ? "border-primary bg-primary/5" : "border-border bg-card"}`}><input type="checkbox" aria-label={s} checked={chosen.includes(s)} onChange={e => { setChosen(prev => e.target.checked ? [...prev, s] : prev.filter(x => x !== s)); setChecked(false); setSaved(false); }} className="size-4 accent-primary" /><Server className="size-5 shrink-0 text-primary" /><span className="min-w-0 text-sm font-semibold">{s}</span></label>)}</div><p className="text-xs text-muted-foreground">Serveurs de démonstration · Aucune connexion au moteur d’envoi.</p></Section><Section title="Cadence d’envoi" icon={<Settings2 className="size-5" />}><div className="grid gap-5 sm:grid-cols-2">{select("method", "Méthode d’envoi", ["Leaky bucket", "Queue (x/time)", "Burst"])}{input("speed", "Messages par intervalle", "", "number")}{select("unit", "Intervalle", ["Minute", "Heure"])}{input("batch", "Taille du lot", "", "number")}</div></Section><Advanced>{select("interface", "Interface VMTA / SMTP", ["Automatique", "VMTA principal", "SMTP externe"])}{select("protocol", "Protocole", ["Tous", "IPv4", "IPv6", "SMTP"])}{input("ipRotation", "Changer d’IP après (messages)", "", "number")}{input("pause", "Pause entre les lots", "", "number")}{select("pauseUnit", "Unité de pause", ["Seconde", "Minute"])}{select("autoReply", "Auto-réponse", ["Désactivée", "Activée"])}{select("randomReply", "Réponse aléatoire", ["Désactivée", "Activée"])}{input("replyRotation", "Rotation des réponses", "", "number")}<div className="sm:col-span-2">{text("accounts", "Comptes de réponse")}</div></Advanced></div>}

        {step === 4 && <div className="space-y-6"><Section title="Contrôles de configuration" icon={<ShieldCheck className="size-5" />}><div className="divide-y divide-border">{checks.map(c => <div key={c.label} className="flex items-center gap-3 py-4"><span className={`grid size-8 shrink-0 place-items-center rounded-full ${checked && c.ok ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{checked && c.ok ? <CheckCircle2 className="size-4" /> : <FileText className="size-4" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{c.label}</p><p className="text-xs text-muted-foreground">{checked ? c.ok ? c.detail : "À compléter" : "Non vérifié"}</p></div><Button variant="ghost" size="sm" onClick={() => setStep(c.to)}>Modifier</Button></div>)}</div><Button onClick={() => setChecked(true)} variant="outline"><FlaskConical />Vérifier la configuration</Button><p className="text-xs text-muted-foreground">Contrôles locaux uniquement. Authentification DNS, placement inbox et envoi non testés.</p></Section><Section title="Mode test" icon={<FlaskConical className="size-5" />}><div className="flex items-center justify-between border-b border-border pb-4"><label htmlFor="test-mode" className="text-sm font-semibold">Mode test activé</label><Switch id="test-mode" checked={testMode} onCheckedChange={value => { setTestMode(value); setSaved(false); }} /></div>{text("tests", "Adresses de test")}<Advanced>{input("testPeriod", "Intervalle des injections de test", "", "number")}{input("testRotation", "Rotation des tests", "", "number")}</Advanced></Section><div className="flex items-start gap-3 border-t border-border pt-5 text-sm text-muted-foreground"><ShieldCheck className="size-5 shrink-0 text-primary" /><p>Envoi indisponible : les offres, audiences et serveurs ne sont pas encore connectés.</p></div></div>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"><Button variant="outline" disabled={step === 0} onClick={() => setStep(prev => prev - 1)}><ArrowLeft />Précédent</Button>{step < 4 ? <div className="flex flex-wrap items-center gap-3">{!completed[step] && <p className="text-xs text-muted-foreground">Complétez cette étape pour continuer.</p>}<Button disabled={!completed[step]} onClick={() => setStep(prev => prev + 1)}>Continuer<ArrowRight /></Button></div> : <Button onClick={save}><Save />Enregistrer le brouillon</Button>}</div>
      </div>

      <aside className="space-y-5 border-t border-border pt-5 xl:sticky xl:top-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0" aria-label="Récapitulatif de la campagne"><h2 className="flex items-center gap-2 text-base font-bold text-primary"><FileText className="size-4" />Récapitulatif</h2><div><div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">Préparation</span><strong>{progress} / 5</strong></div><progress aria-label="Progression de la campagne" max={5} value={progress} className="h-1.5 w-full accent-primary" /></div><dl className="space-y-4">{[["Campagne", draft.name], ["Offre sponsor", draft.offer], ["Audience", draft.audience], ["Pays", draft.geo], ["Expéditeur", draft.fromEmail], ["Objet", draft.subject], ["Livraison", chosen.length ? `${chosen.length} serveur(s)` : ""], ["Planification", draft.schedule ? draft.schedule.replace("T", " à ") : "Non planifiée"]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 break-words text-sm ${value ? "font-semibold" : "text-muted-foreground"}`}>{value || "À renseigner"}</dd></div>)}</dl><div className="flex items-center gap-2 border-t border-border pt-4 text-xs font-semibold"><FlaskConical className="size-4 text-primary" />{testMode ? "Mode test" : "Mode production"}<span className="ml-auto text-muted-foreground">Aucun envoi</span></div><Button asChild variant="outline" className="w-full"><Link to="/dashboard/templates"><Target />Offres sponsors<ArrowRight /></Link></Button></aside>
    </div>
  </div>;
}
