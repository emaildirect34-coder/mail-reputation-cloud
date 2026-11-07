import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/set-password")({
  head: () => ({
    meta: [
      { title: "Créer votre mot de passe — Email Direct" },
      { name: "description", content: "Activez votre accès Email Direct en choisissant votre mot de passe." },
      { property: "og:title", content: "Créer votre mot de passe — Email Direct" },
      { property: "og:description", content: "Activez votre invitation Email Direct." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetPassword,
});

function SetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { if (s) setReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p = String(f.get("password"));
    if (p !== String(f.get("confirm"))) { toast.error("Les mots de passe ne correspondent pas"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: p });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Mot de passe créé");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8"><Logo /></div>
        <h1 className="text-2xl font-bold">Créez votre mot de passe</h1>
        {!ready ? (
          <p className="mt-2 text-sm text-muted-foreground">Ouvrez cette page depuis le lien reçu par email. Le lien a peut-être expiré : demandez une nouvelle invitation.</p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5"><Label htmlFor="password">Mot de passe</Label><Input id="password" name="password" type="password" minLength={8} required /></div>
            <div className="space-y-1.5"><Label htmlFor="confirm">Confirmer</Label><Input id="confirm" name="confirm" type="password" minLength={8} required /></div>
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "…" : "Activer mon compte"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
