import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Ban, BadgeCheck, Braces, CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleHelp, Code2, FileCode2, FlaskConical, Folder, Gauge, Globe2, Pointer, Image, Link2, Mail, MapPin, Network, Palette, Play, RefreshCw, Reply, Rocket, Save, Search, Send, Server, ShieldCheck, Tag, Target, Trash2, TrendingUp, Upload, Users, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Kpi } from "@/components/dash/lux";
import { CampaignTabs } from "@/components/dash/campaign-tabs";

export const Route = createFileRoute("/dashboard/campaigns_/new")({
  head: () => ({ meta: [
    { title: "Campaign Builder — Email Direct" },
    { name: "description", content: "Créez, testez et pilotez vos campagnes : offre, structure email, corps HTML, délivrabilité et préflight sur une seule page." },
    { property: "og:title", content: "Campaign Builder — Email Direct" },
    { property: "og:description", content: "Constructeur de campagne en 4 colonnes avec aperçu live et préflight." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Builder,
});

const initial = {
  name: "__NO_NAME__", schedule: "", offer: "", geo: "Tous les pays (par défaut)", sendTests: "Oui", testPeriod: "1000", tests: "mail.cortexapp@gmail.com", testRotation: "1", clickProtect: "Activée",
  returnPath: "contact@domain.com", fromName: "Email Direct", fromEmail: "contact@domain.com", replyTo: "reply@domain.com", subject: "{subject} - Offre spéciale",
  contentType: "Text/Html", charset: "UTF-8", encoding: "8Bit Encoding", processing: "Default Process",
  header: "Date: {smtp_date}\nSender: contact@domain.com\nMessage-Id: <{n,15}.{n,1}.{A,3}{n,10}@{domain}>\nTo: {to}\nFrom: \"{from_name}\" <{from_email}>\nSubject: {subject}\nContent-Type: {content_type}; charset=\"{charset}\"",
  payload: "", bodyDomain: "trackcom.site", suffix: "", imgDef: "Pixel",
  body: '<!DOCTYPE html>\n<html>\n  <body style="font-family: Arial, sans-serif;">\n    <h1>HELLO</h1>\n    <p>Ceci est un exemple d\'email de campagne.</p>\n  </body>\n</html>',
  rotation: "1", script: "Queue (x/time)", ipAfter: "1", speed: "0", speedUnit: "Minute", batch: "100", pause: "1", pauseUnit: "Minute",
  autoReply: "Désactivée", randomReply: "Désactivée", replyRotation: "1", accounts: "",
};
type Draft = typeof initial;
const storageKey = "email-direct-campaign-draft";
const allServers = ["SERV001 [Serveurs Principaux]", "SERV002 [Warmup]", "SERV003 [Test Inbox]", "SERV004 [Secondaire]"];
const inCls = "h-7 w-full min-w-0 rounded-md border border-border bg-card px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring";

function Col({ id, title, icon, children, right }: { id?: string; title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <section id={id} className="card-lux scroll-mt-24 p-3.5">
    <header className="mb-3 flex items-center gap-2"><span className="text-primary [&_svg]:size-5">{icon}</span><h2 className="font-display text-[16px] font-bold text-primary">{title}</h2>{right && <div className="ml-auto">{right}</div>}</header>
    <div className="space-y-2">{children}</div>
  </section>;
}
function Sub({ title, icon, children, right }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <div className="rounded-xl border border-border/60 bg-primary/[0.03] p-3"><div className="mb-2 flex items-center gap-2"><span className="text-primary [&_svg]:size-4">{icon}</span><h3 className="text-[13px] font-bold text-primary">{title}</h3>{right && <div className="ml-auto">{right}</div>}</div><div className="space-y-2">{children}</div></div>;
}
function Row({ label, children, w = "w-28" }: { label: string; children: ReactNode; w?: string }) {
  return <div className="flex items-center gap-2"><span className={`${w} shrink-0 text-[12px] font-semibold`}>{label} :</span><div className="min-w-0 flex-1">{children}</div></div>;
}
function IconBtn({ children, tone = "card", label, onClick }: { children: ReactNode; tone?: "card" | "primary" | "red"; label: string; onClick?: () => void }) {
  const c = tone === "primary" ? "bg-primary text-primary-foreground" : tone === "red" ? "bg-neon-red text-primary-foreground" : "border border-border bg-card text-foreground";
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`grid size-7 place-items-center rounded-md [&_svg]:size-3.5 ${c}`}>{children}</button>;
}
function Chip({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold hover:border-primary/50 [&_svg]:size-3.5 [&_svg]:text-primary">{children}</button>;
}

function Builder() {
  const [d, setD] = useState<Draft>(initial);
  const [chosen, setChosen] = useState<string[]>([]);
  const [selL, setSelL] = useState<string | null>(allServers[0] ?? null);
  const [selR, setSelR] = useState<string | null>(null);
  const [qL, setQL] = useState(""); const [qR, setQR] = useState("");
  const [proto, setProto] = useState("Tous");
  const [testMode, setTestMode] = useState(true);
  const [live, setLive] = useState(true);
  const [preview, setPreview] = useState(initial.body);
  const [lastTest, setLastTest] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => { setHasDraft(Boolean(localStorage.getItem(storageKey))); }, []);
  useEffect(() => { if (live) setPreview(d.body); }, [d.body, live]);
  const u = (k: keyof Draft, v: string) => setD(p => ({ ...p, [k]: v }));
  const inp = (k: keyof Draft, ph = "", type = "text") => <input aria-label={k} type={type} value={d[k]} placeholder={ph} onChange={e => u(k, e.target.value)} className={inCls} />;
  const sel = (k: keyof Draft, opts: string[]) => <select aria-label={k} value={d[k]} onChange={e => u(k, e.target.value)} className={inCls}>{opts.map(o => <option key={o} value={o}>{o || "Sélectionner une offre..."}</option>)}</select>;
  const area = (k: keyof Draft, h: string, ph = "", mono = false) => <textarea aria-label={k} value={d[k]} placeholder={ph} onChange={e => u(k, e.target.value)} className={`w-full resize-y rounded-md border border-border bg-card p-2 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring ${h} ${mono ? "font-mono leading-5" : ""}`} />;

  const checks = [
    { l: "Structure", ok: Boolean(d.name && d.name !== "__NO_NAME__" && d.offer) },
    { l: "Contenu", ok: d.body.trim().length > 20 },
    { l: "En-têtes", ok: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.fromEmail) && Boolean(d.subject) },
    { l: "Délivrabilité", ok: chosen.length > 0 },
    { l: "Sécurité", ok: d.clickProtect === "Activée" },
  ];
  const passed = checks.filter(c => c.ok).length;
  const ready = passed === checks.length;
  const save = (publish = false) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ d, chosen, testMode })); setHasDraft(true);
      if (publish && !ready) { toast.error("Préflight incomplet : corrigez les points en rouge avant de publier."); return; }
      toast.success(publish ? "Configuration enregistrée et prête à publier (aucun envoi réel)." : "Configuration enregistrée.");
    } catch { toast.error("Enregistrement impossible dans ce navigateur."); }
  };
  const restore = () => {
    try {
      const raw = localStorage.getItem(storageKey); if (!raw) return;
      const data = JSON.parse(raw);
      if (data.d && typeof data.d === "object") setD({ ...initial, ...Object.fromEntries(Object.entries(data.d).filter(([k, v]) => k in initial && typeof v === "string")) });
      setChosen(Array.isArray(data.chosen) ? data.chosen.filter((s: unknown) => typeof s === "string" && allServers.includes(s)) : []);
      setTestMode(data.testMode !== false); toast.success("Configuration restaurée.");
    } catch { toast.error("Configuration illisible."); }
  };
  const runTests = () => { setLastTest(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })); ready ? toast.success("Préflight réussi.") : toast.error(`${checks.length - passed} contrôle(s) à corriger.`); };
  const left = allServers.filter(s => !chosen.includes(s) && s.toLowerCase().includes(qL.toLowerCase()));
  const right = chosen.filter(s => s.toLowerCase().includes(qR.toLowerCase()));

  return <div id="top" className="scroll-mt-24 space-y-3 pb-4">
    {/* Header */}
    <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
      <div className="flex items-center gap-3">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_20px_-8px_var(--primary)]"><Mail className="size-8" /></span>
        <div><h1 className="font-display text-[26px] font-extrabold leading-tight text-primary">Campaign Builder</h1><p className="text-[12.5px] font-semibold">Créez, testez et pilotez vos campagnes avec une précision maximale</p></div>
      </div>
      <label className="ml-2 flex items-center gap-2 text-[13px] font-bold">Mode Test :<Switch checked={testMode} onCheckedChange={setTestMode} /></label>
      <div className="lux-banner flex items-center gap-3 rounded-2xl px-5 py-2.5">
        <ShieldCheck className={`size-9 ${ready ? "text-neon-green" : "text-neon-amber"}`} />
        <div><p className="text-[14px] font-bold">{ready ? "Validation préflight active" : "Préflight en attente"}</p><p className={`text-[12.5px] font-semibold ${ready ? "text-neon-green" : "text-neon-amber"}`}>{ready ? "Campagne prête pour envoi" : `${passed}/${checks.length} contrôles validés`}</p></div>
        <TrendingUp className="size-8 text-neon-green" />
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        <button onClick={() => save()} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-2 text-[12px] whitespace-nowrap font-semibold text-primary"><Save className="size-4" />Enregistrer</button>
        <button onClick={() => save(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-neon-green px-2.5 py-2 text-[12px] whitespace-nowrap font-semibold text-primary-foreground"><Send className="size-4" />Enregistrer & Publier</button>
        <button onClick={() => toast("Survolez chaque champ : chaque colonne correspond à une étape de la campagne.")} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-2 text-[12px] whitespace-nowrap font-semibold"><CircleHelp className="size-4 text-primary" />Aide</button>
        <button disabled={!hasDraft} onClick={restore} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-2 text-[12px] whitespace-nowrap font-semibold disabled:opacity-50"><Folder className="size-4 text-primary" />Configs enregistrées</button>
      </div>
    </div>

    <CampaignTabs active="new" />

    {/* KPIs */}
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi icon={<Target />} label="Délivrabilité estimée" value="99.8%" sub="↑ +0.2% vs dernière campagne" tone="blue" />
      <Kpi icon={<Server />} label="Serveurs actifs" value="12" sub="100% opérationnels" tone="blue" />
      <Kpi icon={<Network />} label="Interfaces sélectionnées" value={String(chosen.length)} sub="VMTA / SMTP" tone="blue" />
      <Kpi icon={<Check />} label="Tests validés" value={`${passed} / ${checks.length}`} sub={ready ? "Préflight réussi" : "Préflight en attente"} tone={ready ? "green" : "amber"} />
      <Kpi icon={<ShieldCheck />} label="Sécurité tracking" value={d.clickProtect === "Activée" ? "100%" : "0%"} sub="Liens protégés & traçage sécurisé" tone="blue" />
    </div>

    {/* 4 columns */}
    <div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-4">
      {/* Offre */}
      <div className="space-y-3">
        <Col id="offre" title="Offre" icon={<Tag />}>
          <Row label="Nom de la campagne" w="w-32">{inp("name")}</Row>
          <Row label="Planifier le" w="w-32"><div className="relative"><CalendarDays className="pointer-events-none absolute left-2 top-1.5 size-4 text-muted-foreground" /><input aria-label="Planifier le" type="datetime-local" value={d.schedule} onChange={e => u("schedule", e.target.value)} className={`${inCls} pl-8`} /></div></Row>
          <Sub title="Sélectionner l'offre" icon={<Pointer />}>
            {sel("offer", ["", "Assurance Auto Économique", "Énergie Verte Maison", "Crédit Conso Express", "Mutuelle Santé Senior"])}
            <p className="text-[12px] font-bold text-primary">GEO autorisés :</p>
            <div className="flex gap-2"><div className="flex-1"><select aria-label="geo" value={d.geo} onChange={e => u("geo", e.target.value)} className={inCls}>{["Tous les pays (par défaut)", "France", "Belgique", "Suisse", "Canada"].map(o => <option key={o}>{o}</option>)}</select></div><Chip onClick={() => toast.success(d.offer ? `Offre « ${d.offer} » sélectionnée.` : "Choisissez une offre.")}><BadgeCheck />Sélectionner offre</Chip></div>
          </Sub>
          <div className="space-y-2 rounded-xl border border-border/60 p-3">
            <div className="grid grid-cols-[1.3fr_1fr] gap-2"><Row label="Envoi de tests" w="w-24"><select aria-label="Envoi de tests" value={d.sendTests} onChange={e => u("sendTests", e.target.value)} className={inCls}><option>Oui</option><option>Non</option></select></Row><Row label="Période" w="w-14">{inp("testPeriod", "", "number")}</Row></div>
            <Row label="Emails de test" w="w-24">{area("tests", "h-16")}</Row>
            <Row label="Rotation des tests" w="w-24">{inp("testRotation", "", "number")}</Row>
            <Row label="Protection des clics" w="w-24"><div className="flex items-center gap-2"><div className="w-24"><select aria-label="Protection des clics" value={d.clickProtect} onChange={e => u("clickProtect", e.target.value)} className={inCls}><option>Activée</option><option>Désactivée</option></select></div><span className="text-[10.5px] leading-tight text-muted-foreground">Désactiver les liens uniques après clics massifs de bots.</span></div></Row>
          </div>
        </Col>
        <Col title="Audience & Ciblage" icon={<Users />}>
          <div className="grid grid-cols-4 gap-2">
            {[{ i: Users, l: "Contacts ciblés", v: "250,000", c: "text-neon-green" }, { i: Ban, l: "Exclusions", v: "12,400", c: "text-neon-red" }, { i: Globe2, l: "Domaines", v: "18,320", c: "text-primary" }, { i: MapPin, l: "Pays", v: "35", c: "text-neon-green" }].map(s => <div key={s.l} className="rounded-xl border border-border/60 bg-card p-2 text-center"><s.i className={`mx-auto size-6 ${s.c}`} /><p className="mt-1 text-[10.5px] font-semibold">{s.l}</p><p className="font-display text-[15px] font-extrabold text-primary">{s.v}</p></div>)}
          </div>
        </Col>
      </div>

      {/* Structure */}
      <div className="space-y-3">
        <Col id="structure" title="Structure Email" icon={<Mail />}>
          <Row label="Return Path">{inp("returnPath")}</Row>
          <Row label="From Name">{inp("fromName")}</Row>
          <Row label="From Email">{inp("fromEmail", "", "email")}</Row>
          <Row label="Reply To">{inp("replyTo", "", "email")}</Row>
          <Row label="Subject">{inp("subject")}</Row>
          <Row label="Content Type">{sel("contentType", ["Text/Html", "Text/Plain", "Multipart"])}</Row>
          <Row label="Charset">{sel("charset", ["UTF-8", "ISO-8859-1"])}</Row>
          <Row label="C.T Encoding">{sel("encoding", ["8Bit Encoding", "Quoted-Printable", "Base64"])}</Row>
          <Row label="Header Processing">{sel("processing", ["Default Process", "Strip topology"])}</Row>
          <div className="pt-1">
            <div className="mb-1.5 flex items-center gap-1.5"><span className="text-[13px] font-bold text-primary">En-tête Email (Header 1)</span><div className="ml-auto flex gap-1"><IconBtn label="Importer"><Upload /></IconBtn><IconBtn label="Ajouter" tone="primary" onClick={() => u("header", d.header + "\nX-Custom: {value}")}><span className="text-sm font-bold">+</span></IconBtn><IconBtn label="Vider" tone="red" onClick={() => u("header", "")}><Trash2 /></IconBtn></div></div>
            {area("header", "h-32", "", true)}
          </div>
        </Col>
        <Col title="Body Config" icon={<FileCode2 />}>
          <Row label="Payload">{area("payload", "h-12", "Saisissez un payload (optionnel)...")}</Row>
          <Row label="Fichier Payload"><label className={`${inCls} flex cursor-pointer items-center justify-between text-muted-foreground`}><span>Aucun fichier sélectionné</span><Folder className="size-4 text-primary" /><input type="file" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) { u("payload", await f.text()); toast.success("Payload importé."); } }} /></label></Row>
          <Row label="Domaine du corps">{sel("bodyDomain", ["trackcom.site", "track.mondomaine.com"])}</Row>
          <div className="flex gap-2"><Row label="Suffixe URL">{inp("suffix", "Paramètre ajouté")}</Row><Row label="Déf. img" w="w-14">{sel("imgDef", ["Pixel", "CDN", "Base64"])}</Row></div>
        </Col>
      </div>

      {/* Corps */}
      <div className="space-y-3">
        <Col id="corps" title="Corps de l'Email (HTML)" icon={<Code2 />}>
          <div className="flex justify-center gap-1">
            <label className="grid size-7 cursor-pointer place-items-center rounded-md border border-border bg-card" title="Importer"><Upload className="size-3.5" /><input type="file" accept=".html,.htm" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) { u("body", await f.text()); toast.success("HTML importé."); } }} /></label>
            <IconBtn label="Nouveau" tone="primary" onClick={() => u("body", initial.body)}><span className="text-sm font-bold">+</span></IconBtn>
            <IconBtn label="Vider" tone="red" onClick={() => u("body", "")}><Trash2 /></IconBtn>
          </div>
          <textarea aria-label="Contenu HTML" value={d.body} onChange={e => u("body", e.target.value)} className="h-36 w-full resize-y rounded-md border border-border bg-card p-2 font-mono text-[11.5px] leading-5 text-primary focus:outline-none focus:ring-1 focus:ring-ring" />
          <Row label="Rotation du corps">{inp("rotation", "", "number")}</Row>
          <div className="flex flex-wrap gap-1.5">
            <Chip onClick={() => toast(`${(d.body.match(/href=/g) ?? []).length} lien(s) détecté(s).`)}><Link2 />Liens</Chip>
            <Chip onClick={() => document.querySelector<HTMLTextAreaElement>('[aria-label="Contenu HTML"]')?.focus()}><Code2 />Éditeur</Chip>
            <Chip onClick={() => setPreview(d.body)}><Play />Render</Chip>
            <Chip onClick={() => toast("Palette : utilisez les couleurs de votre marque.")}><Palette />Couleurs</Chip>
            <Chip onClick={() => { const w = window.open("", "_blank"); if (w) { w.document.write(d.body); w.document.close(); } }}><Globe2 />Vue web</Chip>
            <Chip onClick={() => { u("body", d.body.replace(/href="(?!\{)[^"]*"/g, 'href="{offer_url}"')); toast.success("Liens remplacés par {offer_url}."); }}><RefreshCw />Remplacer liens</Chip>
            <Chip onClick={() => { u("body", d.body.replace(/src="[^"]*"/g, 'src="{image_url}"')); toast.success("Images remplacées par {image_url}."); }}><Image />Remplacer images</Chip>
          </div>
        </Col>
        <Col title="Aperçu HTML" icon={<Search />}>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2"><Mail className="size-5 text-primary" /><span className="font-display text-[14px] font-bold text-primary">Email Direct</span></div>
            <iframe title="Aperçu HTML" sandbox="" srcDoc={preview} className="block h-44 w-full border-0 bg-card" />
          </div>
          <div className="flex items-center justify-between"><IconBtn label="Rafraîchir" tone="primary" onClick={() => setPreview(d.body)}><RefreshCw /></IconBtn><label className="flex items-center gap-2 text-[12px] font-semibold"><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} className="size-4 accent-primary" />Activer l'aperçu en temps réel</label></div>
        </Col>
      </div>

      {/* Délivrabilité */}
      <div className="space-y-3">
        <Col id="deliv" title="Délivrabilité" icon={<Zap />}>
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-primary"><Server className="size-4" />Serveurs de livraison :</p>
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
            <div className="space-y-1"><input value={qL} onChange={e => setQL(e.target.value)} placeholder="Rechercher..." className={inCls} /><ul className="h-20 overflow-auto rounded-md border border-border bg-card p-1">{left.map(s => <li key={s}><button onClick={() => setSelL(s)} className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] ${selL === s ? "bg-primary text-primary-foreground" : ""}`}>{s}</button></li>)}</ul></div>
            <div className="flex flex-col justify-center gap-1">
              <IconBtn label="Tout ajouter" tone="primary" onClick={() => setChosen([...allServers])}><ChevronsRight /></IconBtn>
              <IconBtn label="Ajouter" tone="primary" onClick={() => selL && !chosen.includes(selL) && setChosen(p => [...p, selL])}><ChevronRight /></IconBtn>
              <IconBtn label="Retirer" tone="primary" onClick={() => selR && setChosen(p => p.filter(x => x !== selR))}><ChevronLeft /></IconBtn>
              <IconBtn label="Tout retirer" tone="primary" onClick={() => setChosen([])}><ChevronsLeft /></IconBtn>
            </div>
            <div className="space-y-1"><input value={qR} onChange={e => setQR(e.target.value)} placeholder="Rechercher..." className={inCls} /><ul className="h-20 overflow-auto rounded-md border border-border bg-card p-1">{right.map(s => <li key={s}><button onClick={() => setSelR(s)} className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] ${selR === s ? "bg-primary text-primary-foreground" : ""}`}>{s}</button></li>)}</ul></div>
          </div>
          <div className="flex flex-wrap gap-1">{["IPv4", "IPv6", "SMTP", "Route", "Custom", "Tous"].map(p => <button key={p} onClick={() => setProto(p)} className={`flex-1 rounded-md px-2 py-1 text-[11px] font-bold ${proto === p ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary"}`}>{p}</button>)}</div>
          <p className="flex items-center gap-1.5 pt-1 text-[13px] font-bold text-primary"><Network className="size-4" />Interfaces (VMTA & SMTP) :</p>
          <ul className="space-y-1 rounded-md border border-border bg-card p-1.5">
            {chosen.length === 0 ? <li className="text-[11px] text-muted-foreground">Ajoutez un serveur pour voir ses interfaces.</li> : chosen.map(s => <li key={s} className="flex items-center gap-2 text-[11px]"><span className="truncate">[{s.slice(0, 7)}] - vmta-192_236_161_81-N1 - trackcom.site · {proto}</span><button aria-label="Retirer" onClick={() => setChosen(p => p.filter(x => x !== s))} className="ml-auto"><X className="size-3.5" /></button></li>)}
          </ul>
          <Row label="Script d'envoi" w="w-36">{sel("script", ["Queue (x/time)", "Leaky bucket", "Burst"])}</Row>
          <Row label="Changer d'interface (IP) après" w="w-36"><div className="flex items-center gap-2">{inp("ipAfter", "", "number")}<span className="text-[11px]">Email(s)</span></div></Row>
          <Row label="Vitesse d'envoi" w="w-36"><div className="flex items-center gap-1.5">{inp("speed", "", "number")}<span className="text-[11px]">Emails/</span>{sel("speedUnit", ["Minute", "Heure"])}</div></Row>
          <Row label="Batch" w="w-36"><div className="flex items-center gap-2">{inp("batch", "", "number")}<span className="shrink-0 text-[11px]">par livraison</span></div></Row>
          <Row label="Pause" w="w-36"><div className="flex items-center gap-1.5">{inp("pause", "", "number")}{sel("pauseUnit", ["Minute", "Seconde"])}</div></Row>
          <div className="rounded-lg border border-neon-amber/40 bg-neon-amber/10 p-2"><p className="flex items-center gap-1.5 text-[12px] font-bold text-primary"><Gauge className="size-4 text-neon-amber" />Observateur de file (Queue Watcher)</p><p className="text-[11px] text-neon-red">Cette fonctionnalité fonctionne uniquement en mode serveur mono.</p></div>
        </Col>
        <Col title="Auto-Réponse" icon={<Reply />}>
          <div className="grid grid-cols-2 gap-2"><Row label="Statut" w="w-12">{sel("autoReply", ["Désactivée", "Activée"])}</Row><Row label="Aléatoire" w="w-16">{sel("randomReply", ["Désactivée", "Activée"])}</Row></div>
          <Row label="Rotation" w="w-24">{inp("replyRotation", "", "number")}</Row>
          <Row label="Comptes email" w="w-24">{area("accounts", "h-12", "Collez ici les comptes email actifs pour l'auto-réponse...")}</Row>
        </Col>
        <details className="card-lux p-3.5"><summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-bold text-primary"><Braces className="size-5" />Variables (Placeholders)<span className="ml-auto text-lg">+</span></summary>
          <div className="mt-2 flex flex-wrap gap-1">{["{first_name}", "{to}", "{subject}", "{from_name}", "{from_email}", "{domain}", "{offer_url}", "{unsubscribe_url}", "{smtp_date}", "{n,15}", "{A,3}"].map(v => <button key={v} onClick={() => { navigator.clipboard?.writeText(v); toast.success(`${v} copié.`); }} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">{v}</button>)}</div>
        </details>
      </div>
    </div>

    {/* Préflight */}
    <section id="preflight" className="card-lux scroll-mt-24 p-3.5">
      <h2 className="mb-2 flex items-center gap-2 font-display text-[16px] font-bold text-primary"><FlaskConical className="size-5" />Résultats des tests & Préflight</h2>
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_1.4fr_1fr_auto]">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 p-2.5"><span className={`grid size-9 place-items-center rounded-full ${ready ? "bg-neon-green text-primary-foreground" : "bg-neon-amber/20 text-neon-amber"}`}><Check className="size-5" /></span><div><p className="text-[13px] font-bold">{lastTest ? (ready ? "Préflight réussi" : "Corrections nécessaires") : "Tests en attente..."}</p><p className="text-[11.5px] text-muted-foreground">Préflight : validation des paramètres, serveurs et contenu.</p></div></div>
        <div className="rounded-xl border border-border/60 p-2.5">
          <div className="flex flex-wrap justify-between gap-2">{checks.map(c => <span key={c.l} className="flex items-center gap-1 text-[12px] font-semibold"><span className={`grid size-4 place-items-center rounded-full ${c.ok ? "bg-neon-green" : "bg-neon-red"} text-primary-foreground`}>{c.ok ? <Check className="size-3" /> : <X className="size-3" />}</span>{c.l}</span>)}</div>
          <div className="mt-2 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-neon-green transition-all" style={{ width: `${(passed / checks.length) * 100}%` }} /></div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border/60 p-2.5 text-[12.5px]"><BadgeCheck className="size-5 text-neon-green" />Dernier test : <b>{lastTest ? `Aujourd'hui à ${lastTest}` : "—"}</b>{lastTest && <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${ready ? "bg-neon-green/15 text-neon-green" : "bg-neon-red/15 text-neon-red"}`}>{ready ? "Réussi" : "Échec"}</span>}</div>
        <button onClick={runTests} className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-card px-5 py-2.5 text-[14px] font-bold text-primary shadow-sm hover:bg-primary/10"><Play className="size-4 fill-current" />Lancer les tests</button>
      </div>
    </section>
    <div className={`lux-banner flex items-center justify-center gap-3 rounded-2xl px-4 py-2.5 text-[13px] font-semibold`}>
      {ready ? <ShieldCheck className="size-5 text-neon-green" /> : <Rocket className="size-5 text-neon-amber" />}
      {ready ? "L'infrastructure de campagne est prête, la validation préflight est réussie et la campagne peut être publiée en toute sécurité." : "Complétez les contrôles du préflight pour publier la campagne en toute sécurité."}
    </div>
  </div>;
}
