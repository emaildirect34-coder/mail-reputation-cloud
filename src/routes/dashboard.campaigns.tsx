import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useId, useState, type ReactNode } from "react";
import { BadgeCheck, CheckCircle2, ChevronLeft, ChevronRight, Code2, Eye, Filter, FolderOpen, Gift, Mail, Monitor, Paperclip, Rocket, Save, Send, Server, Settings2, ShieldCheck, Smartphone, Upload, UserRound, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/dashboard/campaigns")({
  head: () => ({ meta: [
    { title: "Nouvelle campagne — Email Direct" },
    { name: "description", content: "Créez et configurez votre campagne sur une seule page : informations, contenu, destinataires, paramètres avancés et aperçu en direct." },
    { property: "og:title", content: "Nouvelle campagne — Email Direct" },
    { property: "og:description", content: "Un constructeur de campagne clair en une page avec aperçu et récapitulatif en direct." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Builder,
});

const initial = {
  name: "", type: "Marketing", offer: "", audience: "", geo: "France", schedule: "", fromName: "Email Direct", fromEmail: "", replyTo: "", subject: "", returnPath: "",
  body: '<!DOCTYPE html>\n<html lang="fr">\n<body style="font-family: Arial, sans-serif; padding:24px">\n  <h1>Bonjour {first_name},</h1>\n  <p>Découvrez notre nouvelle offre.</p>\n  <p><a href="{offer_url}">Découvrir l’offre</a></p>\n  <p><a href="{unsubscribe_url}">Se désabonner</a></p>\n</body>\n</html>',
  plain: "", header: "Date: {smtp_date}\nMessage-ID: <{n,15}@{domain}>\nTo: {to}\nFrom: {from_email}\nSubject: {subject}",
  contentType: "Multipart", charset: "UTF-8", encoding: "Quoted-Printable", processing: "Default Process",
  payload: "", tracking: "", suffix: "", images: "CDN", rotation: "1", tests: "", testPeriod: "1000", testRotation: "1",
  method: "Leaky bucket", speed: "100", unit: "Minute", batch: "100", pause: "1", pauseUnit: "Seconde", ipRotation: "1",
  interface: "Automatique", protocol: "Tous", autoReply: "Désactivée", randomReply: "Désactivée", replyRotation: "1", accounts: "",
};
type Draft = typeof initial;
const storageKey = "email-direct-campaign-draft";
const serverOptions = ["SERV001 — Principal", "SERV002 — Warmup", "SERV003 — Test Inbox", "SERV004 — Secondaire"];
const selectClass = "h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const sections = [
  { id: "infos", label: "Informations générales" },
  { id: "contenu", label: "Contenu" },
  { id: "destinataires", label: "Destinataires" },
  { id: "avance", label: "Paramètres avancés" },
  { id: "recap", label: "Récapitulatif" },
];
const types = [
  { v: "Marketing", d: "Promotion, newsletter", icon: Mail },
  { v: "Transactionnelle", d: "2FA, notifications", icon: UserRound },
  { v: "Sponsor", d: "Offres partenaires, leads", icon: Gift },
];

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  return <div className="min-w-0 space-y-1.5"><label id={`${id}-l`} className="block text-[12.5px] font-semibold">{label}</label><div aria-labelledby={`${id}-l`}>{children}</div>{hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}</div>;
}
function Step({ id, n, title, desc, children, action }: { id: string; n: number; title: string; desc: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="card-lux scroll-mt-24 p-5">
      <header className="mb-5 flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground shadow-[0_6px_16px_-6px_var(--primary)]">{n}</span>
        <div className="min-w-0 flex-1"><h2 className="font-display text-[17px] font-bold text-primary">{title}</h2><p className="text-[12.5px] text-muted-foreground">{desc}</p></div>
        {action}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
function Side({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return <section className="card-lux p-4"><header className="mb-3 flex items-center gap-2"><span className="text-primary [&_svg]:size-5">{icon}</span><h2 className="font-display text-[15px] font-bold text-primary">{title}</h2>{action && <div className="ml-auto">{action}</div>}</header>{children}</section>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return <label htmlFor={id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-[13px] font-medium"><span>{label}</span><Switch id={id} checked={checked} onCheckedChange={onChange} /></label>;
}

function Builder() {
  const [draft, setDraft] = useState<Draft>(initial);
  const [chosen, setChosen] = useState<string[]>([]);
  const [testMode, setTestMode] = useState(true);
  const [opts, setOpts] = useState({ bot: true, plain: true, utm: true, unsub: true, ab: false, track: true });
  const [editor, setEditor] = useState<"html" | "text">("html");
  const [mobilePreview, setMobilePreview] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => { setHasDraft(Boolean(localStorage.getItem(storageKey))); }, []);
  const update = (key: keyof Draft, value: string) => { setDraft(p => ({ ...p, [key]: value })); setChecked(false); setSaved(false); };
  const opt = (k: keyof typeof opts) => (v: boolean) => { setOpts(p => ({ ...p, [k]: v })); setSaved(false); };
  const input = (key: keyof Draft, label: string, placeholder = "", type = "text", hint?: string) => <Field label={label} hint={hint}><Input aria-label={label} type={type} value={draft[key]} onChange={e => update(key, e.target.value)} placeholder={placeholder} className="h-10 rounded-lg bg-card" /></Field>;
  const select = (key: keyof Draft, label: string, options: string[]) => <Field label={label}><select aria-label={label} value={draft[key]} onChange={e => update(key, e.target.value)} className={selectClass}>{options.map(o => <option key={o} value={o}>{o || "Sélectionner…"}</option>)}</select></Field>;
  const text = (key: keyof Draft, label: string, code = false) => <Field label={label}><Textarea aria-label={label} value={draft[key]} onChange={e => update(key, e.target.value)} className={`rounded-lg bg-card ${code ? "min-h-32 font-mono text-xs" : "min-h-20"}`} /></Field>;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.fromEmail);
  const checks = [
    { id: "infos", label: "Informations générales", ok: Boolean(draft.name && emailOk && draft.subject) },
    { id: "contenu", label: "Contenu", ok: Boolean(draft.body.trim()) },
    { id: "destinataires", label: "Destinataires", ok: Boolean(draft.audience && draft.offer) },
    { id: "avance", label: "Paramètres avancés", ok: chosen.length > 0 },
  ];
  const progress = checks.filter(c => c.ok).length;
  const ready = progress === checks.length;
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify({ draft, chosen, testMode, opts })); setHasDraft(true); setSaved(true); toast.success("Brouillon enregistré dans ce navigateur."); }
    catch { toast.error("Le navigateur n’a pas pu enregistrer ce brouillon."); }
  };
  const restore = () => {
    try {
      const raw = localStorage.getItem(storageKey); if (!raw) return;
      const data = JSON.parse(raw);
      if (!data.draft || typeof data.draft !== "object") throw new Error("Invalid draft");
      setDraft({ ...initial, ...Object.fromEntries(Object.entries(data.draft).filter(([k, v]) => k in initial && typeof v === "string")) });
      setChosen(Array.isArray(data.chosen) ? data.chosen.filter((s: unknown) => typeof s === "string" && serverOptions.includes(s)) : []);
      if (data.opts && typeof data.opts === "object") setOpts(p => ({ ...p, ...Object.fromEntries(Object.entries(data.opts).filter(([k, v]) => k in p && typeof v === "boolean")) }));
      setTestMode(data.testMode !== false); setChecked(false); setSaved(true); toast.success("Brouillon restauré.");
    } catch { toast.error("Ce brouillon ne peut pas être restauré."); }
  };
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const launch = () => {
    setChecked(true);
    if (!ready) { toast.error("Complétez les sections marquées avant de lancer."); return; }
    toast.success(testMode ? "Préflight validé — campagne prête (mode test, rien n’a été envoyé)." : "Campagne prête. L’envoi réel sera disponible une fois les serveurs connectés.");
  };
  const summary: [string, string][] = [
    ["Type", draft.type], ["Nom", draft.name || "—"], ["Expéditeur", draft.fromEmail || "—"], ["Objet", draft.subject || "—"],
    ["Offre", draft.offer || "—"], ["Audience", draft.audience || "—"], ["Pays", draft.geo], ["Envoi", draft.schedule ? new Date(draft.schedule).toLocaleString("fr-FR") : "Immédiat"],
    ["Vitesse", `${draft.speed} / ${draft.unit.toLowerCase()}`], ["Serveurs", chosen.length ? `${chosen.length} sélectionné(s)` : "—"],
  ];

  return <div className="space-y-5 pb-4">
    {/* Header */}
    <section className="card-lux lux-hero relative overflow-hidden">
      <div className="flex flex-wrap items-stretch">
        <div className="flex flex-1 items-center gap-4 px-5 py-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><BadgeCheck className="size-7" /></span>
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[12px] text-muted-foreground"><ChevronLeft className="size-3" /><Link to="/dashboard" className="hover:text-primary">Campagnes</Link><ChevronRight className="size-3" /><span className="font-semibold text-primary">Nouvelle campagne</span></p>
            <h1 className="font-display text-[28px] font-extrabold leading-tight text-primary">Nouvelle campagne</h1>
            <p className="text-[13px] text-muted-foreground">Créez et configurez votre campagne en quelques sections, sur une seule page.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          <label htmlFor="test-mode" className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] font-semibold">Mode Test<Switch id="test-mode" checked={testMode} onCheckedChange={v => { setTestMode(v); setSaved(false); }} /></label>
          <Button variant="outline" size="sm" disabled={!hasDraft} onClick={restore}><FolderOpen />Reprendre</Button>
          <Button variant="outline" size="sm" onClick={save}><Save />{saved ? "Enregistré" : "Enregistrer"}</Button>
        </div>
        <div className="lux-banner hidden min-w-[300px] items-center gap-4 rounded-l-[2.5rem] px-7 py-4 lg:flex">
          <Send className="size-10 shrink-0 text-neon-green" />
          <div><p className="text-[15px] font-bold">Votre message, notre infrastructure</p><p className="text-[12px] font-semibold text-neon-green">Performance · Délivrabilité · Résultats</p></div>
        </div>
      </div>
    </section>

    {/* Section strip */}
    <nav aria-label="Sections de la campagne" className="card-lux flex items-center gap-1 overflow-x-auto p-2">
      {sections.map((s, i) => {
        const done = checks.find(c => c.id === s.id)?.ok;
        return <div key={s.id} className="flex shrink-0 items-center">
          <button type="button" onClick={() => scrollTo(s.id)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold transition hover:bg-primary/10">
            <span className={`grid size-7 place-items-center rounded-full text-xs font-bold ${done ? "bg-neon-green/20 text-neon-green" : "border border-primary/40 text-primary"}`}>{done ? <CheckCircle2 className="size-4" /> : i + 1}</span>
            {s.label}
          </button>
          {i < sections.length - 1 && <ChevronRight className="size-4 text-muted-foreground" />}
        </div>;
      })}
      <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-3 py-1 text-[12px] font-semibold text-primary">{progress} / {checks.length} complètes</span>
    </nav>

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Step id="infos" n={1} title="Informations générales" desc="Donnez un nom à votre campagne et configurez ses paramètres de base.">
          <div className="grid gap-5 lg:grid-cols-2">
            {input("name", "Nom de la campagne *", "Ex. Promotion Printemps", "text", `${draft.name.length}/100`)}
            <Field label="Type de campagne *">
              <div className="grid grid-cols-3 gap-2">
                {types.map(t => <button key={t.v} type="button" aria-pressed={draft.type === t.v} onClick={() => update("type", t.v)} className={`rounded-xl border p-2.5 text-left transition ${draft.type === t.v ? "border-primary bg-primary/10 shadow-[0_6px_16px_-10px_var(--primary)]" : "border-border bg-card hover:border-primary/40"}`}>
                  <t.icon className="mb-1 size-4 text-primary" /><p className="text-[12.5px] font-bold">{t.v}</p><p className="text-[10.5px] text-muted-foreground">{t.d}</p>
                </button>)}
              </div>
            </Field>
            {input("fromName", "Nom d’expéditeur")}
            {input("fromEmail", "Expéditeur (From) *", "contact@votre-domaine.fr", "email", "Le domaine doit être authentifié (SPF, DKIM, DMARC).")}
            {input("replyTo", "Répondre à (optionnel)", "reponse@votre-domaine.fr", "email")}
            {input("schedule", "Planifier l’envoi (optionnel)", "", "datetime-local")}
          </div>
          <div className="space-y-3">
            {input("subject", "Objet de l’email *", "Découvrez notre offre spéciale", "text", `${draft.subject.length}/150`)}
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-primary/5 px-4 py-3 text-[13px]"><Mail className="size-4 shrink-0 text-primary" /><span className="truncate">{draft.subject || "Prévisualisation de l’objet dans la boîte de réception"}</span></div>
          </div>
        </Step>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Step id="contenu" n={2} title="Contenu de l’email" desc="Rédigez ou importez votre HTML." action={<label className="cursor-pointer"><span className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[12px] font-semibold text-primary"><Upload className="size-3.5" />Importer</span><input type="file" accept=".html,.htm,text/html" className="sr-only" aria-label="Importer HTML" onChange={async e => { const f = e.target.files?.[0]; if (f) { update("body", await f.text()); toast.success("Contenu HTML importé."); } e.target.value = ""; }} /></label>}>
            <div className="flex gap-1 rounded-xl bg-muted p-1">
              {(["html", "text"] as const).map(m => <button key={m} type="button" onClick={() => setEditor(m)} className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${editor === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{m === "html" ? "Éditeur HTML" : "Version texte"}</button>)}
            </div>
            {editor === "html"
              ? <Textarea aria-label="Contenu HTML" value={draft.body} onChange={e => update("body", e.target.value)} className="h-[240px] rounded-lg bg-card font-mono text-xs leading-6" />
              : <Textarea aria-label="Version texte" value={draft.plain} onChange={e => update("plain", e.target.value)} placeholder="Version texte alternative" className="h-[240px] rounded-lg bg-card text-sm" />}
            <p className="flex justify-between text-[11.5px] text-muted-foreground"><span>Variables : {"{first_name}"}, {"{offer_url}"}, {"{unsubscribe_url}"}</span><span>{draft.body.length} caractères</span></p>
          </Step>
          <div className="space-y-5">
            <Side title="Pièces jointes" icon={<Paperclip />}>
              <label className="grid cursor-pointer place-items-center gap-1 rounded-xl border-2 border-dashed border-primary/30 p-5 text-center text-[12px] text-muted-foreground hover:bg-primary/5">
                <Upload className="size-5 text-primary" />Glissez ou cliquez<span className="text-[10.5px]">PDF, JPG, PNG, ZIP — max 10 Mo</span>
                <input type="file" className="sr-only" aria-label="Pièce jointe" onChange={e => { const f = e.target.files?.[0]; if (f) toast.success(`${f.name} ajouté.`); e.target.value = ""; }} />
              </label>
            </Side>
            <Side title="Optimisation" icon={<Zap />}>
              <div className="space-y-2">
                <Toggle label="Version texte alternative" checked={opts.plain} onChange={opt("plain")} />
                <Toggle label="Balise UTM de suivi" checked={opts.utm} onChange={opt("utm")} />
                <Toggle label="Désabonnement 1-clic (RFC 8058)" checked={opts.unsub} onChange={opt("unsub")} />
              </div>
            </Side>
          </div>
        </div>

        <Step id="destinataires" n={3} title="Destinataires" desc="Choisissez l’offre et ciblez votre audience." action={<Button variant="outline" size="sm" asChild><Link to="/dashboard/templates">Offres sponsors</Link></Button>}>
          <div className="grid gap-4 md:grid-cols-3">
            {select("offer", "Offre sponsor", ["", "Assurance Auto Économique", "Énergie Verte Maison", "Crédit Conso Express", "Mutuelle Santé Senior"])}
            {select("audience", "Liste de contacts", ["", "Contacts engagés — 30 jours", "Contacts engagés — 90 jours", "Audience de test"])}
            {select("geo", "Pays ciblé", ["France", "Belgique", "Luxembourg", "Suisse"])}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {[{ i: Users, t: "Liste de contacts", d: "Importer ou utiliser une liste existante" }, { i: Filter, t: "Segmentation", d: "Géolocalisation, comportement, FAI" }, { i: ShieldCheck, t: "Protection bots", d: "Filtre les clics automatisés" }].map(c => <div key={c.t} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><c.i className="size-4" /></span><div><p className="text-[13px] font-bold text-primary">{c.t}</p><p className="text-[11.5px] text-muted-foreground">{c.d}</p></div></div>)}
          </div>
          <Toggle label="Protection contre les clics de bots" checked={opts.bot} onChange={opt("bot")} />
          <p className="text-[11.5px] text-muted-foreground">Offres et listes de démonstration · aucun contact chargé.</p>
        </Step>

        <Step id="avance" n={4} title="Paramètres avancés" desc="Optimisez la délivrabilité et la performance.">
          <div>
            <h3 className="mb-2 text-[13px] font-bold">Serveurs de livraison *</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {serverOptions.map(s => <label key={s} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${chosen.includes(s) ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"}`}><input type="checkbox" aria-label={s} checked={chosen.includes(s)} onChange={e => { setChosen(p => e.target.checked ? [...p, s] : p.filter(x => x !== s)); setChecked(false); setSaved(false); }} className="size-4 accent-primary" /><Server className="size-4 text-primary" /><span className="text-[13px] font-semibold">{s}</span></label>)}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {select("method", "Script d’envoi", ["Leaky bucket", "Queue (x/time)", "Burst"])}
            {input("speed", "Vitesse (emails)", "", "number")}
            {select("unit", "Intervalle", ["Minute", "Heure"])}
            {input("batch", "Batch", "", "number")}
            {input("pause", "Pause", "", "number")}
            {select("pauseUnit", "Unité de pause", ["Seconde", "Minute"])}
            {select("interface", "Interface VMTA / SMTP", ["Automatique", "VMTA principal", "SMTP externe"])}
            {select("protocol", "Protocole", ["Tous", "IPv4", "IPv6", "SMTP"])}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="A/B Testing (2 variantes)" checked={opts.ab} onChange={opt("ab")} />
            <Toggle label="Tracking avancé (ouvertures & clics)" checked={opts.track} onChange={opt("track")} />
          </div>
          <details className="rounded-xl border border-border/60 p-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-primary"><Settings2 className="size-4" />En-têtes, encodage, tracking & auto-réponse</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {input("returnPath", "Return Path", "bounce@votre-domaine.fr")}
              {input("tracking", "Domaine de tracking", "track.votre-domaine.fr")}
              {select("contentType", "Content Type", ["Multipart", "Text/Html", "Text/Plain"])}
              {select("charset", "Charset", ["UTF-8", "ISO-8859-1"])}
              {select("encoding", "Encodage", ["Quoted-Printable", "Base64", "8Bit Encoding"])}
              {select("processing", "Traitement des en-têtes", ["Default Process", "Strip topology"])}
              {select("images", "Mode des images", ["CDN", "Pixel", "Base64"])}
              {input("ipRotation", "Changer d’IP après (envois)", "", "number")}
              <div className="sm:col-span-2">{text("header", "En-tête Email (Header)", true)}</div>
              {select("autoReply", "Auto-réponse", ["Désactivée", "Activée"])}
              {input("replyRotation", "Rotation auto-réponse", "", "number")}
              <div className="sm:col-span-2">{text("tests", "Adresses de test (une par ligne)")}</div>
            </div>
          </details>
        </Step>
      </div>

      {/* Right column */}
      <aside id="recap" className="scroll-mt-24 space-y-5 xl:sticky xl:top-4">
        <Side title="Aperçu de la campagne" icon={<Eye />} action={<div className="flex gap-1">
          <Button size="icon" variant={mobilePreview ? "ghost" : "secondary"} className="size-7" aria-label="Aperçu ordinateur" onClick={() => setMobilePreview(false)}><Monitor /></Button>
          <Button size="icon" variant={mobilePreview ? "secondary" : "ghost"} className="size-7" aria-label="Aperçu mobile" onClick={() => setMobilePreview(true)}><Smartphone /></Button>
        </div>}>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-muted">
            <div className="flex items-center gap-2 bg-primary px-3 py-2 text-[11.5px] font-semibold text-primary-foreground"><Send className="size-3.5" /><span className="truncate">{draft.subject || "Objet de l’email"}</span></div>
            <iframe title="Aperçu de l’email" sandbox="" srcDoc={draft.body} className={`mx-auto block h-[220px] border-0 bg-card ${mobilePreview ? "w-[240px]" : "w-full"}`} />
          </div>
        </Side>
        <Side title="Résumé de la campagne" icon={<Code2 />}>
          <dl className="divide-y divide-border/50 text-[12.5px]">
            {summary.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="truncate text-right font-semibold">{v}</dd></div>)}
          </dl>
        </Side>
        <Side title="Préflight" icon={<ShieldCheck />}>
          <ul className="space-y-1.5">
            {checks.map(c => <li key={c.id}><button type="button" onClick={() => scrollTo(c.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-primary/5">
              <CheckCircle2 className={`size-4 ${c.ok ? "text-neon-green" : checked ? "text-neon-red" : "text-muted-foreground"}`} /><span className="flex-1">{c.label}</span><span className="text-[11px] text-muted-foreground">{c.ok ? "OK" : "À compléter"}</span>
            </button></li>)}
          </ul>
        </Side>
        <Button onClick={launch} className="h-12 w-full rounded-xl text-[15px] font-bold shadow-[0_10px_24px_-10px_var(--primary)]"><Rocket />{testMode ? "Lancer le test" : "Lancer la campagne"}</Button>
        <div className={`flex items-start gap-3 rounded-xl border p-3 text-[12px] ${ready ? "border-neon-green/40 bg-neon-green/10" : "border-border bg-card"}`}>
          <CheckCircle2 className={`size-5 shrink-0 ${ready ? "text-neon-green" : "text-muted-foreground"}`} />
          <div><p className="font-bold">{ready ? "Infrastructure prête" : "Préparation en cours"}</p><p className="text-muted-foreground">{ready ? "Contrôles locaux validés. Aucun envoi réel tant que les serveurs ne sont pas connectés." : "Complétez les sections pour activer le lancement."}</p></div>
        </div>
      </aside>
    </div>
  </div>;
}
