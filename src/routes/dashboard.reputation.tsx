import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/reputation")({
  head: () => ({ meta: [{ title: "Réputation — Email Direct" }] }),
  component: Reputation,
});

const lists = ["Spamhaus ZEN", "Barracuda", "SpamCop", "SORBS", "UCEPROTECT L1", "Spamhaus DBL", "SURBL", "PSBL"];
const listed = new Set(["UCEPROTECT L1"]);

function Reputation() {
  return (
    <>
      <PageHeader title="Réputation & Blacklists" desc="Surveillance continue de vos IPs et domaines, avec alertes." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat label="Score de santé" value="92 / 100" sub="Très bon" />
        <Stat label="Listes surveillées" value={String(lists.length)} />
        <Stat label="Alertes actives" value="1" sub="203.0.113.24" />
      </div>

      <Panel title="Vérifier une IP ou un domaine">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="203.0.113.10 ou monsite.fr" />
          <Button onClick={() => toast("Scan lancé sur 8 listes en temps réel.")}>Scanner</Button>
        </div>
      </Panel>

      <Panel title="Résultat — 203.0.113.24">
        <DataTable cols={["Liste", "Statut"]} rows={lists.map((l) => [l, listed.has(l) ? <Pill tone="bad">Listée</Pill> : <Pill tone="ok">Propre</Pill>])} />
      </Panel>

      <Panel title="Alertes">
        <p className="text-sm text-muted-foreground">Recevez une alerte par email ou webhook dès qu'une IP ou un domaine est listé.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Alerte email configurée pour 203.0.113.24.")}>Configurer email</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Webhook d'alerte enregistré sur votre endpoint.")}>Configurer webhook</Button>
        </div>
      </Panel>

      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Demande de suppression envoyée à UCEPROTECT L1.")}>Demander le délistage</Button>
          <Button size="sm" variant="outline" onClick={() => toast("IP 203.0.113.24 isolée dans le pool Quarantaine.")}>Isoler l'IP concernée</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Scan complet relancé sur 4 IPs et 3 domaines.")}>Rescanner tout</Button>
        </div>
      </Panel>
      <StatusBar>Réputation 92/100 · 1 liste noire active · délistage en cours</StatusBar>
    </>
  );
}
