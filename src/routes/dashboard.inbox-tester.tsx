import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, FlaskConical, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { placementNew, placementResult, type PlacementSeed } from "@/lib/ops.functions";

export const Route = createFileRoute("/dashboard/inbox-tester")({
  head: () => ({
    meta: [
      { title: "Testeur de placement Inbox — Email Direct" },
      { name: "description", content: "Voyez où votre email atterrit chez Gmail, Outlook, Yahoo, Orange : réception, promotions ou spam." },
      { property: "og:title", content: "Testeur de placement Inbox — Email Direct" },
      { property: "og:description", content: "Placement réel sur des boîtes témoins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InboxTester,
});

const LABEL: Record<PlacementSeed["placement"], [string, "ok" | "warn" | "bad" | "neutral"]> = {
  inbox: ["Boîte de réception", "ok"],
  promotions: ["Promotions", "warn"],
  spam: ["Spam", "bad"],
  missing: ["Non reçu", "bad"],
  pending: ["En attente…", "neutral"],
};

type Test = { id: string; token: string; seeds: PlacementSeed[]; status?: string };

function InboxTester() {
  const fNew = useServerFn(placementNew), fRes = useServerFn(placementResult);
  const [test, setTest] = useState<Test | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (id: string) => {
    const r = await fRes({ data: { id } });
    if (r.error) setError(r.error);
    else if (r.result) { setError(null); setTest(r.result); }
  };
  useEffect(() => {
    if (!test || test.status === "done") return;
    const t = setInterval(() => void refresh(test.id), 20000);
    return () => clearInterval(t);
  }, [test?.id, test?.status]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fNew();
      if (!r.configured || !r.test) setError("Le serveur Mail-Tester n'est pas connecté.");
      else setTest(r.test);
    } catch (e) {
      setError((e as Error).message.includes("404") ? "Le serveur Mail-Tester ne gère pas encore le test de placement (cahier des charges §4 à livrer par Codex)." : (e as Error).message);
    } finally { setBusy(false); }
  };

  const seeds = test?.seeds ?? [];
  const done = seeds.filter((s) => s.placement !== "pending");
  const pct = (p: PlacementSeed["placement"]) => (done.length ? Math.round((done.filter((s) => s.placement === p).length / done.length) * 100) : 0);
  const copy = (t: string) => { void navigator.clipboard.writeText(t); toast.success("Copié"); };

  return (
    <>
      <PageHeader title="Testeur de placement Inbox" desc="Envoyez votre email aux boîtes témoins et voyez où il arrive vraiment." action={<Button disabled={busy} onClick={() => void start()}><FlaskConical className="h-4 w-4" /> Nouveau test</Button>} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Boîte de réception" value={done.length ? `${pct("inbox")} %` : "—"} />
        <Stat label="Promotions" value={done.length ? `${pct("promotions")} %` : "—"} />
        <Stat label="Spam / non reçu" value={done.length ? `${pct("spam") + pct("missing")} %` : "—"} />
        <Stat label="Boîtes répondues" value={`${done.length} / ${seeds.length}`} />
      </div>
      {error && <Panel><p role="alert" className="text-sm text-destructive">{error}</p></Panel>}

      {test ? (
        <>
          <Panel title="1. Envoyez votre email">
            <p className="text-sm text-muted-foreground">Mettez ce code dans l'objet ou le texte de l'email, puis envoyez-le depuis votre serveur à toutes les adresses ci-dessous.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-3 py-1.5 text-lg font-semibold">{test.token}</code>
              <Button size="sm" variant="outline" onClick={() => copy(test.token)}><Copy className="h-3 w-3" /> Copier le code</Button>
              <Button size="sm" variant="outline" onClick={() => copy(seeds.map((s) => s.address).join(", "))}><Copy className="h-3 w-3" /> Copier les adresses</Button>
            </div>
          </Panel>
          <Panel title="2. Résultats" action={<Button size="sm" variant="outline" onClick={() => void refresh(test.id)}><RefreshCw className="h-3 w-3" /> Actualiser</Button>}>
            <DataTable
              cols={["Fournisseur", "Adresse témoin", "Placement", "Reçu"]}
              rows={seeds.map((s) => [
                <span className="font-medium">{s.provider}</span>,
                <code className="text-xs">{s.address}</code>,
                <Pill tone={LABEL[s.placement][1]}>{LABEL[s.placement][0]}</Pill>,
                s.received_at ? new Date(s.received_at).toLocaleTimeString("fr-FR") : "—",
              ])}
            />
            <p className="mt-2 text-xs text-muted-foreground">{test.status === "done" ? "Test terminé." : "Mise à jour automatique toutes les 20 secondes."}</p>
          </Panel>
        </>
      ) : (
        <Panel><p className="text-sm text-muted-foreground">Cliquez sur « Nouveau test » pour recevoir la liste des boîtes témoins et votre code de test.</p></Panel>
      )}
    </>
  );
}
