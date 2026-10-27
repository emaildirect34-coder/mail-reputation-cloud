import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, DataTable } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/logs")({
  head: () => ({ meta: [{ title: "Logs d'envoi — Email Direct" }] }),
  component: Logs,
});

const events = [
  { t: "03:41:12", ev: "Délivré", to: "marie@gmail.com", subj: "Votre commande #1042" },
  { t: "03:40:58", ev: "Ouvert", to: "paul@outlook.fr", subj: "Bienvenue !" },
  { t: "03:40:31", ev: "Rebond dur", to: "inconnu@domaine.xyz", subj: "Newsletter octobre" },
  { t: "03:39:47", ev: "Cliqué", to: "lea@yahoo.fr", subj: "Promo -20%" },
  { t: "03:39:02", ev: "Plainte", to: "jean@hotmail.com", subj: "Promo -20%" },
];
const tone = (e: string) => (e === "Rebond dur" || e === "Plainte" ? "bad" : e === "Délivré" ? "ok" : "neutral");
const filters = ["Tous", "Délivré", "Ouvert", "Cliqué", "Rebond dur", "Plainte"];

function Logs() {
  const [f, setF] = useState("Tous");
  const [q, setQ] = useState("");
  const rows = events.filter((e) => (f === "Tous" || e.ev === f) && e.to.includes(q));
  return (
    <>
      <PageHeader title="Logs d'événements" desc="Suivi en temps réel de chaque message." />
      <Panel>
        <div className="mb-4 flex flex-wrap gap-2">
          {filters.map((x) => (
            <button key={x} onClick={() => setF(x)} className={`rounded-full border px-3 py-1 text-xs ${f === x ? "bg-primary text-primary-foreground" : ""}`}>{x}</button>
          ))}
          <Input className="ml-auto max-w-xs" placeholder="Rechercher un destinataire" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <DataTable cols={["Heure", "Événement", "Destinataire", "Sujet"]} rows={rows.map((e) => [e.t, <Pill tone={tone(e.ev)}>{e.ev}</Pill>, e.to, e.subj])} />
      </Panel>
    </>
  );
}
