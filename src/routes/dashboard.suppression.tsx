import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload } from "lucide-react";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/suppression")({
  head: () => ({ meta: [{ title: "Suppression — Email Direct" }, { name: "description", content: "Listes de suppression MD5/SHA256 et opt-out sponsors." }] }),
  component: Suppression,
});

const lists = [
  ["Rebonds durs", "Auto", "48 210", "Clair", "Il y a 2 min"],
  ["Plaintes (FBL)", "Auto", "1 320", "Clair", "Il y a 5 min"],
  ["Désinscriptions", "Auto", "12 904", "Clair", "Il y a 1 min"],
  ["Sponsor · Offre Google", "API", "2 410 000", "MD5", "Aujourd'hui 06:00"],
  ["Sponsor · Promo Q4", "FTP", "880 500", "SHA256", "Hier 23:00"],
];

function Suppression() {
  return (
    <>
      <PageHeader title="Centre de suppression" desc="Filtrage pré-envoi ultra-rapide avec comparaison MD5 / SHA256." action={<Button onClick={() => toast("Import d'une liste de suppression ouvert.")}><Upload className="h-4 w-4" /> Importer une liste</Button>} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Adresses supprimées" value="3,35 M" /><Stat label="Listes sponsors" value="2" /><Stat label="Filtrées ce mois" value="184 220" /><Stat label="Dernière synchro" value="2 min" />
      </div>
      <Panel title="Listes">
        <DataTable cols={["Liste", "Source", "Entrées", "Format", "Mise à jour", ""]}
          rows={lists.map((l) => [...l.slice(0, 3), <Pill tone={l[3] === "Clair" ? "neutral" : "ok"}>{l[3]}</Pill>, l[4], <Button size="sm" variant="outline" onClick={() => toast(`Liste « ${l[0]} » téléchargée.`)}>Télécharger</Button>])} />
      </Panel>
      <Panel title="Ajouter une source sponsor">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Input placeholder="URL API / FTP du sponsor" />
          <select className="h-9 rounded-md border bg-background px-2 text-sm"><option>Toutes les 6 h</option><option>Quotidien</option></select>
          <Button onClick={() => toast("Source sponsor ajoutée : première synchro dans 6 h.")}>Ajouter</Button>
        </div>
      </Panel>

      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Synchronisation des 2 sources sponsors relancée.")}>Relancer la synchro sponsors</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Cache MD5 purgé : 3,35 M d'empreintes recalculées.")}>Purger le cache MD5</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Contrôle de filtrage lancé sur la liste « Engagés 0-14 j ».")}>Tester le filtrage</Button>
        </div>
      </Panel>
      <StatusBar>3,35 M d'adresses supprimées · 2 sources sponsors synchronisées</StatusBar>
    </>
  );
}
