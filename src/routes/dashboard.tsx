import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Globe, Server, Network, ShieldAlert, MailCheck, Webhook, KeyRound, ScrollText, Settings, LogOut, Send, Ban, Flame, Layers, Bot, CloudCog, FlaskConical,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — Email Direct" },
      { name: "description", content: "Gérez vos serveurs, domaines, IPs et votre réputation d'envoi." },
      { property: "og:title", content: "Tableau de bord — Email Direct" },
      { property: "og:description", content: "Suivez vos envois et votre réputation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardLayout,
});

const nav = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Vue d'ensemble", exact: true },
  { to: "/dashboard/agent", icon: Bot, label: "Agent Hermes" },
  { to: "/dashboard/campaigns", icon: Send, label: "Campagnes Pro" },
  { to: "/dashboard/servers", icon: Server, label: "Serveurs" },
  { to: "/dashboard/domains", icon: Globe, label: "Domaines" },
  { to: "/dashboard/dns", icon: CloudCog, label: "DNS & Automatisation" },
  { to: "/dashboard/inbox-tester", icon: FlaskConical, label: "Testeur inbox" },
  { to: "/dashboard/ips", icon: Network, label: "IPs & Warmup" },
  { to: "/dashboard/warmup", icon: Flame, label: "Warmup par FAI" },
  { to: "/dashboard/queues", icon: Layers, label: "Queues KumoMTA" },
  { to: "/dashboard/suppression", icon: Ban, label: "Suppression" },
  { to: "/dashboard/reputation", icon: ShieldAlert, label: "Réputation" },
  { to: "/dashboard/validation", icon: MailCheck, label: "Validation" },
  { to: "/dashboard/logs", icon: ScrollText, label: "Logs" },
  { to: "/dashboard/webhooks", icon: Webhook, label: "Webhooks" },
  { to: "/dashboard/api-keys", icon: KeyRound, label: "Clés API" },
  { to: "/dashboard/providers", icon: CloudCog, label: "Fournisseurs" },
  { to: "/dashboard/settings", icon: Settings, label: "Paramètres" },
] as const;

function DashboardLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return navigate({ to: "/auth" });
      setUser(data.user);
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle();
      setName(p?.full_name ?? data.user.email ?? "");
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) navigate({ to: "/auth" });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  if (!user) return <div className="grid min-h-screen place-items-center text-muted-foreground">Chargement…</div>;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 md:flex">
        <div className="px-2 py-2"><Logo inverted /></div>
        <nav className="mt-8 flex-1 space-y-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: "exact" in n }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/60"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/60"
        >
          <LogOut className="h-4 w-4" /> Déconnexion
        </button>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b bg-card px-4 py-4 md:px-8">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Bonjour,</p>
            <h1 className="truncate text-lg font-semibold">{name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground sm:inline">Plan gratuit</span>
            <Button size="sm">Mettre à niveau</Button>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b bg-card px-2 py-2 md:hidden">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: "exact" in n }}
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground"
              activeProps={{ className: "bg-accent text-accent-foreground" }}
            >
              <n.icon className="h-3.5 w-3.5" /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-6 p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
