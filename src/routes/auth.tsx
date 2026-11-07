import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";

type Search = { mode?: "login" | "signup" };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    mode: "login",
  }),
  head: () => ({
    meta: [
      { title: "Connexion — Email Direct" },
      { name: "description", content: "Connectez-vous ou créez votre compte Email Direct." },
      { property: "og:title", content: "Connexion — Email Direct" },
      { property: "og:description", content: "Accédez à votre tableau de bord d'envoi d'emails." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const isSignup = mode === "signup";
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate({ to: "/dashboard" });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setLoading(true);
    if (isSignup) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + "/dashboard",
          data: { full_name: f.get("full_name"), company: f.get("company") },
        },
      });
      if (error) toast.error(error.message);
      else setSent(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error("Email ou mot de passe incorrect");
    }
    setLoading(false);
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error("Connexion Google impossible");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-12 lg:flex">
        <Logo inverted />
        <div>
          <h2 className="text-4xl font-bold text-ink-foreground">L'infrastructure email qui délivre.</h2>
          <p className="mt-4 text-ink-foreground/70">IPs dédiées, réputation surveillée, validation intégrée.</p>
        </div>
        <p className="text-sm text-ink-foreground/50">© 2026 Email Direct</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          {sent ? (
            <div>
              <h1 className="text-2xl font-bold">Vérifiez votre email</h1>
              <p className="mt-2 text-muted-foreground">Nous vous avons envoyé un lien de confirmation pour activer votre compte.</p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold">{isSignup ? "Créer un compte" : "Connexion"}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {isSignup ? "Commencez gratuitement, sans carte bancaire." : "Bon retour parmi nous."}
              </p>
              <Button variant="outline" className="mt-6 w-full" onClick={google} type="button">
                Continuer avec Google
              </Button>
              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> ou <div className="h-px flex-1 bg-border" />
              </div>
              <form onSubmit={onSubmit} className="space-y-4">
                {isSignup && (
                  <>
                    <div className="space-y-1.5"><Label htmlFor="full_name">Nom complet</Label><Input id="full_name" name="full_name" required /></div>
                    <div className="space-y-1.5"><Label htmlFor="company">Entreprise</Label><Input id="company" name="company" /></div>
                  </>
                )}
                <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
                <div className="space-y-1.5"><Label htmlFor="password">Mot de passe</Label><Input id="password" name="password" type="password" minLength={8} required /></div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "…" : isSignup ? "Créer mon compte" : "Se connecter"}
                </Button>
              </form>
              <p className="mt-6 text-center text-xs text-muted-foreground">Accès sur invitation uniquement.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
