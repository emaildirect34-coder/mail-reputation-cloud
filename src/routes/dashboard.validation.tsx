import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Upload, Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Panel, Pill, Stat, DataTable } from "@/components/dash/kit";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { toast } from "sonner";
import { validateEmails, listsForCleaning, cleanList, type Verdict } from "@/lib/validation.functions";

export const Route = createFileRoute("/dashboard/validation")({
  head: () => ({ meta: [
    { title: "Validation d'emails — Email Direct" },
    { name: "description", content: "Vérifiez syntaxe, domaine, MX, adresses jetables et suppressions avant l'envoi." },
    { property: "og:title", content: "Validation d'emails — Email Direct" },
    { property: "og:description", content: "Nettoyez vos listes avant chaque campagne." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Validation,
});

const tone = { valid: "ok", risky: "warn", invalid: "bad" } as const;
const label = { valid: "Valide", risky: "Risquée", invalid: "Invalide" } as const;
type L = { id: string; name: string; total: number; active: number; invalid: number };

function Validation() {
  const run = useServerFn(validateEmails);
  const readLists = useServerFn(listsForCleaning);
  const clean = useServerFn(cleanList);
  const [text, setText] = useState("");
  const [res, setRes] = useState<Verdict[]>([]);
  const [busy, setBusy] = useState(false);
  const [lists, setLists] = useState<L[]>([]);
  const [cleaning, setCleaning] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const loadLists = () => readLists().then(r => setLists(r.lists)).catch(e => toast.error(e.message));
  useEffect(() => { loadLists(); }, []);

  const counts = useMemo(() => ({
    valid: res.filter(r => r.status === "valid").length,
    risky: res.filter(r => r.status === "risky").length,
    invalid: res.filter(r => r.status === "invalid").length,
  }), [res]);

  const check = async (raw: string) => {
    const emails = Array.from(new Set(raw.split(/[\s,;]+/).map(s => s.trim()).filter(s => s.includes("@")))).slice(0, 5000);
    if (!emails.length) { toast.error("Aucune adresse détectée"); return; }
    setBusy(true);
    try { setRes((await run({ data: { emails } })).results); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const exportCsv = () => {
    const csv = "email,statut,raison,suggestion\n" + res.map(r => [r.email, label[r.status], r.reason, r.suggestion ?? ""].map(v => `"${v}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "validation.csv"; a.click();
  };

  const doClean = async (l: L) => {
    setCleaning(l.id);
    try {
      const r = await clean({ data: { listId: l.id } });
      toast.success(`${r.checked} vérifiées · ${r.invalid} retirées des envois · ${r.risky} risquées`);
      loadLists();
    } catch (e: any) { toast.error(e.message); }
    finally { setCleaning(null); }
  };

  const rate = res.length ? Math.round((counts.valid / res.length) * 100) : null;

  return (
    <>
      <PageHeader title="Validation d'emails" desc="Syntaxe, fautes de frappe, domaine et MX réels, adresses jetables, rôles et liste de suppression." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Vérifiées" value={String(res.length)} />
        <Stat label="Valides" value={String(counts.valid)} {...(rate == null ? {} : { sub: `${rate} %` })} />
        <Stat label="Risquées" value={String(counts.risky)} />
        <Stat label="Invalides" value={String(counts.invalid)} />
      </div>

      <Panel title="Vérifier des adresses" action={<Pill>Jusqu'à 5 000 par lot</Pill>}>
        <Textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder={"client@exemple.com\nautre@gmial.com"} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => check(text)}><Sparkles className="mr-1 h-4 w-4" />{busy ? "Vérification…" : "Vérifier"}</Button>
          <Button variant="outline" disabled={busy} onClick={() => file.current?.click()}><Upload className="mr-1 h-4 w-4" />Importer un CSV</Button>
          <input ref={file} type="file" accept=".csv,.txt" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) check(await f.text()); e.target.value = ""; }} />
          {res.length > 0 && <Button variant="outline" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />Exporter le rapport</Button>}
        </div>
      </Panel>

      {res.length > 0 && (
        <Panel title="Résultats">
          <DataTable cols={["Adresse", "Statut", "Raison", "Suggestion"]} rows={res.slice(0, 500).map(r => [
            r.email, <Pill tone={tone[r.status]}>{label[r.status]}</Pill>, r.reason, r.suggestion ?? "—",
          ])} />
          {res.length > 500 && <p className="mt-2 text-xs text-muted-foreground">500 premières lignes affichées — exportez le rapport pour tout voir.</p>}
        </Panel>
      )}

      <Panel title="Nettoyer une liste existante">
        {lists.length === 0 ? <p className="text-sm text-muted-foreground">Aucune liste de contacts pour l'instant.</p> : (
          <DataTable cols={["Liste", "Contacts", "Actifs", "Retirés", ""]} rows={lists.map(l => [
            l.name, String(l.total), String(l.active), String(l.invalid),
            <Button size="sm" variant="outline" disabled={!!cleaning || !l.active} onClick={() => doClean(l)}>{cleaning === l.id ? "Nettoyage…" : "Nettoyer"}</Button>,
          ])} />
        )}
        <p className="mt-2 text-xs text-muted-foreground">Les adresses invalides sont retirées des prochains envois ; les adresses risquées restent actives.</p>
      </Panel>
      <StatusBar>Validation réelle · vérification MX en direct</StatusBar>
    </>
  );
}
