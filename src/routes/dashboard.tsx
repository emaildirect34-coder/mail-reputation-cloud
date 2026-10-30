import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import nebula from "@/assets/nebula.jpg.asset.json";
import {
  Home, LayoutGrid, Activity, Bot, Send, Code2, FileText, ScrollText, Server, Network, Boxes, Layers, Gauge,
  Globe, CloudCog, KeyRound, BadgeCheck, Lock, FlaskConical, MailCheck, Search, BarChart3, MailX, ScanLine,
  ShieldAlert, Ban, ClipboardCheck, FileBarChart, Users, CreditCard, Settings2, Settings, ChevronDown, Bell,
  LogOut, ShieldCheck, Zap, Rocket, Menu,
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
      if (!data.user) return navigate({ to: "/auth" });
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
    <div className="flex h-full flex-col">
      <div className="glass mx-3 mt-3 flex items-center gap-3 px-3 py-3">
        <div className="neon-glow grid h-11 w-11 place-items-center rounded-xl bg-neon/10 font-display text-lg font-black italic text-neon">ED</div>
        <div>
          <p className="font-display text-[17px] font-semibold leading-tight">Email Direct</p>
          <p className="text-[11px] text-muted-foreground">Powering Your Inbox</p>
        </div>
      </div>
      <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
        <Link to="/dashboard" className="neon-glow flex items-center gap-2.5 rounded-lg bg-neon/10 px-3 py-2 text-[13px] font-semibold text-neon">
          <Home className="h-4 w-4" /> Cockpit
        </Link>
        <div className="mt-1.5 space-y-0.5 pl-1">{cockpit.map((i) => <NavItem key={i.label} i={i} />)}</div>
        {sections.map((s) => {
          const collapsed = open[s.title] === false;
          return (
            <div key={s.title} className="mt-3">
              <button onClick={() => setOpen((o) => ({ ...o, [s.title]: collapsed }))} className="flex w-full items-center justify-between px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-neon/90">
                {s.title}
                <ChevronDown className={`h-3 w-3 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
              </button>
              {!collapsed && <div className="space-y-0.5 pl-1">{s.items.map((i) => <NavItem key={i.label} i={i} />)}</div>}
            </div>
          );
        })}
        <button onClick={() => supabase.auth.signOut()} className="mt-4 flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] text-muted-foreground hover:text-neon-red">
          <LogOut className="h-4 w-4" /> Déconnexion
        </button>
      </nav>
      <div className="glass mx-3 mb-3 flex items-center gap-3 px-3 py-3">
        <div className="neon-glow grid h-10 w-10 place-items-center rounded-full bg-neon-2/20 font-display font-black italic text-neon">E</div>
        <div>
          <p className="text-[12px] font-semibold">Email Direct</p>
          <p className="text-[9.5px] text-muted-foreground">Infrastructure d'envoi nouvelle génération</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space stars-wrap relative flex min-h-screen font-sans">
      <div className="stars pointer-events-none fixed inset-0 opacity-60" />
      <aside className="relative z-10 hidden w-[248px] shrink-0 border-r border-glass-border bg-background/60 lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-background/70" onClick={() => setMobile(false)} />
          <aside className="relative h-full w-[260px] border-r border-glass-border bg-background">{sidebar}</aside>
        </div>
      )}

      <main className="relative z-10 min-w-0 flex-1 pb-24">
        <header
          className="relative flex flex-wrap items-center gap-4 border-b border-glass-border bg-cover bg-center px-5 py-3"
          style={{ backgroundImage: `linear-gradient(90deg, var(--background) 0%, transparent 40%, transparent 70%, var(--background) 100%), url(${nebula.url})` }}
        >
          <button className="lg:hidden" onClick={() => setMobile(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg font-semibold">Bonjour, Email Direct 👋</h1>
            <p className="text-xs text-neon/90">Voici un aperçu complet de votre infrastructure d'envoi.</p>
          </div>
          <div className="neon-glow hidden items-center gap-3 rounded-full bg-neon-green/10 px-4 py-1.5 md:flex" style={{ ["--neon" as string]: "var(--neon-green)" }}>
            <span className="h-3 w-3 rounded-full bg-neon-green shadow-[0_0_10px_var(--neon-green)]" />
            <div>
              <p className="text-[13px] font-semibold text-neon">Système opérationnel</p>
              <p className="text-[10px] text-foreground/80">Score réseau : 99.4/100</p>
            </div>
          </div>
          <div className="hidden text-xs leading-5 text-foreground/85 md:block">
            <p className="capitalize">{now ? now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—"}</p>
            <p>{now ? now.toLocaleTimeString("fr-FR", { timeZone: "UTC" }) : "--:--:--"} (UTC)</p>
          </div>
          <button className="relative" aria-label="Notifications">
            <Bell className="h-5 w-5 text-neon" />
            <span className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-neon-red text-[9px] font-bold">3</span>
          </button>
          <div className="glass flex items-center gap-2.5 px-3 py-1.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-neon-2/30 text-sm font-bold">{(user.email ?? "A")[0].toUpperCase()}</div>
            <div className="hidden sm:block">
              <p className="text-[13px] font-semibold">Admin</p>
              <p className="text-[10px] text-neon">Compte principal</p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </header>

        <div className="space-y-4 p-4 md:p-6">
          <Outlet />
        </div>

        <footer className="fixed bottom-3 left-0 right-0 z-20 flex items-center justify-center gap-4 px-4 lg:left-[248px]">
          <div className="glass flex items-center gap-4 rounded-full px-6 py-2 text-xs">
            <Link to="/dashboard/shield" className="flex items-center gap-2 hover:text-neon"><ShieldCheck className="h-4 w-4 text-neon" /> Sécurité</Link>
            <Activity className="h-4 w-4 text-neon/60" />
            <Link to="/dashboard/shaping" className="flex items-center gap-2 hover:text-neon"><Zap className="h-4 w-4 text-neon" /> Performance</Link>
            <Activity className="h-4 w-4 text-neon/60" />
            <Link to="/dashboard/reputation" className="flex items-center gap-2 hover:text-neon"><Rocket className="h-4 w-4 text-neon-violet" /> Délivrabilité</Link>
          </div>
          <div className="glass hidden items-center gap-2 rounded-full px-4 py-2 text-[11px] xl:flex">
            <span className="h-2.5 w-2.5 rounded-full bg-neon-green shadow-[0_0_8px_var(--neon-green)]" /> Tous les systèmes sont opérationnels
          </div>
        </footer>
      </main>
    </div>
  );
}
