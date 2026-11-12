import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Upload, RefreshCw, Ban } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, DataTable, Pill, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { ContactInsights, ContactListInsights } from "@/components/dash/contact-insights";
import { readSending, createList, importContacts, importSuppressions, createSubscriptionConfirmation, exportSubscriptionProofs } from "@/lib/sending.functions";
import { supabase } from "@/integrations/supabase/client";

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
  const [withTimeZones, setWithTimeZones] = useState(false);
  const [importReview, setImportReview] = useState<Awaited<ReturnType<typeof importContacts>>['review']>(null);
  const [snapshot, setSnapshot] = useState<File | null>(null);
  const issueConfirmation = useServerFn(createSubscriptionConfirmation);
  const exportProofs = useServerFn(exportSubscriptionProofs);
  const [confirmationList, setConfirmationList] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [confirmation, setConfirmation] = useState<Awaited<ReturnType<typeof createSubscriptionConfirmation>> | null>(null);
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
      {q.data && <><ContactInsights /><ContactListInsights lists={lists} /></>}
      <Panel title="Importer des contacts">
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); run(async () => {
          const r = await fImport({ data: { listId, text: contacts, withTimeZones, ...(importReview ? { reviewedBatch: importReview.batch } : {}) } });
          setImportReview(r.review);
          if (r.review) return;
          toast.success(`${r.imported} contact(s) importé(s)`, { description: withTimeZones ? `${r.withTimeZone} avec un fuseau horaire.` : undefined });
          setContacts("");
        }); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Liste</Label><select aria-label="Liste" className={selectCls} value={listId} onChange={e => { setListId(e.target.value); setImportReview(null); }} required><option value="">Choisir une liste</option>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div><Label htmlFor="contacts-file">Fichier CSV de contacts</Label><Input id="contacts-file" type="file" accept=".csv,.txt" onChange={file(value => { setContacts(value); setImportReview(null); })} /></div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="contacts-time-zones" checked={withTimeZones} onCheckedChange={checked => { setWithTimeZones(checked === true); setImportReview(null); }} />
            <Label htmlFor="contacts-time-zones">La troisième colonne contient un fuseau horaire IANA</Label>
          </div>
          <div><Label htmlFor="contacts">{withTimeZones ? "Une adresse par ligne au format email,prénom,fuseau" : "Une adresse par ligne au format email,prénom"}</Label>
            <Textarea id="contacts" rows={5} value={contacts} onChange={e => { setContacts(e.target.value); setImportReview(null); }}
              placeholder={withTimeZones ? "jean@exemple.fr,Jean,Europe/Paris\nmarie@exemple.fr,Marie,America/Montreal" : "jean@exemple.fr,Jean\nmarie@exemple.fr,Marie"} />
            {withTimeZones && <p className="mt-1 text-xs text-muted-foreground">La colonne peut rester vide. Réimportez une adresse dans la même liste pour renseigner ou actualiser son fuseau.</p>}
          </div>
          {importReview && <p role="alert" className="text-sm">Sur {importReview.total} adresses, {importReview.count} appartiennent à {importReview.domain}. Vérifiez la provenance et le consentement des contacts avant de confirmer cet import.</p>}
          <Button className="w-fit" disabled={busy || !listId || !contacts.trim()}><Upload className="h-4 w-4" /> {importReview ? 'Confirmer cet import' : 'Importer'}</Button>
        </form>
      </Panel>
      <Panel title="Vos listes">
        <DataTable cols={["Liste", "Contacts", "Actifs", "Créée le", "État"]} rows={lists.map(l => [
          l.name, String(l.total), String(l.active), new Date(l.created_at).toLocaleDateString("fr-FR"),
          l.quarantined_at ? <div><Pill tone="bad">En quarantaine</Pill><p className="text-xs text-muted-foreground">{l.quarantine_reason}</p></div> : "—",
        ])} />
        {!q.isLoading && !lists.length && <p className="mt-3 text-sm text-muted-foreground">Aucune liste. Créez-en une ci-dessous.</p>}
      </Panel>
      <Panel title="Lien de confirmation d’inscription">
        <form className="grid gap-2" onSubmit={event => { event.preventDefault(); setConfirmation(null); void run(async () => {
          setConfirmation(await issueConfirmation({ data: { listId: confirmationList, email: confirmationEmail } }));
        }); }}>
          <p className="text-sm text-muted-foreground">Créez un lien valable 48 heures pour une inscription demandée, puis transmettez-le à l’adresse concernée. L’inscription est enregistrée après confirmation.</p>
          <label className="grid gap-1 text-sm">Liste d’inscription
            <select className={selectCls} value={confirmationList} onChange={event => { setConfirmationList(event.target.value); setConfirmation(null); }} required>
              <option value="">Choisir une liste</option>
              {lists.filter(list => !list.quarantined_at).map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">Adresse à confirmer<Input type="email" value={confirmationEmail} maxLength={254} onChange={event => { setConfirmationEmail(event.target.value); setConfirmation(null); }} required /></label>
          <Button className="w-fit" disabled={busy || !confirmationList || !confirmationEmail.trim()}>Générer le lien</Button>
          <Button type="button" variant="outline" className="w-fit" disabled={busy || !confirmationList || !confirmationEmail.trim()} onClick={() => void run(async () => {
            const evidence = await exportProofs({ data: { listId: confirmationList, email: confirmationEmail } });
            const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'preuves-consentement.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })}>Exporter les preuves JSON</Button>
          {confirmation && <div className="grid gap-1">
            <Input aria-label="Lien de confirmation" readOnly value={confirmation.url} />
            <Button type="button" variant="outline" className="w-fit" onClick={async () => {
              try { await navigator.clipboard.writeText(confirmation.url); toast.success('Lien copié.'); }
              catch { toast.error('Copiez le lien depuis le champ.'); }
            }}>Copier le lien</Button>
          </div>}
        </form>
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
      <Panel title="Instantané Bloom des agents">
        <form className="grid gap-2" onSubmit={event => { event.preventDefault(); if (!snapshot) return; void run(async () => {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error('Reconnectez-vous pour publier l’instantané.');
          const result = await fetch('/api/public/agent/suppression-snapshot', { method: 'PUT', headers: {
            Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/octet-stream',
          }, body: snapshot });
          if (!result.ok) throw new Error(await result.text());
          const { expires } = await result.json() as { expires: number };
          toast.success(`Instantané publié jusqu’au ${new Date(expires).toLocaleString('fr-FR')}.`);
          setSnapshot(null);
        }); }}>
          <p className="text-sm text-muted-foreground">Publiez uniquement le fichier Bloom signé. Les agents configurés le récupèrent et confirment les exclusions dans la base de l’application.</p>
          <Label htmlFor="bloom-snapshot">Instantané signé</Label>
          <Input id="bloom-snapshot" type="file" accept=".bloom,.bin,application/octet-stream" onChange={event => setSnapshot(event.target.files?.[0] ?? null)} />
          <Button className="w-fit" disabled={busy || !snapshot || snapshot.size > 12_000_052}>Publier aux agents</Button>
        </form>
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
