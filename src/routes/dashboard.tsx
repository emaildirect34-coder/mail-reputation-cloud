import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Send, Globe, Server, ShieldAlert, MailCheck, Webhook, KeyRound, BarChart3, Settings, LogOut,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — Email Direct" },
      { name: "description", content: "Vue d'ensemble de vos envois, domaines et IPs." },
      { property: "og:title", content: "Tableau de bord — Email Direct" },
      { property: "og:description", content: "Suivez vos envois et votre réputation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const nav = [
  { icon: LayoutDashboard, label: "Vue d'ensemble", active: true },
  { icon: Send, label: "Envoi" },
  { icon: BarChart3, label: "Analytics" },
  { icon: Globe, label: "Domaines" },
  { icon: Server, label: "IPs dédiées" },
  { icon: ShieldAlert, label: "Réputation" },
  { icon: MailCheck, label: "Validation" },
  { icon: Webhook, label: "Webhooks" },
  { icon: KeyRound, label: "Clés API" },
  { icon: Settings, label: "Paramètres" },
];

const stats = [
  { label: "Envoyés", value: "0", sub: "30 derniers jours" },
  { label: "Délivrés", value: "—", sub: "taux de délivrabilité" },
  { label: "Rebonds", value: "—", sub: "hard + soft" },
  { label: "Plaintes", value: "—", sub: "spam reports" },
];

const steps = [
  { t: "Ajouter un domaine d'envoi", d: "Configurez SPF, DKIM et DMARC." },
  { t: "Choisir vos IPs", d: "Partagée ou dédiée, selon votre volume." },
  { t: "Créer une clé API", d: "Pour envoyer via REST ou SMTP." },
  { t: "Envoyer votre premier email", d: "Testez depuis le tableau de bord." },
];

function Dashboard() {
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
      <aside className="hidden w-60 flex-col bg-sidebar p-4 md:flex">
        <div className="px-2 py-2"><Logo inverted /></div>
        <nav className="mt-8 flex-1 space-y-1">
          {nav.map((n) => (
            <button
              key={n.label}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm ${
                n.active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              }`}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </button>
          ))}
        </nav>
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/60"
        >
          <LogOut className="h-4 w-4" /> Déconnexion
        </button>
      </aside>

      <main className="flex-1">
        <header className="flex items-center justify-between border-b bg-card px-8 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Bonjour,</p>
            <h1 className="text-xl font-semibold">{name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">Plan gratuit</span>
            <Button size="sm">Mettre à niveau</Button>
          </div>
        </header>

        <div className="space-y-8 p-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-lg border bg-card p-5">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="mt-2 font-display text-3xl font-bold">{s.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-lg border bg-card p-6 lg:col-span-2">
              <h2 className="font-semibold">Démarrage rapide</h2>
              <ol className="mt-4 divide-y">
                {steps.map((s, i) => (
                  <li key={s.t} className="flex items-center gap-4 py-4">
                    <span className="grid h-8 w-8 place-items-center rounded-full border font-display text-sm">{i + 1}</span>
                    <div className="flex-1">
                      <p className="font-medium">{s.t}</p>
                      <p className="text-sm text-muted-foreground">{s.d}</p>
                    </div>
                    <Button variant="outline" size="sm">Commencer</Button>
                  </li>
                ))}
              </ol>
            </div>
            <div className="space-y-6">
              <div className="rounded-lg border bg-card p-6">
                <h2 className="font-semibold">Réputation</h2>
                <p className="mt-2 text-sm text-muted-foreground">Aucune IP ni domaine surveillé pour l'instant.</p>
                <div className="mt-4 flex items-center gap-2 text-sm">
                  <span className="h-2 w-2 rounded-full bg-success" /> Aucune alerte
                </div>
              </div>
              <div className="rounded-lg border bg-card p-6">
                <h2 className="font-semibold">Validation d'emails</h2>
                <p className="mt-2 text-sm text-muted-foreground">0 / 100 validations gratuites utilisées.</p>
                <div className="mt-3 h-2 rounded-full bg-muted"><div className="h-2 w-0 rounded-full bg-primary" /></div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
