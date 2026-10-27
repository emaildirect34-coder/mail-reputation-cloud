import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, Stat } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/validation")({
  head: () => ({ meta: [{ title: "Validation d'emails — Email Direct" }] }),
  component: Validation,
});

const disposable = ["yopmail.com", "mailinator.com", "tempmail.com"];
const roles = ["admin", "info", "contact", "support", "noreply"];

function check(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { tone: "bad" as const, label: "Syntaxe invalide" };
  const [u = "", d = ""] = email.toLowerCase().split("@");
  if (disposable.includes(d)) return { tone: "bad" as const, label: "Jetable" };
  if (roles.includes(u)) return { tone: "warn" as const, label: "Adresse générique" };
  return { tone: "ok" as const, label: "Valide (démo)" };
}

function Validation() {
  const [email, setEmail] = useState("");
  const [res, setRes] = useState<ReturnType<typeof check> | null>(null);
  return (
    <>
      <PageHeader title="Validation d'emails" desc="Nettoyez vos listes avant l'envoi." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Validations ce mois" value="0 / 100" />
        <Stat label="Taux valides" value="—" />
        <Stat label="Listes traitées" value="0" />
      </div>
      <Panel title="Vérifier une adresse">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); setRes(check(email)); }}>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@exemple.com" />
          <Button type="submit">Vérifier</Button>
        </form>
        {res && <div className="mt-3"><Pill tone={res.tone}>{res.label}</Pill></div>}
      </Panel>
      <Panel title="Validation en masse">
        <div className="grid place-items-center rounded-lg border-2 border-dashed p-10 text-center">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="mt-2 font-medium">Glissez un fichier CSV ici</p>
          <p className="text-sm text-muted-foreground">Jusqu'à 1 million d'adresses</p>
          <Button className="mt-4" variant="outline">Choisir un fichier</Button>
        </div>
      </Panel>
    </>
  );
}
