import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, CalendarDays, Euro, FileText, FlaskConical, Gauge, Layers, LayoutDashboard, Mail, MousePointer2, Play, Plus, Send, ShieldCheck, Sparkles } from "lucide-react";
import { Ring } from "@/components/dash/lux";
import { CampaignTabs, LineChart, MiniKpi, ModuleHeader, StatusBar } from "@/components/dash/campaign-tabs";

export const Route = createFileRoute("/dashboard/campaigns")({
  head: () => ({ meta: [
    { title: "Campagnes — Vue d'ensemble — Email Direct" },
    { name: "description", content: "Accueil du module campagnes : performances, campagnes en cours, planning et raccourcis." },
    { property: "og:title", content: "Campagnes — Vue d'ensemble — Email Direct" },
    { property: "og:description", content: "Tableau de bord des campagnes d'emailing." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Overview,
});

const running = [
  { n: "Lancement Printemps 2025", p: 99, open: 42.8, s: "Active" },
  { n: "Newsletter Hebdo #128", p: 99, open: 41.5, s: "Active" },
  { n: "Promo Flash 48h", p: 100, open: 43.7, s: "Active" },
  { n: "Relance Panier Abandonné", p: 50, open: 38.9, s: "En pause" },
];
const planned = [
  { d: "25 avr.", h: "09:00", n: "Webinaire - Inscription", a: "75 000" },
  { d: "26 avr.", h: "14:00", n: "Offre Été - Vague 2", a: "120 000" },
  { d: "28 avr.", h: "10:30", n: "Newsletter Hebdo #129", a: "124 000" },
];
const offers = [{ n: "Offre Premium", r: 9480, w: 100 }, { n: "Promo -50%", r: 16420, w: 100 }, { n: "Accès Anticipé", r: 12360, w: 75 }, { n: "Partenaire", r: 11250, w: 68 }];
const shortcuts = [
  { i: Plus, l: "Nouvelle campagne", d: "Builder 4 colonnes", to: "/dashboard/campaigns/new" },
  { i: Layers, l: "Mes campagnes", d: "Liste & filtres", to: "/dashboard/campaigns/list" },
  { i: FileText, l: "Offres sponsors", d: "Catalogue & eCPM", to: "/dashboard/templates" },
  { i: FlaskConical, l: "A/B & SMTP", d: "Variantes & serveurs", to: "/dashboard/campaigns/ab" },
  { i: ShieldCheck, l: "Préflight", d: "Contrôles avant envoi", to: "/dashboard/preflight" },
  { i: Sparkles, l: "Atlas IA", d: "Optimisation auto", to: "/dashboard/agent" },
] as const;

function Overview() {
  return <div className="space-y-3 pb-4">
    <ModuleHeader icon={<LayoutDashboard />} title="Campagnes" desc="Vue d'ensemble de votre activité d'envoi et accès rapide à tous les outils." actions={
      <Link to="/dashboard/campaigns/new" className="inline-flex items-center gap-1.5 rounded-xl bg-neon-green px-4 py-2 text-[12.5px] font-bold text-primary-foreground"><Plus className="size-4" />Nouvelle campagne</Link>} />
    <CampaignTabs active="overview" />
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <MiniKpi icon={<Play />} label="Campagnes actives" value="28" delta="+12.0%" />
      <MiniKpi icon={<CalendarDays />} label="Planifiées" value="9" delta="+50.0%" />
      <MiniKpi icon={<Mail />} label="Emails envoyés (30j)" value="1,24 M" delta="+8.2%" />
      <MiniKpi icon={<MousePointer2 />} label="Taux d'ouverture" value="42.1%" delta="+1.4 pts" />
      <MiniKpi icon={<BarChart3 />} label="Taux de clic" value="8.9%" delta="+0.5 pts" />
      <MiniKpi icon={<Euro />} label="Revenus (30j)" value="71 860 €" delta="+18.4%" />
    </div>

    <div className="grid items-start gap-3 xl:grid-cols-3">
      <section className="card-lux p-3.5 xl:col-span-2">
        <h2 className="mb-2 flex items-center gap-2 font-display text-[16px] font-bold text-primary"><BarChart3 className="size-5" />Performance des 7 derniers jours</h2>
        <LineChart labels={["18 avr.", "19", "20", "21", "22", "23", "24 avr."]} series={[
          { name: "Ouvertures %", color: "var(--neon-2)", values: [38, 39, 40, 41, 40, 42, 42.8] },
          { name: "Clics %", color: "var(--neon-green)", values: [7.2, 7.6, 8, 8.3, 8.1, 8.6, 8.9] },
          { name: "Conversions %", color: "var(--neon-violet)", values: [2.6, 2.8, 2.9, 3, 3.1, 3.1, 3.2] },
        ]} />
      </section>
      <section className="card-lux flex flex-col items-center p-3.5">
        <h2 className="mb-2 self-start font-display text-[16px] font-bold text-primary"><Gauge className="mr-2 inline size-5" />Délivrabilité globale</h2>
        <Ring value={99.8} size={170}><div><p className="font-display text-[30px] font-extrabold text-primary">99.8%</p><p className="text-[12px] font-semibold text-neon-green">Excellent</p></div></Ring>
        <div className="mt-2 grid w-full grid-cols-3 gap-2 text-center text-[11.5px]">{[["Inbox", "99.1%"], ["Plaintes", "0.04%"], ["Rebonds", "0.18%"]].map(([l, v]) => <div key={l} className="rounded-xl border border-border/60 p-2"><p className="text-muted-foreground">{l}</p><p className="font-display font-extrabold text-primary">{v}</p></div>)}</div>
      </section>
    </div>

    <div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
      <section className="card-lux p-3.5">
        <div className="mb-2 flex items-center"><h2 className="font-display text-[16px] font-bold text-primary"><Send className="mr-2 inline size-5" />Campagnes en cours</h2><Link to="/dashboard/campaigns/list" className="ml-auto text-[12px] font-semibold text-primary">Tout voir →</Link></div>
        <ul className="space-y-2">{running.map(r => <li key={r.n} className="rounded-xl border border-border/60 p-2.5">
          <div className="flex items-center justify-between gap-2"><p className="truncate text-[13px] font-bold text-primary">{r.n}</p><span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${r.s === "Active" ? "bg-neon-green/15 text-neon-green" : "bg-neon-amber/15 text-neon-amber"}`}>{r.s}</span></div>
          <div className="mt-1.5 flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${r.p}%` }} /></div><span className="text-[11px] font-semibold">{r.p}% · ouv. {r.open}%</span></div>
        </li>)}</ul>
      </section>
      <section className="card-lux p-3.5">
        <h2 className="mb-2 font-display text-[16px] font-bold text-primary"><CalendarDays className="mr-2 inline size-5" />Prochains envois</h2>
        <ul className="space-y-2">{planned.map(p => <li key={p.n} className="flex items-center gap-3 rounded-xl border border-border/60 p-2.5"><div className="grid w-14 shrink-0 place-items-center rounded-lg bg-primary/10 py-1 text-primary"><p className="text-[12px] font-bold">{p.d}</p><p className="text-[10.5px]">{p.h}</p></div><div className="min-w-0"><p className="truncate text-[13px] font-bold">{p.n}</p><p className="text-[11px] text-muted-foreground">{p.a} destinataires</p></div></li>)}</ul>
      </section>
      <section className="card-lux p-3.5">
        <h2 className="mb-2 font-display text-[16px] font-bold text-primary"><Euro className="mr-2 inline size-5" />Top offres sponsors</h2>
        <ul className="space-y-2.5">{offers.map(o => <li key={o.n}><div className="flex justify-between text-[12.5px]"><span className="font-semibold">{o.n}</span><span className="font-bold text-primary">{o.r.toLocaleString("fr-FR")} €</span></div><div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-neon-green" style={{ width: `${o.w}%` }} /></div></li>)}</ul>
      </section>
    </div>

    <section className="card-lux p-3.5">
      <h2 className="mb-2 font-display text-[16px] font-bold text-primary">⚡ Raccourcis</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">{shortcuts.map(s => <Link key={s.l} to={s.to} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3 transition hover:border-primary/50 hover:bg-primary/5"><span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><s.i className="size-5" /></span><div><p className="text-[13px] font-bold text-primary">{s.l}</p><p className="text-[11px] text-muted-foreground">{s.d}</p></div></Link>)}</div>
    </section>
    <StatusBar>Module Campagnes opérationnel : 28 campagnes actives · Délivrabilité moyenne 99.8% · Aucune alerte critique</StatusBar>
  </div>;
}
