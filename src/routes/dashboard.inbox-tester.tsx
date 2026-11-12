import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, FlaskConical, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { placementHistory, placementNew, placementResult, type PlacementSeed } from "@/lib/ops.functions";

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
  const fNew = useServerFn(placementNew), fRes = useServerFn(placementResult), fHistory = useServerFn(placementHistory);
  const history = useQuery({ queryKey: ['placement-history'], queryFn: () => fHistory(), refetchInterval: 60000 });
  const [test, setTest] = useState<Test | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (id: string) => {
    try {
      const r = await fRes({ data: { id } });
      if (r.error) setError(r.error);
      else if (r.result) { setError(null); setTest(current => current?.id === id ? r.result : current); void history.refetch(); }
    } catch {
      setError("Impossible d’actualiser le test. Réessayez dans quelques instants.");
    }
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
      else { setTest(r.test); void history.refetch(); }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Impossible de créer le test.";
      setError(message.startsWith("Mail-Tester 409:") ? "Ajoutez une boîte témoin dans Paramètres → Boîtes témoins Gmail." : message);
    } finally { setBusy(false); }
  };

  const seeds = test?.seeds ?? [];
  const done = seeds.filter((s) => s.placement !== "pending");
  const pct = (p: PlacementSeed["placement"]) => (done.length ? Math.round((done.filter((s) => s.placement === p).length / done.length) * 100) : 0);
  const copy = (t: string) => { void navigator.clipboard.writeText(t); toast.success("Copié"); };

  return (
    <>
      <PageHeader title="Testeur de placement Inbox" desc="Envoyez votre email aux boîtes témoins et voyez où il arrive vraiment." action={<Button disabled={busy} onClick={() => void start()}><FlaskConical className="h-4 w-4" /> Nouveau test</Button>} />
      <Button variant="outline" asChild><Link to="/dashboard/settings">Paramètres des boîtes témoins</Link></Button>
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
      <Panel title="Tendances historiques des boîtes témoins">
        {history.data === null ? <p className="text-sm text-muted-foreground">Appliquez la migration 0086 pour conserver l’historique des tests.</p> : history.isPending ? <p className="text-sm text-muted-foreground">Chargement de l’historique…</p> : history.error ? <p role="alert" className="text-sm text-destructive">{history.error.message}</p> : !history.data?.total ? <p className="text-sm text-muted-foreground">Les tendances apparaîtront après le premier test.</p> : <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Résultats observés dans les boîtes témoins des 100 derniers tests. Ils indiquent uniquement le placement de ces adresses de test.</p>
          <DataTable cols={["Fournisseur", "Observations", "Réception", "Promotions", "Spam", "Non reçu"]} rows={history.data.providers.map(row => {
            const completed = row.observations - row.pending, percent = (n: number) => completed ? `${Math.round(n / completed * 100)} %` : '—';
            return [row.provider, String(row.observations), percent(row.inbox), percent(row.promotions), percent(row.spam), percent(row.missing)];
          })} />
          <DataTable cols={["Test", "Date", "État", "Boîtes en réception", "Spam", "Non reçu"]} rows={history.data.runs.slice(0, 10).map(run => [
            <code className="text-xs">{run.id}</code>, new Date(run.started_at).toLocaleString('fr-FR'), run.status === 'done' ? 'Terminé' : 'En cours',
            String(run.counts.inbox + run.counts.promotions), String(run.counts.spam), String(run.counts.missing),
          ])} />
        </div>}
      </Panel>
    </>
  );
}
