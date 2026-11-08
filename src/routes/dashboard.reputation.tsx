import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw, Search, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { scanReputation } from "@/lib/reputation.functions";

export const Route = createFileRoute("/dashboard/reputation")({
  head: () => ({
    meta: [
      { title: "Réputation & Blacklists — Email Direct" },
      { name: "description", content: "Scan en direct de vos IPs et domaines sur les principales listes noires." },
      { property: "og:title", content: "Réputation & Blacklists — Email Direct" },
      { property: "og:description", content: "Surveillance réelle des IPs et domaines d'envoi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reputation,
});

function Reputation() {
  const scan = useServerFn(scanReputation);
  const [input, setInput] = useState("");
  const m = useMutation({
    mutationFn: (targets?: string[]) => scan({ data: { targets } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scan impossible"),
  });
  const scans = m.data?.scans ?? [];
  const listedTargets = scans.filter((s) => s.listed > 0);
  const checks = scans.reduce((n, s) => n + s.results.length, 0);
  const clean = scans.reduce((n, s) => n + s.results.filter((r) => r.status === "clean").length, 0);
  const health = checks ? Math.round((clean / checks) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Réputation & Blacklists"
        desc="Interrogation en direct de 10 listes noires d'IP et 3 listes de domaines."
        action={<Button disabled={m.isPending} onClick={() => m.mutate(undefined)}><RefreshCw className={`h-4 w-4 ${m.isPending ? "animate-spin" : ""}`} /> Scanner toute mon infrastructure</Button>}
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Score de santé" value={checks ? `${health} / 100` : "—"} sub={m.data ? `Scan ${new Date(m.data.scannedAt).toLocaleTimeString("fr-FR")}` : "Lancez un scan"} />
        <Stat label="Cibles scannées" value={String(scans.length)} />
        <Stat label="Vérifications" value={String(checks)} />
        <Stat label="Cibles listées" value={String(listedTargets.length)} sub={listedTargets.map((s) => s.target).join(", ") || "Aucune"} />
      </div>

      <Panel title="Vérifier une IP ou un domaine">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); const t = input.split(/[\s,]+/).filter(Boolean); if (t.length) m.mutate(t); }}>
          <Input aria-label="IP ou domaine" placeholder="203.0.113.10, monsite.fr" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button disabled={m.isPending}><Search className="h-4 w-4" /> Scanner</Button>
        </form>
      </Panel>

      {m.isPending && <Panel><p className="text-sm text-muted-foreground">Interrogation des listes noires en cours…</p></Panel>}
      {!m.isPending && m.data && !scans.length && <Panel><p className="text-sm text-muted-foreground">Aucune IP ni domaine enregistré à scanner.</p></Panel>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {scans.map((s) => (
          <Panel key={s.target} title={`${s.kind === "ip" ? "IP" : "Domaine"} — ${s.target}`} action={<Pill tone={s.listed ? "bad" : "ok"}>{s.listed ? `${s.listed} listée(s)` : "Propre"}</Pill>}>
            <DataTable
              cols={["Liste", "Statut", ""]}
              rows={s.results.map((r) => [
                r.list,
                r.status === "listed" ? <Pill tone="bad">Listée {r.code}</Pill> : r.status === "clean" ? <Pill tone="ok">Propre</Pill> : <Pill tone="warn">Non vérifiable</Pill>,
                r.status === "listed" ? <a className="inline-flex items-center gap-1 text-sm text-primary underline" href={r.delist} target="_blank" rel="noreferrer">Délister <ExternalLink className="h-3 w-3" /></a> : "",
              ])}
            />
          </Panel>
        ))}
      </div>

      <Panel title="À savoir">
        <p className="text-sm text-muted-foreground">« Non vérifiable » signifie que la liste refuse les requêtes publiques (cas fréquent de Spamhaus sans clé DQS) : ce n'est pas un listage. Pour une IP listée, corrigez d'abord la cause (plaintes, pièges à spam) puis cliquez sur « Délister ».</p>
      </Panel>
    </>
  );
}
