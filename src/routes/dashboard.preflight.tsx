import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/preflight")({
  head: () => ({ meta: [
    { title: "Pre-Flight Gate — Email Direct" },
    { name: "description", content: "Contrôle avant envoi : authentification, contenu, liens, liste et score antispam." },
    { property: "og:title", content: "Pre-Flight Gate — Email Direct" },
    { property: "og:description", content: "Vérifications automatiques avant chaque campagne." },
  ] }),
  component: Preflight,
});

const checks: [string, string, "ok" | "warn" | "bad", string][] = [
  ["Authentification", "SPF, DKIM (2 sélecteurs), DMARC alignés", "ok", "OK"],
  ["ARC / MTA-STS", "Signature ARC et politique MTA-STS actives", "ok", "OK"],
  ["List-Unsubscribe", "Header RFC 8058 one-click présent", "ok", "OK"],
  ["Liens", "1 domaine raccourci détecté (bit.ly)", "warn", "Remplacer"],
  ["Ratio texte/HTML", "18 % texte — recommandé > 30 %", "warn", "Améliorer"],
  ["Blocklists URL", "Aucun lien listé (Spamhaus DBL, SURBL)", "ok", "OK"],
  ["Liste", "2,4 % d'adresses non validées", "bad", "Valider"],
  ["Poids HTML", "84 Ko (limite Gmail 102 Ko)", "ok", "OK"],
];

function Preflight() {
  return (
    <>
      <PageHeader title="Pre-Flight Delivery Gate" desc="Chaque campagne passe ces contrôles avant d'atteindre la file KumoMTA." action={<Button onClick={() => toast("Analyse complète relancée sur 8 contrôles.")}>Relancer l'analyse</Button>} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Score global" value="82 / 100" /><Stat label="SpamAssassin" value="1,4" sub="Seuil 5,0" />
        <Stat label="Bloquants" value="1" /><Stat label="Avertissements" value="2" />
      </div>
      <Panel title="Campagne : Black Friday — segment Engagés 0-14j">
        <DataTable cols={["Contrôle", "Détail", "Résultat", "Action"]}
          rows={checks.map(([c, d, t, a]) => [c, d, <Pill tone={t}>{t === "ok" ? "Validé" : t === "warn" ? "Attention" : "Bloquant"}</Pill>,
            t === "ok" ? <span className="text-muted-foreground">—</span> : <Button size="sm" variant="outline" onClick={() => toast(`Correction « ${a} » appliquée au brouillon.`)}>{a}</Button>])} />
      </Panel>
      <div className="space-y-3">
        <Panel title="Seed test (placement prévu)">
          <DataTable cols={["FAI", "Inbox", "Promotions", "Spam"]} rows={[["Gmail", "78 %", "20 %", "2 %"], ["Outlook", "91 %", "—", "9 %"], ["Yahoo", "95 %", "—", "5 %"]]} />
        </Panel>
        <Panel title="Décision">
          <p className="mb-4 text-sm text-muted-foreground">L'envoi est bloqué tant que les éléments bloquants ne sont pas corrigés.</p>
          <div className="flex flex-wrap gap-2"><Button disabled>Envoyer</Button><Button variant="outline" onClick={() => toast("Envoi de contrôle envoyé au segment test (5 %).")}>Envoyer au segment test (5 %)</Button></div>
        </Panel>
      </div>

      <Panel title="Actions rapides">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast("Bit.ly remplacé par votre domaine de tracking.")}>Remplacer le lien raccourci</Button>
          <Button size="sm" variant="outline" onClick={() => toast("Ratio texte / HTML relevé à 32 %.")}>Relever le ratio texte</Button>
          <Button size="sm" variant="outline" onClick={() => toast("2,4 % d'adresses envoyées en validation.")}>Valider les adresses douteuses</Button>
        </div>
      </Panel>
      <StatusBar>Score 82/100 · 1 bloquant à corriger · 2 avertissements</StatusBar>
    </>
  );
}
