import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, DataTable, Stat, Bar } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/inbox-tester")({
  head: () => ({ meta: [{ title: "Testeur de délivrabilité — Email Direct" }] }),
  component: InboxTester,
});

const seeds = [
  { provider: "Gmail", address: "ed.test.gmail@gmail.com", placement: "Boîte de réception", tone: "ok" },
  { provider: "Gmail (onglet Promo)", address: "ed.test.g2@gmail.com", placement: "Promotions", tone: "warn" },
  { provider: "Outlook / Hotmail", address: "ed.test@outlook.com", placement: "Boîte de réception", tone: "ok" },
  { provider: "Yahoo", address: "ed.test@yahoo.com", placement: "Spam", tone: "bad" },
  { provider: "Proton", address: "ed.test@proton.me", placement: "Boîte de réception", tone: "ok" },
  { provider: "iCloud", address: "ed.test@icloud.com", placement: "En attente…", tone: "neutral" },
] as const;

function InboxTester() {
  return (
    <>
      <PageHeader
        title="Testeur de délivrabilité"
        desc="Envoyez un email de test vers 20 adresses témoins et voyez où il atterrit réellement : inbox, promotions ou spam."
        action={<Button><Send className="h-4 w-4" /> Lancer un test</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Score SpamAssassin" value="1.8 / 10" sub="Excellent (< 5 requis)" />
        <Stat label="Placement inbox" value="83 %" sub="5 / 6 boîtes répondues" />
        <Stat label="Dernier test" value="il y a 2 h" sub="Campagne « Newsletter Oct »" />
      </div>

      <Panel title="Nouveau test">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground">Serveur d'envoi</label>
            <Input defaultValue="srv-paris-01 (203.0.113.10)" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Objet du test</label>
            <Input placeholder="Objet de votre email…" />
          </div>
        </div>
        <Button className="mt-3"><FlaskConical className="h-4 w-4" /> Générer les 20 adresses témoins</Button>
      </Panel>

      <Panel title="Résultats du dernier test">
        <DataTable
          cols={["Fournisseur", "Adresse témoin", "Placement"]}
          rows={seeds.map((s) => [
            <span className="font-medium">{s.provider}</span>,
            <code className="text-xs">{s.address}</code>,
            s.tone === "ok" ? <Pill tone="ok">{s.placement}</Pill> : s.tone === "warn" ? <Pill tone="warn">{s.placement}</Pill> : s.tone === "bad" ? <Pill tone="bad">{s.placement}</Pill> : <Pill>{s.placement}</Pill>,
          ])}
        />
      </Panel>

      <Panel title="Analyse du contenu">
        <div className="space-y-3">
          <div><div className="mb-1 flex justify-between text-xs"><span>Authentification (SPF/DKIM/DMARC)</span><span>100 %</span></div><Bar value={100} /></div>
          <div><div className="mb-1 flex justify-between text-xs"><span>Ratio texte / HTML</span><span>78 %</span></div><Bar value={78} /></div>
          <div><div className="mb-1 flex justify-between text-xs"><span>Mots à risque détectés</span><span>35 %</span></div><Bar value={35} /></div>
          <div><div className="mb-1 flex justify-between text-xs"><span>Liens raccourcis / suspects</span><span>10 %</span></div><Bar value={10} /></div>
        </div>
      </Panel>
    </>
  );
}
