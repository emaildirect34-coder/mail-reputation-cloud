import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  ShieldCheck, Target, Mail, Code2, Zap, FlaskConical, Settings2, Cog, Server, Network, CheckCircle2, Lock,
  Save, Send, HelpCircle, FolderOpen, Tag, MousePointerClick, Users, Ban, Globe2, MapPin, Upload, Plus, Trash2,
  Link2, Pencil, Eye, Palette, Image, RefreshCw, Braces, Reply, AlertCircle, ChevronsRight, ChevronRight, ChevronLeft, ChevronsLeft, Play, TrendingUp,
} from "lucide-react";
import { Card, Kpi } from "@/components/dash/lux";
import { LuxTabs } from "@/components/dash/lux";

export const Route = createFileRoute("/dashboard/campaigns")({
  head: () => ({
    meta: [
      { title: "Campaign Builder — Email Direct" },
      { name: "description", content: "Créez, testez et pilotez vos campagnes : offre, structure email, HTML, délivrabilité et préflight." },
      { property: "og:title", content: "Campaign Builder — Email Direct" },
      { property: "og:description", content: "Constructeur de campagnes avec validation préflight et routage VMTA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Builder,
});

const header = `Date: {smtp_date}
Sender: contact@domain.com
Message-Id: <{n,15}.{n,1}.{A,3}{n,10}@{domain}>
To: {to}
From: "{from_name}" <{from_email}>
Subject: {subject}
Content-Type: {content_type}; charset="{charset}"`;
const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif;">
  <h1>HELLO</h1>
  <p>Ceci est un exemple d'email de campagne.</p>
</body>
</html>`;
const servers = ["SERV001 [Serveurs Principaux]", "SERV002 [Warmup]", "SERV003 [Test Inbox]", "SERV004 [Secondaire]"];

const inp = "h-7 w-full rounded-md border border-border bg-card px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary";
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[110px_1fr] items-center gap-2"><span className="text-[12px] font-semibold">{label} :</span>{children}</div>;
}
function Sel({ opts }: { opts: string[] }) {
  return <select className={inp}>{opts.map((o) => <option key={o}>{o}</option>)}</select>;
}
function Mini({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <button className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold hover:text-primary [&_svg]:h-3 [&_svg]:w-3">{icon}{children}</button>;
}

function Builder() {
  const [testMode, setTestMode] = useState(true);
  const [avail, setAvail] = useState(servers.slice(1));
  const [chosen, setChosen] = useState([servers[0]!]);
  const [sel, setSel] = useState<string | null>(servers[0]!);
  const [body, setBody] = useState(html);
  const [live, setLive] = useState(true);
  const [running, setRunning] = useState(false);
  const move = (d: "r" | "l" | "rr" | "ll") => {
    if (d === "rr") { setChosen([...chosen, ...avail]); setAvail([]); }
    else if (d === "ll") { setAvail([...avail, ...chosen]); setChosen([]); }
    else if (sel && d === "r" && avail.includes(sel)) { setAvail(avail.filter((x) => x !== sel)); setChosen([...chosen, sel]); }
    else if (sel && d === "l" && chosen.includes(sel)) { setChosen(chosen.filter((x) => x !== sel)); setAvail([...avail, sel]); }
  };
  const List = ({ items }: { items: string[] }) => (
    <div className="h-20 overflow-auto rounded-md border border-border bg-card p-1 text-[11px]">
      {items.map((i) => <button key={i} onClick={() => setSel(i)} className={`block w-full truncate rounded px-2 py-0.5 text-left ${sel === i ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{i}</button>)}
    </div>
  );

  return (
    <div className="space-y-3">
      <section className="card-lux flex flex-wrap items-center gap-4 px-5 py-3">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_20px_-6px_var(--primary)]"><Mail className="h-8 w-8" /></div>
        <div className="mr-auto">
          <h1 className="font-display text-[26px] font-extrabold leading-tight text-primary">Campaign Builder</h1>
          <p className="text-[13px] font-semibold">Créez, testez et pilotez vos campagnes avec une précision maximale</p>
        </div>
        <label className="flex items-center gap-2 text-[13px] font-bold">Mode Test :
          <button onClick={() => setTestMode(!testMode)} className={`relative h-6 w-11 rounded-full transition ${testMode ? "bg-neon-green" : "bg-muted"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition ${testMode ? "left-[22px]" : "left-0.5"}`} /></button>
        </label>
        <div className="lux-banner flex items-center gap-3 rounded-2xl px-5 py-2.5">
          <ShieldCheck className="h-9 w-9 text-neon-green" />
          <div><p className="text-[14px] font-bold">Validation préflight active</p><p className="text-[12px] font-semibold text-neon-green">Campagne prête pour envoi</p></div>
          <TrendingUp className="h-7 w-7 text-neon-green" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="card-lux inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-primary"><Save className="h-4 w-4" />Enregistrer</button>
          <button className="inline-flex items-center gap-1.5 rounded-xl bg-neon-green px-3 py-2 text-[12px] font-bold text-primary-foreground"><Send className="h-4 w-4" />Enregistrer & Publier</button>
          <button className="card-lux inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-primary"><HelpCircle className="h-4 w-4" />Aide</button>
          <button className="card-lux inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-primary"><FolderOpen className="h-4 w-4" />Configs enregistrées</button>
        </div>
      </section>

      <LuxTabs active={0} tabs={[
        { label: "Vue d'ensemble", icon: ShieldCheck }, { label: "Offre & Ciblage", icon: Target }, { label: "Structure Email", icon: Mail },
        { label: "Contenu & HTML", icon: Code2 }, { label: "Délivrabilité", icon: Zap }, { label: "Tests & Préflight", icon: FlaskConical },
        { label: "Automatisations", icon: Settings2 }, { label: "Configuration avancée", icon: Cog },
      ]} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<Target />} label="Délivrabilité estimée" value="99.8%" sub="↑ +0.2% vs dernière campagne" tone="blue" />
        <Kpi icon={<Server />} label="Serveurs actifs" value="12" sub="✓ 100% opérationnels" tone="blue" />
        <Kpi icon={<Network />} label="Interfaces sélectionnées" value="3" sub="✓ VMTA / SMTP" tone="violet" />
        <Kpi icon={<CheckCircle2 />} label="Tests validés" value="5 / 5" sub="✓ Préflight réussi" tone="green" />
        <Kpi icon={<Lock />} label="Sécurité tracking" value="100%" sub="✓ Liens protégés & traçage sécurisé" tone="blue" />
      </div>

      <div className="grid gap-3 xl:grid-cols-4">
        {/* Offre */}
        <div className="space-y-3">
          <Card title="Offre" icon={<Tag />}>
            <div className="space-y-2">
              <Row label="Nom de la campagne"><input className={inp} placeholder="__NO_NAME__" /></Row>
              <Row label="Planifier le"><input type="datetime-local" className={inp} /></Row>
              <div className="rounded-xl border border-border p-2.5">
                <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-primary"><MousePointerClick className="h-4 w-4" />Sélectionner l'offre</p>
                <Sel opts={["Sélectionner une offre...", "Offre Premium — CPA 18 €", "Assurance Auto — CPL 4,20 €", "Énergie Verte — CPL 6,10 €"]} />
                <p className="mt-2 text-[12px] font-bold text-primary">GEO autorisés :</p>
                <div className="mt-1 flex gap-2"><span className="flex flex-1 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground"><Globe2 className="h-3 w-3" />Tous les pays (par défaut)</span><Mini icon={<Pencil />}>Sélectionner offre</Mini></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Row label="Envoi de tests"><Sel opts={["Oui", "Non"]} /></Row>
                <Row label="Période"><input className={inp} defaultValue="1000" /></Row>
              </div>
              <Row label="Emails de test"><textarea className={`${inp} h-14 py-1`} defaultValue="mail.cortexapp@gmail.com" /></Row>
              <Row label="Rotation des tests"><input className={inp} defaultValue="1" /></Row>
              <Row label="Protection clics"><Sel opts={["Activée", "Désactivée"]} /></Row>
              <p className="text-[10.5px] text-muted-foreground">Désactiver les liens uniques après clics massifs depuis des bots.</p>
            </div>
          </Card>
          <Card title="Audience & Ciblage" icon={<Users />}>
            <div className="grid grid-cols-4 gap-1 text-center">
              {[[<Users key="a" />, "Contacts ciblés", "250,000", "var(--neon-green)"], [<Ban key="b" />, "Exclusions", "12,400", "var(--neon-red)"], [<Globe2 key="c" />, "Domaines", "18,320", "var(--neon-2)"], [<MapPin key="d" />, "Pays", "35", "var(--neon-green)"]].map(([i, l, v, c]) => (
                <div key={l as string} className="rounded-lg p-1"><div className="mx-auto mb-1 w-fit [&_svg]:h-6 [&_svg]:w-6" style={{ color: c as string }}>{i}</div><p className="text-[10.5px] font-semibold">{l}</p><p className="font-display text-[15px] font-extrabold text-primary">{v}</p></div>
              ))}
            </div>
          </Card>
        </div>

        {/* Structure */}
        <div className="space-y-3">
          <Card title="Structure Email" icon={<Mail />}>
            <div className="space-y-1.5">
              <Row label="Return Path"><input className={inp} defaultValue="contact@domain.com" /></Row>
              <Row label="From Name"><Sel opts={["Email Direct", "Service Client"]} /></Row>
              <Row label="From Email"><input className={inp} defaultValue="contact@domain.com" /></Row>
              <Row label="Reply To"><input className={inp} defaultValue="reply@domain.com" /></Row>
              <Row label="Subject"><Sel opts={["{subject} - Offre spéciale", "{first_name}, votre avantage"]} /></Row>
              <Row label="Content Type"><Sel opts={["Text/Html", "Text/Plain", "Multipart"]} /></Row>
              <Row label="Charset"><Sel opts={["UTF-8", "ISO-8859-1"]} /></Row>
              <Row label="C.T Encoding"><Sel opts={["8Bit Encoding", "Quoted-Printable", "Base64"]} /></Row>
              <Row label="Header Processing"><Sel opts={["Default Process", "Strip topology"]} /></Row>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <p className="mr-auto text-[13px] font-bold text-primary">En-tête Email (Header 1)</p>
              <Mini icon={<Upload />}>{""}</Mini><Mini icon={<Plus />}>{""}</Mini><Mini icon={<Trash2 />}>{""}</Mini>
            </div>
            <textarea className="mt-1.5 h-32 w-full rounded-md border border-border bg-card p-2 font-mono text-[10.5px]" defaultValue={header} />
          </Card>
          <Card title="Body Config" icon={<Braces />}>
            <div className="space-y-1.5">
              <Row label="Payload"><textarea className={`${inp} h-10 py-1`} placeholder="Saisissez un payload (optionnel)..." /></Row>
              <Row label="Fichier Payload"><input type="file" className="text-[11px]" /></Row>
              <Row label="Domaine du corps"><Sel opts={["trackcom.site", "mail.brand.io"]} /></Row>
              <Row label="Suffixe URL"><input className={inp} placeholder="Paramètre ajouté" /></Row>
              <Row label="Définition img"><Sel opts={["Pixel", "Base64", "CDN"]} /></Row>
            </div>
          </Card>
        </div>

        {/* HTML */}
        <div className="space-y-3">
          <Card title="Corps de l'Email (HTML)" icon={<Code2 />}>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} className="h-36 w-full rounded-md border border-border bg-card p-2 font-mono text-[11px] text-primary" />
            <div className="mt-2"><Row label="Rotation du corps"><input className={inp} defaultValue="1" /></Row></div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Mini icon={<Link2 />}>Liens</Mini><Mini icon={<Pencil />}>Éditeur</Mini><Mini icon={<Eye />}>Render</Mini><Mini icon={<Palette />}>Couleurs</Mini><Mini icon={<Globe2 />}>Vue web</Mini><Mini icon={<Link2 />}>Remplacer liens</Mini><Mini icon={<Image />}>Remplacer images</Mini>
            </div>
          </Card>
          <Card title="Aperçu HTML" icon={<Eye />}>
            <div className="h-56 overflow-hidden rounded-lg border border-border bg-card">
              {live ? <iframe title="Aperçu" sandbox="" srcDoc={body} className="h-full w-full" /> : <p className="p-4 text-[12px] text-muted-foreground">Aperçu désactivé</p>}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><RefreshCw className="h-4 w-4" /></button>
              <label className="flex items-center gap-2 text-[12px] font-semibold"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-[var(--neon-green)]" />Activer l'aperçu en temps réel</label>
            </div>
          </Card>
        </div>

        {/* Délivrabilité */}
        <div className="space-y-3">
          <Card title="Délivrabilité" icon={<Zap />}>
            <p className="mb-1 text-[12px] font-bold text-primary">Serveurs de livraison :</p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
              <List items={chosen} />
              <div className="flex flex-col gap-1">
                {([["rr", ChevronsRight], ["r", ChevronRight], ["l", ChevronLeft], ["ll", ChevronsLeft]] as const).map(([d, I]) => (
                  <button key={d} onClick={() => move(d === "rr" ? "ll" : d === "ll" ? "rr" : d === "r" ? "l" : "r")} className="grid h-5 w-7 place-items-center rounded bg-neon-green text-primary-foreground"><I className="h-3 w-3" /></button>
                ))}
              </div>
              <List items={avail} />
            </div>
            <div className="mt-2 grid grid-cols-6 gap-1">
              {["IPv4", "IPv6", "SMTP", "Route", "Custom", "Tous"].map((t) => <button key={t} className="rounded-md bg-primary py-1 text-[10.5px] font-bold text-primary-foreground">{t}</button>)}
            </div>
            <p className="mb-1 mt-3 text-[12px] font-bold text-primary">Interfaces (VMTA & SMTP) :</p>
            <div className="rounded-md border border-border bg-card px-2 py-1.5 text-[11px]">[SERV001] - vmta-192_236_161_81-N1 - trackcom.site</div>
            <div className="mt-2 space-y-1.5">
              <Row label="Script d'envoi"><Sel opts={["Queue (x/time)", "Burst", "Leaky bucket"]} /></Row>
              <Row label="Changer IP après"><input className={inp} defaultValue="1" /></Row>
              <Row label="Vitesse d'envoi"><div className="flex gap-1"><input className={inp} defaultValue="0" /><Sel opts={["Minute", "Heure"]} /></div></Row>
              <Row label="Batch"><input className={inp} defaultValue="100" /></Row>
              <Row label="Pause"><div className="flex gap-1"><input className={inp} defaultValue="1" /><Sel opts={["Minute", "Seconde"]} /></div></Row>
            </div>
            <div className="mt-2 rounded-lg border p-2 text-[11px]" style={{ borderColor: "var(--neon-amber)", background: "color-mix(in oklab, var(--neon-amber) 10%, transparent)" }}>
              <p className="flex items-center gap-1 font-bold text-primary"><AlertCircle className="h-4 w-4" style={{ color: "var(--neon-amber)" }} />Observateur de file (Queue Watcher)</p>
              <p style={{ color: "var(--neon-red)" }}>Fonctionne uniquement en mode serveur mono.</p>
            </div>
          </Card>
          <Card title="Auto-Réponse" icon={<Reply />}>
            <div className="space-y-1.5">
              <Row label="Statut"><Sel opts={["Désactivée", "Activée"]} /></Row>
              <Row label="Aléatoire"><Sel opts={["Désactivée", "Activée"]} /></Row>
              <Row label="Rotation"><input className={inp} defaultValue="1" /></Row>
              <Row label="Comptes email"><textarea className={`${inp} h-10 py-1`} placeholder="Collez les comptes actifs..." /></Row>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Résultats des tests & Préflight" icon={<FlaskConical />}>
        <div className="grid items-center gap-3 lg:grid-cols-[1fr_2fr_auto_auto]">
          <div className="flex items-center gap-3"><CheckCircle2 className="h-9 w-9 text-neon-green" /><div><p className="text-[13px] font-bold">{running ? "Tests en cours de traitement..." : "Tous les tests sont validés"}</p><p className="text-[11px] text-muted-foreground">Préflight : paramètres, serveurs et contenu.</p></div></div>
          <div>
            <div className="flex justify-between text-[12px] font-semibold">{["Structure", "Contenu", "En-têtes", "Délivrabilité", "Sécurité"].map((s) => <span key={s} className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-neon-green" />{s}</span>)}</div>
            <div className="mt-2 h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-neon-green transition-all" style={{ width: running ? "60%" : "100%" }} /></div>
          </div>
          <p className="text-[12px] font-semibold">Dernier test : Aujourd'hui à 14:29:03 <span className="ml-1 rounded-full px-2 py-0.5 text-neon-green" style={{ background: "color-mix(in oklab, var(--neon-green) 15%, transparent)" }}>Réussi</span></p>
          <button onClick={() => { setRunning(true); setTimeout(() => setRunning(false), 1800); }} className="card-lux inline-flex items-center gap-2 px-4 py-2 text-[13px] font-bold text-primary"><Play className="h-4 w-4" />Lancer les tests</button>
        </div>
      </Card>
    </div>
  );
}
