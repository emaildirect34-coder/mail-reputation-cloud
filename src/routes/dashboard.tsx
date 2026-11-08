import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { canOpen, type Access } from "@/lib/access";
import { getMyAccess } from "@/lib/team.functions";
import { Button } from "@/components/ui/button";
import {
  Home, LayoutGrid, Activity, Bot, Send, Code2, FileText, ScrollText, Server, ShoppingCart, Network, Boxes, Layers, Gauge,
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
type Section = { title: string; items: Item[] };

const sections: Section[] = [
  { title: "Email Engine", items: [
    { to: "/dashboard/campaigns", icon: Send, label: "Campagnes" },
    { to: "/dashboard/api-keys", icon: Code2, label: "API & SMTP" },
    { to: "/dashboard/templates", icon: FileText, label: "Offres Sponsors" },
    { to: "/dashboard/finance", icon: CreditCard, label: "Finances & revenus" },
    { to: "/dashboard/logs", icon: ScrollText, label: "Logs & événements" },
  ]},
  { title: "Infrastructure", items: [
    { to: "/dashboard/servers", icon: Server, label: "Serveurs VPS" },
    { to: "/dashboard/marketplace", icon: ShoppingCart, label: "Achat serveurs" },
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
    { to: "/dashboard/gmail-postmaster", icon: BarChart3, label: "Gmail Postmaster" },
    { to: "/dashboard/reputation", icon: BarChart3, label: "Réputation FAI" },
    { to: "/dashboard/postmaster", icon: MailX, label: "Bounces & Plaintes" },
  ]},
  { title: "Security Center", items: [
    { to: "/dashboard/preflight", icon: ScanLine, label: "Scanner de liens sponsors" },
    { to: "/dashboard/shield", icon: ShieldAlert, label: "Protection & Urgence" },
    { to: "/dashboard/suppression", icon: Ban, label: "Suppressions" },
    { to: "/dashboard/vault", icon: Database, label: "Base clients" },
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

const shortTitle = (t: string) => (t === "Domain Intelligence" ? "Domain & Auth" : t);

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
  const [group, setGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const now = useClock();
  const fetchAccess = useServerFn(getMyAccess);
  const [access, setAccess] = useState<Access | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { navigate({ to: "/auth" }); return; }
      setUser(data.user);
      fetchAccess().then(setAccess).catch(() => setAccess({ role: null, paths: [] }));
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { if (!s) navigate({ to: "/auth" }); });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setGroup(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setGroup(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => { setGroup(null); setMobile(false); }, [path]);

  useEffect(() => {
    if (!access || access.role !== "worker") return;
    if (!canOpen(access, path)) navigate({ to: "/dashboard/my-tasks", replace: true });
  }, [access, path, navigate]);

  if (!user || !access) return <div className="space grid min-h-screen place-items-center text-muted-foreground">Chargement…</div>;
  if (!access.role) return (
    <div className="space grid min-h-screen place-items-center p-6 text-center">
      <div><p className="text-lg font-semibold">Accès non autorisé</p><p className="mt-1 text-sm text-muted-foreground">Votre compte n'a pas encore de rôle. Contactez un Superadmin.</p>
      <Button className="mt-4" onClick={() => supabase.auth.signOut()}>Se déconnecter</Button></div>
    </div>
  );
  const isSuper = access.role === "superadmin";
  const visCockpit: Item[] = isSuper ? cockpit : [{ to: "/dashboard/my-tasks", icon: ClipboardCheck, label: "Mes tâches" }, ...cockpit.filter((i) => canOpen(access, i.to))];
  const visSections: Section[] = (isSuper
    ? sections.map((s) => s.title === "Settings" ? { ...s, items: [{ to: "/dashboard/team", icon: Users, label: "Équipe & tâches" }, ...s.items] } : s)
    : sections.map((s) => ({ ...s, items: s.items.filter((i) => canOpen(access, i.to)) }))
  ).filter((s) => s.items.length);
  if (access.role === "worker" && !canOpen(access, path)) return <div className="space grid min-h-screen place-items-center text-muted-foreground">Chargement…</div>;

  // Only the first item matching the current page is highlighted
  const all = [...visCockpit, ...visSections.flatMap((s) => s.items)];
  const activeItem = all.find((i) => i.to === path);
  const activeLabel = activeItem?.label;
  const activeGroup = activeItem ? visSections.find((s) => s.items.includes(activeItem))?.title : undefined;

  const Pill = ({ i }: { i: Item }) => {
    const active = i.label === activeLabel;
    return (
      <Link
        to={i.to}
        onClick={() => { setGroup(null); setMobile(false); }}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${active ? "bg-primary text-primary-foreground shadow-[0_4px_16px_-4px_var(--primary)]" : "text-sidebar-foreground hover:bg-sidebar-accent/60"}`}
      >
        <i.icon className={`h-[15px] w-[15px] shrink-0 ${active ? "" : "text-sidebar-primary"}`} strokeWidth={2} />
        <span className="whitespace-nowrap">{i.label}</span>
        {i.badge && <span className="rounded-full bg-neon-green/20 px-1.5 text-[9px] font-semibold text-neon-green">{i.badge}</span>}
      </Link>
    );
  };

  const Row = ({ i }: { i: Item }) => {
    const active = i.label === activeLabel;
    return (
      <Link
        to={i.to}
        onClick={() => { setGroup(null); setMobile(false); }}
        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[12.5px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"}`}
      >
        <i.icon className={`h-[15px] w-[15px] shrink-0 ${active ? "" : "text-sidebar-primary"}`} strokeWidth={2} />
        <span className="truncate">{i.label}</span>
        {i.badge && <span className="ml-auto rounded-full bg-neon-green/20 px-1.5 text-[9px] font-semibold text-neon-green">{i.badge}</span>}
      </Link>
    );
  };

  const GroupMenu = ({ s }: { s: Section }) => {
    const label = shortTitle(s.title);
    const isOpen = group === s.title;
    const isActive = activeGroup === s.title;
    return (
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={isOpen}
          onClick={() => setGroup(isOpen ? null : s.title)}
          className={`h-[28px] gap-1 rounded-full px-2.5 text-[11.5px] font-semibold hover:bg-sidebar-accent/60 ${isActive ? "bg-sidebar-accent/50 text-sidebar-primary" : "text-sidebar-foreground"}`}
        >
          <span className="whitespace-nowrap">{label}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-70 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </Button>
        {isOpen && (
          <div className="lux-panel absolute left-0 top-full z-40 mt-2 w-[286px] rounded-xl p-1.5">
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-sidebar-primary">{label}</p>
            <div className="space-y-0.5">{s.items.map((i) => <Row key={i.label} i={i} />)}</div>
          </div>
        )}
      </div>
    );
  };

  const drawer = (
    <div className="lux-side flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-3 pt-5">
        <div className="relative grid h-11 w-11 place-items-center">
          <div className="cockpit-brand-orb h-9 w-9 rounded-full" />
          <div className="absolute h-4 w-14 -rotate-12 rounded-[50%] border-2 border-sidebar-primary" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-[20px] font-bold leading-tight">Email Direct</p>
          <p className="truncate text-[9.5px] font-semibold uppercase tracking-wide opacity-80">Deliver more. Stay safe</p>
        </div>
      </div>
      <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-3">
        <div className="space-y-0.5">{visCockpit.map((i) => <Row key={i.label} i={i} />)}</div>
        {visSections.map((s) => {
          const collapsed = open[s.title] === false;
          return (
            <div key={s.title} className="mt-3">
              <Button variant="ghost" onClick={() => setOpen((o) => ({ ...o, [s.title]: collapsed }))} aria-expanded={!collapsed} className="h-7 w-full justify-between px-2 text-[10px] font-bold uppercase text-sidebar-primary hover:bg-sidebar-accent hover:text-sidebar-foreground">
                {shortTitle(s.title)}
                <ChevronDown className={`h-3.5 w-3.5 opacity-70 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
              </Button>
              {!collapsed && <div className="space-y-0.5">{s.items.map((i) => <Row key={i.label} i={i} />)}</div>}
            </div>
          );
        })}
        <Button variant="ghost" onClick={() => supabase.auth.signOut()} className="mt-3 h-7 justify-start px-3 text-[12px] text-sidebar-foreground hover:bg-sidebar-accent">
          <LogOut className="h-4 w-4" /> Déconnexion
        </Button>
      </nav>
      <Link to="/dashboard/agent" className="cockpit-expert mx-4 mb-3 flex items-center gap-3 rounded-xl border px-3 py-3">
        <div className="cockpit-brand-orb grid h-11 w-11 place-items-center rounded-full"><Bot className="h-6 w-6" /></div>
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
    <div className="lux relative flex min-h-screen flex-col font-sans">
      <header className="lux-top lg:sticky top-0 z-30 border-b border-border">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
          <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" onClick={() => setMobile(true)} aria-label="Menu"><Menu className="h-5 w-5" /></Button>
          <div className="flex min-w-0 shrink-0 items-center gap-2.5">
            <div className="relative grid h-10 w-10 shrink-0 place-items-center">
              <div className="cockpit-brand-orb h-8 w-8 rounded-full" />
              <div className="absolute h-3.5 w-12 -rotate-12 rounded-[50%] border-2 border-sidebar-primary" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-[18px] font-bold leading-tight">Email Direct</p>
              <p className="truncate text-[9.5px] font-semibold uppercase tracking-wide opacity-80">Deliver more. Stay safe</p>
            </div>
          </div>
          <div className="card-lux order-last hidden w-full sm:flex min-w-0 items-center gap-2 rounded-full px-4 py-2 text-[12px] text-muted-foreground sm:order-none sm:w-auto sm:max-w-[430px] sm:flex-1">
            <Search className="h-4 w-4 shrink-0" />
            <input placeholder="Rechercher un domaine, une campagne, un IP..." aria-label="Rechercher" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
            <span className="hidden shrink-0 rounded-md bg-muted px-1.5 text-[10px] font-semibold sm:block">⌘ K</span>
          </div>
          <div className="ml-auto hidden items-center gap-3 rounded-xl px-4 py-1.5 md:flex" style={{ background: "color-mix(in oklab, var(--neon-green) 15%, transparent)" }}>
            <span className="h-3 w-3 shrink-0 rounded-full bg-neon-green shadow-[0_0_10px_var(--neon-green)]" />
            <div>
              <p className="text-[12px] font-semibold">Système opérationnel</p>
              <p className="text-[10px] text-sidebar-foreground/70">Score réseau : 99.4/100</p>
            </div>
          </div>
          <div className="hidden text-[12px] leading-5 md:block">
            <p className="capitalize">{now ? now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—"}</p>
            <p>{now ? now.toLocaleTimeString("fr-FR", { timeZone: "UTC" }) : "--:--:--"} (UTC)</p>
          </div>
          <Link to="/dashboard/agent" className="cockpit-expert hidden items-center gap-2 rounded-full border px-3 py-1.5 xl:flex">
            <Bot className="h-4 w-4 shrink-0" />
            <span className="text-[11.5px] font-bold">Mode Expert</span>
            <span className="text-[10px] opacity-80">Atlas IA · +12 outils</span>
          </Link>
          <Button variant="ghost" size="icon" className="relative shrink-0" aria-label="Notifications">
            <Bell className="h-6 w-6 text-neon-2" />
            <span className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-neon-red text-[9px] font-bold text-primary-foreground">3</span>
          </Button>
          <div className="flex min-w-0 shrink-0 items-center gap-2.5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{(user.email || "A").charAt(0).toUpperCase()}</div>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-[13px] font-semibold">{isSuper ? "Superadmin" : "Worker"}</p>
              <p className="truncate text-[10px] text-sidebar-foreground/70">{user.email}</p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-sidebar-foreground/70" />
          </div>
          <Button variant="ghost" size="icon" className="hidden shrink-0 sm:inline-flex" aria-label="Déconnexion" onClick={() => supabase.auth.signOut()}><LogOut className="h-5 w-5" /></Button>
        </div>

        <div ref={navRef} className="hidden flex-wrap items-center gap-1 px-4 pb-2 lg:flex">
          {visCockpit.map((i) => <Pill key={i.label} i={i} />)}
          <span className="mx-1 hidden h-5 w-px shrink-0 bg-border lg:block" />
          {visSections.map((s) => <GroupMenu key={s.title} s={s} />)}
        </div>
      </header>

      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMobile(false)} />
          <aside className="relative h-full w-[260px]">{drawer}</aside>
        </div>
      )}

      <main className="relative z-10 min-w-0 flex-1 pb-20">
        <div className="space-y-3 px-4 py-3 md:px-5">
          <Outlet />
        </div>

        <footer className="fixed bottom-3 left-0 right-0 z-20 hidden items-center justify-between gap-4 px-4 md:flex">
          <div className="card-lux flex flex-wrap items-center gap-x-5 gap-y-1 rounded-full px-5 py-2 text-[11px]">
            <span className="flex items-center gap-2 font-bold"><Mail className="h-4 w-4 text-neon-red" /> Gmail</span>
            <span><b>98.8%</b> <span className="text-muted-foreground">Délivrabilité</span></span>
            <span><b>0.04%</b> <span className="text-muted-foreground">Plaintes</span></span>
            <span><b>0.18%</b> <span className="text-muted-foreground">Rebonds</span></span>
            <span><b>48 732 msg/s</b></span>
            <span><b>4,2M / 5M</b> <span className="text-muted-foreground">Quota 24h</span></span>
          </div>
          <div className="hidden items-center gap-2 rounded-xl px-4 py-2 text-[11px] text-primary-foreground xl:flex" style={{ background: "var(--cockpit-success-gradient)" }}>
            <ShieldCheck className="h-5 w-5" />
            <div><p className="font-bold">Tout est conforme !</p><p className="text-[10px] opacity-90">Aucune alerte critique détectée</p></div>
          </div>
        </footer>
      </main>
    </div>
  );
}
