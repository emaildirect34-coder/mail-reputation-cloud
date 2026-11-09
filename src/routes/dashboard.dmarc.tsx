import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, Pill, Stat } from "@/components/dash/kit";
import { listDmarc, importDmarc } from "@/lib/dmarc.functions";
import { advice, classify, type DmarcRecord, type SourceKind } from "@/lib/dmarc";

export const Route = createFileRoute("/dashboard/dmarc")({
  head: () => ({
    meta: [
      { title: "Rapports DMARC — Email Direct" },
      { name: "description", content: "Analyse des rapports DMARC agrégés de Google, Microsoft et Yahoo." },
      { property: "og:title", content: "Rapports DMARC — Email Direct" },
      { property: "og:description", content: "Alignement SPF/DKIM et détection d'usurpation par IP source." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dmarc,
});

async function readFile(f: File): Promise<string> {
  if (/\.gz$/i.test(f.name)) {
    const s = f.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(s).text();
  }
  if (/\.zip$/i.test(f.name)) throw new Error(`${f.name} : décompressez le .zip puis importez le .xml`);
  return await f.text();
}

const KIND: Record<SourceKind, { label: string; tone: string }> = {
  own: { label: "Votre serveur", tone: "ok" },
  forwarder: { label: "Tiers authentifié", tone: "info" },
  spoof: { label: "Usurpation", tone: "bad" },
};

function Dmarc() {
  const list = useServerFn(listDmarc);
  const imp = useServerFn(importDmarc);
  const q = useQuery({ queryKey: ["dmarc"], queryFn: () => list() });
  const [domain, setDomain] = useState("all");
  const up = useMutation({
    mutationFn: async (files: File[]) => imp({ data: { xml: await Promise.all(files.map(readFile)) } }),
    onSuccess: (r) => { toast.success(`${r.ok} rapport(s) importé(s)`); r.errors.forEach((e) => toast.error(e)); q.refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import impossible"),
  });

  const reports = (q.data?.reports ?? []).filter((r: any) => domain === "all" || r.domain === domain);
  const domains = [...new Set((q.data?.reports ?? []).map((r: any) => r.domain as string))];
  const own = useMemo(() => new Set(q.data?.ownIps ?? []), [q.data]);
  const total = reports.reduce((n: number, r: any) => n + r.total, 0);
  const passed = reports.reduce((n: number, r: any) => n + r.passed, 0);

  const sources = useMemo(() => {
    const m = new Map<string, { r: DmarcRecord; policy: string; domain: string; orgs: Set<string> }>();
    for (const rep of reports as any[]) for (const r of rep.records as DmarcRecord[]) {
      const k = `${rep.domain}|${r.ip}|${r.spf}|${r.dkim}`;
      const cur = m.get(k);
      if (cur) { cur.r = { ...cur.r, count: cur.r.count + r.count }; cur.orgs.add(rep.org_name); }
      else m.set(k, { r: { ...r }, policy: rep.policy, domain: rep.domain, orgs: new Set([rep.org_name]) });
    }
    return [...m.values()].map((s) => ({ ...s, kind: classify(s.r, own) })).sort((a, b) => b.r.count - a.r.count);
  }, [reports, own]);
  const spoof = sources.filter((s) => s.kind === "spoof").reduce((n, s) => n + s.r.count, 0);

  return (
    <>
      <PageHeader title="Rapports DMARC" desc="Ce que Google, Microsoft, Yahoo… voient réellement passer avec vos domaines." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="E-mails audités" value={total.toLocaleString("fr-FR")} sub={`${reports.length} rapport(s)`} />
        <Stat label="Conformité DMARC" value={total ? `${Math.round((passed / total) * 100)} %` : "—"} />
        <Stat label="Sources" value={String(sources.length)} sub={`${sources.filter((s) => s.kind === "own").length} serveurs à vous`} />
        <Stat label="Usurpations" value={spoof.toLocaleString("fr-FR")} sub="e-mails non authentifiés" />
      </div>

      <Panel title="Importer des rapports">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground hover:bg-muted/40">
          <Upload className="h-5 w-5" />
          {up.isPending ? "Analyse en cours…" : "Choisissez vos fichiers .xml ou .xml.gz reçus sur votre adresse rua="}
          <input type="file" multiple accept=".xml,.gz,.zip" className="hidden" onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) up.mutate(f); e.target.value = ""; }} />
        </label>
        {domains.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {["all", ...domains].map((d) => (
              <button key={d} onClick={() => setDomain(d)} className={`rounded-full border px-3 py-1 text-xs ${domain === d ? "bg-primary text-primary-foreground" : "border-border"}`}>{d === "all" ? "Tous" : d}</button>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Sources d'envoi">
        {q.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : !sources.length ? (
          <p className="text-sm text-muted-foreground">Aucun rapport pour l'instant. Importez un fichier pour voir qui envoie avec vos domaines.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {sources.map((s, i) => (
              <div key={i} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-medium">{s.r.ip}</span>
                  <Pill tone={KIND[s.kind].tone as any}>{KIND[s.kind].label}</Pill>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{s.domain} · {s.r.count.toLocaleString("fr-FR")} e-mails · vu par {[...s.orgs].join(", ")}</div>
                <div className="mt-2 flex gap-2">
                  <Pill tone={s.r.spf === "pass" ? "ok" : "bad"}>SPF {s.r.spf}</Pill>
                  <Pill tone={s.r.dkim === "pass" ? "ok" : "bad"}>DKIM {s.r.dkim}</Pill>
                  <Pill>{s.r.disposition}</Pill>
                </div>
                <p className="mt-2 text-xs">{advice(s.r, s.kind, s.policy)}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
