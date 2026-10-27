import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Pill, DataTable, Bar, Stat } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/ips")({
  head: () => ({ meta: [{ title: "IPs & Warmup — Email Direct" }] }),
  component: Ips,
});

const ips = [
  { ip: "203.0.113.10", pool: "Transactionnel", type: "Dédiée", day: 30, limit: "100 000" },
  { ip: "203.0.113.11", pool: "Transactionnel", type: "Dédiée", day: 18, limit: "20 000" },
  { ip: "203.0.113.24", pool: "Marketing", type: "Dédiée", day: 6, limit: "2 000" },
  { ip: "198.51.100.4", pool: "Partagé", type: "Partagée", day: 30, limit: "—" },
];
const curve = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 40000, 70000, 100000];

function Ips() {
  const max = curve[curve.length - 1];
  return (
    <>
      <PageHeader title="IPs & Warmup" desc="Pools d'envoi et chauffe progressive de vos IPs." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Transactionnel" value="2 IPs" />
        <Stat label="Marketing" value="1 IP" />
        <Stat label="Partagé" value="1 IP" />
      </div>
      <Panel title="Adresses IP">
        <DataTable
          cols={["IP", "Pool", "Type", "Warmup", "Limite / jour"]}
          rows={ips.map((i) => [
            <code>{i.ip}</code>, i.pool, <Pill tone={i.type === "Dédiée" ? "ok" : "neutral"}>{i.type}</Pill>,
            <div className="w-32"><div className="mb-1 text-xs">Jour {i.day}/30</div><Bar value={(i.day / 30) * 100} /></div>, i.limit,
          ])}
        />
      </Panel>
      <Panel title="Plan de warmup (emails / jour)">
        <div className="flex h-48 items-end gap-2">
          {curve.map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
              <span className="text-[10px] text-muted-foreground">J{i * 3 + 1}</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
