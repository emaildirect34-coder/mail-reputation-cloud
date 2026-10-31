import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import nebula from "@/assets/nebula.jpg.asset.json";
import {
  Home, LayoutGrid, Activity, Bot, Send, Code2, FileText, ScrollText, Server, Network, Boxes, Layers, Gauge,
  Globe, CloudCog, KeyRound, BadgeCheck, Lock, FlaskConical, MailCheck, Search, BarChart3, MailX, ScanLine,
  ShieldAlert, Ban, ClipboardCheck, FileBarChart, Users, CreditCard, Settings2, Settings, ChevronDown, Bell,
  LogOut, ShieldCheck, Zap, Rocket, Menu, Mail,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Cockpit — Email Direct" },
      { name: "description", content: "Pilotez vos serveurs, IPs, domaines et votre réputation d'envoi en temps réel." },
      { property: "og:title", content: "Cockpit — Email Direct" },
      { property: "og:description", content: "Le cockpit spatial de votre infrastructure d'envoi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardLayout,
});

type Item = { to: string; icon: typeof Home; label: string; badge?: string };
const sections: { title: string; items: Item[] }[] = [
  { title: "Email Engine", items: [
    { to: "/dashboard/campaigns", icon: Send, label: "Campagnes" },
    { to: "/dashboard/api-keys", icon: Code2, label: "API & SMTP" },
    { to: "/dashboard/campaigns", icon: FileText, label: "Templates" },
    { to: "/dashboard/logs", icon: ScrollText, label: "Logs & événements" },
  ]},
  { title: "Infrastructure", items: [
    { to: "/dashboard/servers", icon: Server, label: "Serveurs VPS" },
    { to: "/dashboard/ips", icon: Network, label: "IP & Warmup" },
    { to: "/dashboard/pools", icon: Boxes, label: "Pools VMTA" },
    { to: "/dashboard/queues", icon: Layers, label: "Files KumoMTA" },
    { to: "/dashboard/shaping", icon: Gauge, label: "Traffic Shaping" },
  ]},
  { title: "Domain Intelligence", items: [
    { to: "/dashboard/domains", icon: Globe, label: "Domaines" },
    { to: "/dashboard/dns", icon: CloudCog, label: "DNS & Automatisation" },
    { to: "/dashboard/lab", icon: KeyRound, label: "DKIM / SPF / DMARC" },
    { to: "/dashboard/lab", icon: BadgeCheck, label: "BIMI & VMC" },
    { to: "/dashboard/lab", icon: Lock, label: "MTA-STS / TLS-RPT" },
  ]},
  { title: "Deliverability Lab", items: [
    { to: "/dashboard/inbox-tester", icon: FlaskConical, label: "Testeur Inbox" },
    { to: "/dashboard/lab", icon: MailCheck, label: "Mail-Tester" },
    { to: "/dashboard/lab", icon: Search, label: "DNS Lab" },
    { to: "/dashboard/reputation", icon: BarChart3, label: "Réputation FAI" },
    { to: "/dashboard/postmaster", icon: MailX, label: "Bounces & Plaintes" },
  ]},
  { title: "Security Center", items: [
    { to: "/dashboard/preflight", icon: ScanLine, label: "Scanner de liens sponsors" },
    { to: "/dashboard/shield", icon: ShieldAlert, label: "Protection & Urgence" },
    { to: "/dashboard/suppression", icon: Ban, label: "Suppressions" },
    { to: "/dashboard/validation", icon: ClipboardCheck, label: "Conformité" },
    { to: "/dashboard/postmaster", icon: FileBarChart, label: "Rapports DMARC" },
  ]},
  { title: "Settings", items: [
    { to: "/dashboard/settings", icon: Users, label: "Clients & utilisateurs" },
    { to: "/dashboard/settings", icon: CreditCard, label: "Facturation" },
    { to: "/dashboard/api-keys", icon: Settings2, label: "Paramètres API" },
    { to: "/dashboard/settings", icon: Settings, label: "Paramètres généraux" },
  ]},
];
const cockpit: Item[] = [
  { to: "/dashboard", icon: LayoutGrid, label: "Vue d'ensemble" },
  { to: "/dashboard/logs", icon: Activity, label: "Activité en direct" },
  { to: "/dashboard/agent", icon: Bot, label: "Agent Hermes AI", badge: "NEW" },
];

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

function DashboardLayout() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname }).replace(/\/$/, "") || "/";
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [mobile, setMobile] = useState(false);
  const now = useClock();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { navigate({ to: "/auth" }); return; }
      setUser(data.user);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { if (!s) navigate({ to: "/auth" }); });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  if (!user) return <div className="space grid min-h-screen place-items-center text-muted-foreground">Chargement…</div>;

  // Only the first item matching the current page is highlighted
  const all = [...cockpit, ...sections.flatMap((s) => s.items)];
  const activeLabel = all.find((i) => i.to === path)?.label;

  const NavItem = ({ i }: { i: Item }) => {
    const active = i.label === activeLabel;
    return (
      <Link
        to={i.to}
        onClick={() => setMobile(false)}
        className={`flex items-center gap-2.5 rounded-md px-3 py-[5px] text-[12.5px] transition-colors ${active ? "bg-neon/10 text-neon" : "text-foreground/85 hover:bg-neon/5 hover:text-neon"}`}
      >
        <i.icon className="h-[15px] w-[15px] shrink-0 opacity-80" strokeWidth={1.6} />
        <span className="truncate">{i.label}</span>
        {i.badge && <span className="ml-auto rounded-full bg-neon-green/20 px-1.5 text-[9px] font-semibold text-neon-green">{i.badge}</span>}
      </Link>
    );
  };

  const sidebar = (
    <div className="lux-side flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-3 pt-5">
        <div className="relative grid h-11 w-11 place-items-center">
          <div className="h-9 w-9 rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, oklch(0.9 0.1 220), oklch(0.6 0.2 255) 60%, oklch(0.4 0.2 270))", boxShadow: "0 0 18px oklch(0.75 0.15 230)" }} />
          <div className="absolute h-4 w-14 -rotate-12 rounded-[50%] border-2" style={{ borderColor: "oklch(0.85 0.1 220)" }} />
        </div>
        <div>
          <p className="font-display text-[20px] font-bold leading-tight">Email Direct</p>
          <p className="text-[9.5px] font-semibold uppercase tracking-wide opacity-80">Deliver more. Stay safe</p>
        </div>
      </div>
      <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-3">
        <div className="space-y-0.5">{cockpit.map((i) => <NavItem key={i.label} i={i} />)}</div>
        {sections.filter((s) => s.title !== "Settings").map((s) => {
          const collapsed = open[s.title] === false;
          return (
            <div key={s.title} className="mt-3">
              <button onClick={() => setOpen((o) => ({ ...o, [s.title]: collapsed }))} className="flex w-full items-center justify-between px-2 py-1 text-[12px] font-bold uppercase tracking-wide">
                {s.title === "Domain Intelligence" ? "Domain & Auth" : s.title}
                <ChevronDown className={`h-3.5 w-3.5 opacity-70 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
              </button>
              {!collapsed && <div className="space-y-0.5">{s.items.map((i) => <NavItem key={i.label} i={i} />)}</div>}
            </div>
          );
        })}
        <button onClick={() => supabase.auth.signOut()} className="mt-3 flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] opacity-70 hover:opacity-100">
          <LogOut className="h-4 w-4" /> Déconnexion
        </button>
      </nav>
      <Link to="/dashboard/agent" className="mx-4 mb-3 flex items-center gap-3 rounded-xl border px-3 py-3" style={{ borderColor: "oklch(0.75 0.15 240)", background: "linear-gradient(135deg, oklch(0.4 0.2 275), oklch(0.3 0.15 265))", boxShadow: "0 0 20px oklch(0.6 0.2 260 / 0.5)" }}>
        <div className="grid h-11 w-11 place-items-center rounded-full" style={{ background: "radial-gradient(circle, oklch(0.75 0.17 230), oklch(0.45 0.2 270))" }}><Bot className="h-6 w-6" /></div>
        <div className="flex-1">
          <p className="text-[13px] font-bold">Mode Expert</p>
          <p className="text-[12px] font-semibold">Atlas IA</p>
          <p className="text-[10px] opacity-80">+12 outils avancés</p>
        </div>
      </Link>
      <p className="px-6 pb-4 text-[12px] opacity-80">Email Direct v2.8.0</p>
    </div>
  );

  return (
    <div className="lux relative flex min-h-screen font-sans">
      <aside className="relative z-10 hidden w-[248px] shrink-0 lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMobile(false)} />
          <aside className="relative h-full w-[260px]">{sidebar}</aside>
        </div>
      )}

      <main className="relative z-10 min-w-0 flex-1 pb-20">
        <header className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button className="lg:hidden" onClick={() => setMobile(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <div className="card-lux flex min-w-[240px] max-w-[460px] flex-1 items-center gap-2 rounded-full px-4 py-2 text-[12px] text-muted-foreground">
            <Search className="h-4 w-4" />
            <input placeholder="Rechercher un domaine, une campagne, un IP..." className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
            <span className="rounded-md bg-muted px-1.5 text-[10px] font-semibold">⌘ K</span>
          </div>
          <div className="ml-auto hidden items-center gap-3 rounded-xl px-4 py-1.5 md:flex" style={{ background: "color-mix(in oklab, var(--neon-green) 15%, transparent)" }}>
            <span className="h-3 w-3 rounded-full bg-neon-green shadow-[0_0_10px_var(--neon-green)]" />
            <div>
              <p className="text-[12px] font-semibold">Système opérationnel</p>
              <p className="text-[10px] text-muted-foreground">Score réseau : 99.4/100</p>
            </div>
          </div>
          <div className="hidden text-[12px] leading-5 md:block">
            <p className="capitalize">{now ? now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—"}</p>
            <p>{now ? now.toLocaleTimeString("fr-FR", { timeZone: "UTC" }) : "--:--:--"} (UTC)</p>
          </div>
          <button className="relative mx-2" aria-label="Notifications">
            <Bell className="h-6 w-6 text-neon-2" />
            <span className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-neon-red text-[9px] font-bold text-primary-foreground">3</span>
          </button>
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{(user.email || "A").charAt(0).toUpperCase()}</div>
            <div className="hidden sm:block">
              <p className="text-[13px] font-semibold">Admin</p>
              <p className="text-[10px] text-muted-foreground">Compte principal</p>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </div>
        </header>

        <div className="space-y-3 px-4 md:px-5">
          <Outlet />
        </div>

        <footer className="fixed bottom-3 left-0 right-0 z-20 flex items-center justify-between gap-4 px-4 lg:left-[264px]">
          <div className="card-lux flex flex-wrap items-center gap-5 rounded-full px-5 py-2 text-[11px]">
            <span className="flex items-center gap-2 font-bold"><Mail className="h-4 w-4 text-neon-red" /> Gmail</span>
            <span><b>98.8%</b> <span className="text-muted-foreground">Délivrabilité</span></span>
            <span><b>0.04%</b> <span className="text-muted-foreground">Plaintes</span></span>
            <span><b>0.18%</b> <span className="text-muted-foreground">Rebonds</span></span>
            <span><b>48 732 msg/s</b></span>
            <span><b>4,2M / 5M</b> <span className="text-muted-foreground">Quota 24h</span></span>
          </div>
          <div className="hidden items-center gap-2 rounded-xl px-4 py-2 text-[11px] text-primary-foreground xl:flex" style={{ background: "linear-gradient(90deg, oklch(0.6 0.15 175), oklch(0.65 0.17 158))" }}>
            <ShieldCheck className="h-5 w-5" />
            <div><p className="font-bold">Tout est conforme !</p><p className="text-[10px] opacity-90">Aucune alerte critique détectée</p></div>
          </div>
        </footer>
      </main>
    </div>
  );
}
