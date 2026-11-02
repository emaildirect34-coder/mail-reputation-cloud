import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import hero from "@/assets/cockpit-hero.jpg.asset.json";
import worldMap from "@/assets/world-map.jpg.asset.json";
import { Button } from "@/components/ui/button";
import { Ring, Spark } from "@/components/dash/lux";
import { Activity, ArrowRight, BadgeCheck, Bot, Boxes, CheckCircle2, ChevronRight, CircleDot, Globe, Mail, Radio, Recycle, Send, ShieldCheck, Star, Target, UserRound, Zap } from "lucide-react";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({ meta: [
    { title: "Tableau de bord — Email Direct" },
    { name: "description", content: "Cockpit Email Direct : performance Gmail, activité Atlas IA, pools VMTA et conformité des envois." },
    { property: "og:title", content: "Tableau de bord — Email Direct" },
    { property: "og:description", content: "Performance des envois, réputation Gmail et supervision de votre infrastructure email." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }), component: Cockpit,
});

function Widget({ title, icon, action, children, className = "" }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`cockpit-widget ${className}`}><div className="cockpit-widget-heading"><span className="cockpit-widget-icon">{icon}</span><h2>{title}</h2><div className="ml-auto">{action}</div></div>{children}</section>;
}
function Detail({ to, children = "Voir le détail" }: { to: string; children?: ReactNode }) {
  return <Button asChild variant="outline" size="sm" className="cockpit-detail"><Link to={to}>{children}<ChevronRight /></Link></Button>;
}
function Chart({ compact = false, period = "24h" }: { compact?: boolean; period?: string }) {
  const values = period === "24h" ? [53, 64, 60, 72, 75, 74, 73, 75, 78, 75, 80, 78, 84, 81, 83, 90, 87, 94, 91, 98] : [34, 40, 49, 45, 56, 54, 68, 63, 71, 75, 72, 83, 79, 90, 87, 94, 91, 96, 98, 99];
  const points = (offset: number) => values.map((v, i) => `${i * 20},${130 - v * .9 + offset}`).join(" ");
  return <svg className={compact ? "cockpit-chart-mini" : "cockpit-chart"} viewBox="-5 0 395 160" role="img" aria-label={`Tendance de délivrabilité sur ${period}`}>
    {[30, 65, 100, 135].map(y => <line key={y} x1="0" x2="380" y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 4" />)}
    <polygon points={`0,140 ${points(0)} 380,140`} fill="var(--cockpit-chart-fill)" />
    <polyline points={points(0)} fill="none" stroke="var(--neon-green)" strokeWidth="2" />
    {!compact && <polyline points={points(43)} fill="none" stroke="var(--neon-violet)" strokeWidth="2" />}
    {values.map((v, i) => <circle key={i} cx={i * 20} cy={130 - v * .9} r="2.5" fill="var(--neon-green)" />)}
    {!compact && ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"].map((t,i) => <text key={t} x={i * 62} y="155" fontSize="9" fill="var(--muted-foreground)">{t}</text>)}
  </svg>;
}
const metrics = [
  { title: "Débit d’injection", value: "48 732", unit: "msg/s", sub: "+12%", icon: Send, tone: "blue" },
  { title: "Volume 24h", value: "4 216 893", unit: "", sub: "/ 5 000 000 quota", icon: Mail, tone: "blue" },
  { title: "Taux de livraison global", value: "99.42%", unit: "", sub: "+0.28%", icon: Target, tone: "violet" },
  { title: "Taux de rebond (hard + soft)", value: "0.18%", unit: "", sub: "−0.07%", icon: Recycle, tone: "green" },
  { title: "Taux de désabonnement", value: "0.13%", unit: "", sub: "−0.05%", icon: UserRound, tone: "blue" },
  { title: "Score Mail-Tester", value: "9.8/10", unit: "", sub: "Excellent", icon: Star, tone: "green" },
] as const;
const events = [
  ["14:28", "Adaptation du pacing Gmail (1 connexion)", "Infrastructure", "blue"],
  ["14:20", "142 adresses inactives mises en sunset", "Hygiène", "violet"],
  ["14:05", "Double DKIM Ed25519 validé sur 4 domaines", "Sécurité", "green"],
  ["13:47", "IP 178.62.x.x promue dans le Pool Gold", "Infrastructure", "blue"],
  ["12:32", "Alerte résolue : greylisting (Google)", "Délivrabilité", "red"],
] as const;

function Cockpit() {
  const [period, setPeriod] = useState("24h");
  return <div className="cockpit-content">
    <div className="cockpit-hero-grid">
      <section className="cockpit-welcome">
        <img src={hero.url} alt="Vaisseau Email Direct devant une planète illuminée" className="cockpit-hero-image" />
        <div className="cockpit-welcome-copy"><p className="text-xs">👋 Bonjour,</p><h1>Email Direct <BadgeCheck className="inline h-6 w-6 text-neon-amber" /></h1><p className="text-sm">Votre infrastructure d’envoi nouvelle génération</p>
          <div className="mt-5 flex flex-wrap gap-2"><Button asChild size="sm" className="cockpit-hero-secondary"><Link to="/dashboard/postmaster"><CircleDot />Voir les rapports</Link></Button><Button asChild size="sm" variant="secondary" className="cockpit-hero-primary"><Link to="/dashboard/campaigns"><Boxes />Configurer une campagne</Link></Button></div>
        </div>
      </section>
      <section className="cockpit-summary"><h2>Performance globale</h2><div className="flex items-center gap-2"><Ring value={99.4} size={112} stroke={10}><div><p className="text-xl font-extrabold text-primary">99.4<span className="text-xs">/100</span></p><p className="text-xs font-semibold text-neon-green">Excellent</p></div></Ring><Spark className="h-20 min-w-0 flex-1" tone="blue" /></div></section>
      <section className="cockpit-summary cockpit-revenue"><h2>Revenu aujourd’hui</h2><p className="mt-3 text-2xl font-extrabold text-primary">12 482,35 €</p><p className="cockpit-positive mt-1">↑ +18.4% vs hier</p><Spark className="absolute right-3 top-7 h-14 w-20 opacity-70" tone="blue" /><div className="mt-4 grid grid-cols-2 divide-x divide-border text-[11px]"><div>Emails envoyés<p className="text-base font-bold text-primary">489 732</p><span className="text-neon-green">↑ +12%</span></div><div className="pl-3">Campagnes en cours<p className="text-base font-bold text-primary">12</p><span className="text-neon-green">↑ 0</span></div></div></section>
    </div>
    <div className="cockpit-kpis">{metrics.map((m,i) => <section className="cockpit-metric" key={m.title}><span className={`cockpit-metric-icon cockpit-tone-${m.tone}`}><m.icon /></span><div className="min-w-0"><h2>{m.title}</h2><p className="cockpit-metric-value">{m.value} <span className="text-[10px]">{m.unit}</span></p><p className={`text-[10px] ${i===1 ? "text-muted-foreground" : "text-neon-green"}`}>{i!==1 && i!==5 ? "↑ " : ""}{m.sub}</p></div>{i===1 ? <div className="cockpit-quota"><progress value="84" max="100" aria-label="Quota 24 heures" /><span>84%</span></div> : i!==5 ? <Spark tone={i===4 ? "blue" : "green"} className="cockpit-metric-spark" /> : null}</section>)}</div>
    <div className="cockpit-primary-grid">
      <Widget title="Performance Gmail" icon={<Mail />} action={<span className="cockpit-chip">Unique FAI</span>} className="cockpit-gmail">
        <div className="cockpit-gmail-inner"><div className="text-center"><Ring value={99.8} size={136} stroke={11}><div><p className="text-2xl font-extrabold text-primary">99.8%</p><p className="text-[10px]">Boîte principale</p></div></Ring><span className="cockpit-positive inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Excellent</span></div>
          <div className="cockpit-gmail-stats">{[["Taux de délivrabilité", "99.8%", "+0.2%"],["Taux de plaintes", "0.04%", "−0.01%"],["Taux de rebonds", "0.18%", "−0.03%"]].map(([l,v,d]) => <div key={l} className="flex gap-2"><ShieldCheck className="h-7 w-7 shrink-0 rounded-lg bg-primary/5 p-1.5 text-primary" /><div><p className="text-[10px] text-muted-foreground">{l}</p><b className="text-xs text-primary">{v}</b><span className="ml-2 text-[9px] text-neon-green">{d}</span></div></div>)}<Detail to="/dashboard/reputation" /></div>
          <div className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-2 text-[10px]"><b>Tendance de délivrabilité (Gmail)</b><div className="flex gap-2"><span className="text-neon-green">● Délivrés</span><span className="text-neon-violet">● Plaintes</span></div></div><Chart period={period} /><div className="flex justify-end gap-1">{["24h", "7j"].map(p => <Button key={p} variant={period===p ? "secondary" : "ghost"} size="sm" className="h-5 px-2 text-[9px]" onClick={() => setPeriod(p)} aria-pressed={period===p}>{p}</Button>)}</div></div>
        </div>
      </Widget>
      <Widget title="Activité Atlas IA" icon={<Bot />} action={<span className="cockpit-positive">● En direct</span>}>
        <ul className="cockpit-agent-events">{events.map(([t,l,c,tone]) => <li key={t}><time>{t}</time><span className={`cockpit-event-icon cockpit-tone-${tone}`}><ShieldCheck /></span><div><p>{l}</p><span>• {c}</span></div><ChevronRight className="ml-auto h-3 w-3 shrink-0" /></li>)}</ul><Detail to="/dashboard/agent">Voir toutes les actions</Detail>
      </Widget>
    </div>
    <div className="cockpit-secondary-grid">
      <Widget title="Répartition des ouvertures par pays" icon={<Globe />} action={<span className="cockpit-chip">● {period}</span>}><div className="cockpit-geography"><img src={worldMap.url} alt="Carte mondiale de répartition des ouvertures" /><ul>{[["🇫🇷", "France", "24.8%"],["🇺🇸", "États-Unis", "18.7%"],["🇩🇪", "Allemagne", "11.5%"],["🇨🇦", "Canada", "7.9%"],["🇬🇧", "Royaume-Uni", "6.2%"],["🌐", "Autres", "30.9%"]].map(([f,n,v]) => <li key={n}><span>{f} {n}</span><b>{v}</b></li>)}</ul></div><div className="flex items-end justify-between gap-2"><div className="text-[10px] text-muted-foreground">Total des ouvertures<p className="text-sm font-bold text-primary">2 486 231</p><span className="text-neon-green">↑ +14.2% vs hier</span></div><Detail to="/dashboard/postmaster" /></div></Widget>
      <Widget title="État des services Gmail" icon={<Mail />} action={<span className="cockpit-positive">Tous opérationnels</span>}><div className="flex items-center gap-3"><ul className="flex-1 space-y-3 text-[10px]">{["API Gmail (Envoi / Réception)","SNDS (Microsoft)","BIMI (Affichage logo)","MTA-STS / TLS-RPT","SPF / DKIM / DMARC"].map(l => <li key={l} className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" /><span>{l}</span><span className="cockpit-positive ml-auto">OK</span></li>)}</ul><div className="w-28 shrink-0 text-center"><Ring value={99.8} size={105} stroke={9} tone="blue"><div><b className="text-lg text-primary">99.8%</b><p className="text-[9px]">Délivrabilité<br />globale</p></div></Ring><Spark className="mt-3 h-8 w-full" /></div></div></Widget>
      <Widget title="Pools VMTA & IPs" icon={<Boxes />} action={<span className="cockpit-chip">Total : 16 IPs</span>}><div className="cockpit-pools">{[["Pool Gold","8 IPs actives","100","green"],["Pool Silver","4 IPs en warmup","75","blue"],["Pool Quarantaine","0 IP","0","violet"]].map(([n,s,v,t]) => <div key={n} className={`cockpit-pool cockpit-tone-${t}`}><p className="flex items-center gap-1 font-bold"><ShieldCheck className="h-3 w-3" />{n}</p><p className="mt-1 text-[9px] text-muted-foreground">{s}</p><Ring value={Number(v)} size={78} stroke={7} tone={t === "green" ? "green" : "blue"}><b className="text-primary">{v}%</b></Ring></div>)}</div><Detail to="/dashboard/pools">Gestion des IPs</Detail></Widget>
    </div>
    <div className="cockpit-bottom-grid">
      <Widget title="Distribution des ouvertures Gmail" icon={<Target />} action={<span className="cockpit-chip">{period}</span>}><div className="flex items-center gap-4"><Ring value={99.8} size={92} stroke={9} tone="blue"><div><b className="text-base text-primary">99.8%</b><p className="text-[9px]">Gmail</p></div></Ring><ul className="flex-1 space-y-2 text-[10px]">{[["Boîte principale","99.8%"],["Promotions","0.12%"],["Spam","0.06%"],["Social","0.02%"],["Autres","0.0%"]].map(([l,v]) => <li key={l} className="flex items-center gap-2"><CircleDot className="h-3 w-3 text-primary" /><span>{l}</span><b className="ml-auto">{v}</b></li>)}</ul></div></Widget>
      <Widget title="Flux d’événements récents" icon={<Radio />} action={<Detail to="/dashboard/logs">Voir tout</Detail>}><ul className="cockpit-flow">{events.map(([t,l,c,tone]) => <li key={t}><time>{t}</time><span className={`cockpit-flow-dot cockpit-tone-${tone}`}><Zap className="h-2.5 w-2.5" /></span><span className="min-w-0 flex-1 truncate">{l}</span><span className="cockpit-chip">{c}</span></li>)}<li><time>11:58</time><span className="cockpit-flow-dot cockpit-tone-green"><CheckCircle2 className="h-2.5 w-2.5" /></span><span>Rapport DMARC traité (RUA)</span><span className="cockpit-chip ml-auto">Conformité</span></li></ul></Widget>
      <Widget title="Conformité & Sécurité" icon={<ShieldCheck />}><div className="flex items-center gap-3"><Ring value={100} size={92} stroke={9}><div><b className="text-lg text-primary">100%</b><p className="text-[9px]">Conforme</p></div></Ring><ul className="flex-1 space-y-1 text-[9px]">{["SPF (10 lookup max)","DKIM (RSA · Ed25519)","DMARC (p=reject)","ARC (RFC 8617)","MTA-STS (RFC 8461)","TLS-RPT (RFC 8460)","BIMI & VMC"].map(l => <li className="flex items-center gap-1" key={l}><CheckCircle2 className="h-2.5 w-2.5 text-neon-green" /><span>{l}</span><span className="ml-auto text-primary">100%</span></li>)}</ul></div><Detail to="/dashboard/shield" /></Widget>
    </div>
  </div>;
}
