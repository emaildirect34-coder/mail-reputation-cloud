import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Panel, Pill, DataTable, Stat } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { readShaping } from "@/lib/ops.functions";

export const Route = createFileRoute("/dashboard/shaping")({
  head: () => ({ meta: [
    { title: "Traffic Shaping FAI — Email Direct" },
    { name: "description", content: "Règles de débit KumoMTA par FAI, calculées depuis vos plans de warmup." },
    { property: "og:title", content: "Traffic Shaping FAI — Email Direct" },
    { property: "og:description", content: "Politiques de débit par FAI pour KumoMTA." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Shaping,
});

function Shaping() {
  const read = useServerFn(readShaping);
  const q = useQuery({ queryKey: ["shaping"], queryFn: () => read() });
  const d = q.data;
  const active = d?.rules.filter((r) => r.ips > 0).length ?? 0;
  return (
    <>
      <PageHeader title="Traffic Shaping FAI" desc="Mêmes règles que celles envoyées aux serveurs KumoMTA : débit horaire = quota warmup du jour ÷ 24." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="FAI limités" value={d ? String(active) : "…"} />
        <Stat label="Plans warmup" value={d ? String(d.plans.length) : "…"} />
        <Stat label="Quota total / jour" value={d ? d.rules.reduce((s, r) => s + r.daily, 0).toLocaleString("fr") : "…"} />
        <Stat label="Signaux récents" value={d ? String(d.signals.length) : "…"} />
      </div>
      {q.error && <Panel title="Erreur"><p className="text-sm text-destructive">{(q.error as Error).message}</p></Panel>}
      <Panel title="Règles par FAI">
        <DataTable cols={["FAI", "Domaines", "IPs en warmup", "Quota / jour", "Débit max", "Connexions", "Régulation auto (1 h)", "Statut"]}
          rows={(d?.rules ?? []).map((r) => [r.isp, r.domains, r.ips, r.daily.toLocaleString("fr"), r.hourly ? `${r.hourly}/h` : "Défaut KumoMTA", r.connections,
            <Pill tone={r.factor < 1 ? "bad" : "ok"}>{r.factor < 1 ? `Ralenti ×${r.factor} — ${r.reason}` : `${r.reason}${r.sample ? ` (${r.sample} év.)` : ""}`}</Pill>,
            <Pill tone={r.ips ? "warn" : "ok"}>{r.ips ? "Limité (warmup)" : "Libre"}</Pill>])} />
      </Panel>
      <Panel title="Plans warmup appliqués">
        {d && d.plans.length === 0 ? <p className="text-sm text-muted-foreground">Aucun plan — créez-en depuis la page Warmup.</p> :
        <DataTable cols={["IP", "FAI", "Jour", "Quota du jour", "Statut"]}
          rows={(d?.plans ?? []).map((p: any) => [p.address, p.isp, `${p.current_day + 1}/${p.daily_limits.length}`, (p.daily_limits[Math.min(p.current_day, p.daily_limits.length - 1)] ?? 0).toLocaleString("fr"), <Pill tone={p.status === "paused" ? "neutral" : "ok"}>{p.status}</Pill>])} />}
      </Panel>
      <Panel title="Signaux FAI (différés & rebonds)">
        {d && d.signals.length === 0 ? <p className="text-sm text-muted-foreground">Aucun signal reçu des serveurs.</p> :
        <DataTable cols={["Heure", "FAI", "Code", "Type", "Destinataire"]}
          rows={(d?.signals ?? []).map((s: any) => [new Date(s.occurred_at).toLocaleString("fr"), s.isp ?? "—", s.smtp_code ?? "—", <Pill tone={s.event_type === "bounce" ? "bad" : "warn"}>{s.event_type}</Pill>, s.recipient])} />}
      </Panel>
      <StatusBar>Règles compilées dans la configuration Lua de chaque serveur</StatusBar>
    </>
  );
}
