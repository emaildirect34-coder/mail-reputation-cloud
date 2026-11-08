import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Upload, RefreshCw, Ban } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, DataTable, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { readSending, createList, importContacts, importSuppressions } from "@/lib/sending.functions";

export const Route = createFileRoute("/dashboard/suppression")({
  head: () => ({ meta: [
    { title: "Listes & suppressions — Email Direct" },
    { name: "description", content: "Listes de contacts, import et suppression MD5 avant chaque envoi." },
    { property: "og:title", content: "Listes & suppressions — Email Direct" },
    { property: "og:description", content: "Listes de contacts, import et suppression MD5 avant chaque envoi." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Suppression,
});

const reasons: Record<string, string> = { manual: "Import manuel", unsubscribe: "Désinscriptions", bounce: "Rebonds durs", complaint: "Plaintes", sponsor: "Sponsors" };
const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function Suppression() {
  const qc = useQueryClient(), read = useServerFn(readSending), fList = useServerFn(createList), fImport = useServerFn(importContacts), fSupp = useServerFn(importSuppressions);
  const q = useQuery({ queryKey: ["sending"], queryFn: () => read() });
  const [name, setName] = useState(""), [listId, setListId] = useState(""), [contacts, setContacts] = useState(""), [supp, setSupp] = useState(""), [source, setSource] = useState("manuel"), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await qc.invalidateQueries({ queryKey: ["sending"] }); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  const file = (set: (s: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) f.text().then(set); };
  const lists = q.data?.lists ?? [], s = q.data?.suppressions ?? {}, totalSupp = Object.values(s).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title="Listes & suppressions" desc="Vos contacts et les adresses à ne jamais contacter, filtrées automatiquement avant chaque envoi." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Listes" value={String(lists.length)} /><Stat label="Plaintes FBL" value={String(s["complaint"] ?? 0)} /><Stat label="Contacts actifs" value={String(lists.reduce((a, l) => a + l.active, 0))} /><Stat label="Adresses supprimées" value={String(totalSupp)} /><Stat label="Désinscriptions" value={String(s["unsubscribe"] ?? 0)} />
      </div>
      {q.error && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
      <Panel title="Importer des contacts">
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); run(async () => { const r = await fImport({ data: { listId, text: contacts } }); toast.success(`${r.imported} contact(s) importé(s)`); setContacts(""); }); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Liste</Label><select aria-label="Liste" className={selectCls} value={listId} onChange={e => setListId(e.target.value)} required><option value="">Choisir une liste</option>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div><Label htmlFor="contacts-file">Fichier CSV (email, prénom)</Label><Input id="contacts-file" type="file" accept=".csv,.txt" onChange={file(setContacts)} /></div>
          </div>
          <div><Label htmlFor="contacts">Ou collez une adresse par ligne : email,prénom</Label><Textarea id="contacts" rows={5} value={contacts} onChange={e => setContacts(e.target.value)} placeholder={"jean@exemple.fr,Jean\nmarie@exemple.fr,Marie"} /></div>
          <Button className="w-fit" disabled={busy || !listId || !contacts.trim()}><Upload className="h-4 w-4" /> Importer</Button>
        </form>
      </Panel>
      <Panel title="Vos listes">
        <DataTable cols={["Liste", "Contacts", "Actifs", "Créée le"]} rows={lists.map(l => [l.name, String(l.total), String(l.active), new Date(l.created_at).toLocaleDateString("fr-FR")])} />
        {!q.isLoading && !lists.length && <p className="mt-3 text-sm text-muted-foreground">Aucune liste. Créez-en une ci-dessous.</p>}
      </Panel>
      <Panel title="Ajouter à la suppression">
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); run(async () => { const r = await fSupp({ data: { text: supp, source } }); toast.success(`${r.added} adresse(s) ajoutée(s)`); setSupp(""); }); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="supp-source">Origine</Label><Input id="supp-source" value={source} onChange={e => setSource(e.target.value)} /></div>
            <div><Label htmlFor="supp-file">Fichier (emails ou empreintes MD5)</Label><Input id="supp-file" type="file" accept=".csv,.txt" onChange={file(setSupp)} /></div>
          </div>
          <Textarea aria-label="Adresses à supprimer" rows={4} value={supp} onChange={e => setSupp(e.target.value)} placeholder="Une adresse email ou une empreinte MD5 par ligne" />
          <Button className="w-fit" disabled={busy || !supp.trim()}><Ban className="h-4 w-4" /> Ajouter à la suppression</Button>
        </form>
        <div className="mt-4"><DataTable cols={["Type", "Adresses"]} rows={Object.entries(s).map(([k, v]) => [reasons[k] ?? k, String(v)])} /></div>
      </Panel>
      <Panel title="Actions rapides">
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); run(async () => { await fList({ data: { name } }); toast.success("Liste créée"); setName(""); }); }}>
          <div className="w-full sm:w-64"><Label htmlFor="list-name">Nouvelle liste</Label><Input id="list-name" value={name} onChange={e => setName(e.target.value)} required /></div>
          <Button disabled={busy}><Plus className="h-4 w-4" /> Créer la liste</Button>
          <Button type="button" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["sending"] })}><RefreshCw className="h-4 w-4" /> Actualiser</Button>
        </form>
      </Panel>
      <StatusBar>{lists.length} liste(s) · {totalSupp} adresse(s) supprimée(s) · filtrage MD5 appliqué à chaque envoi</StatusBar>
    </>
  );
}
