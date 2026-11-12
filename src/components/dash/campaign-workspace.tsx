import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { addCampaignNote, readCampaignCalendar, readCampaignEditorialWorkflow, readCampaignNotes, saveCampaignCalendarDay, saveCampaignEditorialWorkflow } from '@/lib/campaign-workspace.functions';
import { DataTable, Panel, Pill } from './kit';

const labels = { hypothesis: 'Hypothèse', observation: 'Observation', decision: 'Décision' };
type Category = keyof typeof labels;
const dates = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export function CampaignCalendar() {
  const [day, setDay] = useState('');
  const [reason, setReason] = useState('');
  const read = useServerFn(readCampaignCalendar);
  const save = useServerFn(saveCampaignCalendarDay);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['campaign-calendar'], queryFn: () => read() });
  const update = useMutation({
    mutationFn: save,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['campaign-calendar'] });
      setDay('');
      setReason('');
      toast.success('Calendrier mis à jour.');
    },
    onError: error => toast.error(error.message),
  });
  return <Panel title="Dates sans envoi marketing">
    {query.isPending && <p role="status">Chargement du calendrier…</p>}
    {query.error && <p role="alert" className="text-destructive">{query.error.message}</p>}
    {query.data === null && <p>Appliquez la migration 0072 pour activer le calendrier.</p>}
    {query.data && <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Les jours sont en UTC. Les messages marketing encore dans la file Email Direct restent en attente pendant la journée.</p>
      {query.data.days.length ? <DataTable cols={['Jour UTC', 'Motif', '']} rows={query.data.days.map(entry => [
        entry.day, entry.reason, <Button size="sm" variant="outline" disabled={update.isPending}
          onClick={() => update.mutate({ data: { day: entry.day, reason: null } })}>Retirer</Button>,
      ])} /> : <p className="text-sm">Aucune date bloquée à venir.</p>}
      <div className="space-y-2 border-t pt-3">
        <h3 className="font-medium">Calendrier éditorial · campagnes programmées</h3>
        {query.data.scheduled?.length ? <DataTable cols={['Date prévue','Campagne','Objet','État']} rows={query.data.scheduled.map(item => [
          dates.format(new Date(item.scheduled_at)), item.name, item.subject, <Pill tone={item.status === 'queued' ? 'ok' : 'warn'}>{item.status === 'queued' ? 'En file' : 'En pause'}</Pill>,
        ])} /> : <p className="text-sm text-muted-foreground">Aucune campagne programmée à venir.</p>}
        <CampaignEditorialWorkflow campaigns={query.data.editorialCampaigns ?? query.data.scheduled ?? []} />
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); update.mutate({ data: { day, reason } }); }}>
        <label className="grid gap-1 text-sm">Jour à bloquer<Input required type="date" min={query.data.today} value={day} onChange={event => setDay(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Motif<Input required maxLength={160} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <Button disabled={update.isPending || !day || !reason.trim()}>Bloquer ce jour</Button>
      </form>
    </div>}
  </Panel>;
}

function CampaignEditorialWorkflow({ campaigns }: { campaigns: { id: string; name: string; subject: string | null }[] }) {
  const [campaignId, setCampaignId] = useState(''), [brief, setBrief] = useState(''), [owner, setOwner] = useState(''), [state, setState] = useState<'draft'|'review'|'approved'>('draft'), [dueOn, setDueOn] = useState('');
  const read = useServerFn(readCampaignEditorialWorkflow), save = useServerFn(saveCampaignEditorialWorkflow), client = useQueryClient();
  const query = useQuery({ queryKey: ['campaign-editorial-workflow'], queryFn: () => read() });
  const mutation = useMutation({ mutationFn: save, onSuccess: async () => { await client.invalidateQueries({ queryKey: ['campaign-editorial-workflow'] }); toast.success('Brief éditorial enregistré.'); }, onError: error => toast.error(error.message) });
  const selectCampaign = (id: string) => {
    setCampaignId(id);
    const row = query.data?.find(x => x.campaign_id === id);
    setBrief(row?.brief ?? ''); setOwner(row?.owner ?? ''); setState(row?.state ?? 'draft'); setDueOn(row?.due_on ?? '');
  };
  const name = (id: string) => campaigns.find(c => c.id === id)?.name ?? 'Campagne archivée ou non programmée';
  return <div className="space-y-3 rounded-md border p-3">
    <h4 className="font-medium">Brief, responsable et validation</h4>
    {query.data === null ? <p className="text-xs text-muted-foreground">Appliquez la migration 0086 pour activer les briefs éditoriaux.</p> : <>
      {!!query.data?.length && <DataTable cols={['Campagne','Responsable','Échéance','État']} rows={query.data.map(row => [name(row.campaign_id), row.owner || '—', row.due_on || '—', <button type="button" className="underline" onClick={() => selectCampaign(row.campaign_id)}>{row.state === 'approved' ? 'Validé' : row.state === 'review' ? 'À valider' : 'Brouillon'}</button>])} />}
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); mutation.mutate({ data: { campaignId, brief, owner, state, dueOn: dueOn || null } }); }}>
        <label className="grid gap-1 text-sm">Campagne<select required className="h-9 rounded border bg-background px-2" value={campaignId} onChange={event => selectCampaign(event.target.value)}><option value="">Choisir…</option>{campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Responsable<input className="h-9 rounded border bg-background px-2" maxLength={160} value={owner} onChange={event => setOwner(event.target.value)} placeholder="Nom de la personne" /></label>
        <label className="grid gap-1 text-sm">Échéance éditoriale<input className="h-9 rounded border bg-background px-2" type="date" value={dueOn} onChange={event => setDueOn(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">État<select className="h-9 rounded border bg-background px-2" value={state} onChange={event => setState(event.target.value as typeof state)}><option value="draft">Brouillon</option><option value="review">À valider</option><option value="approved">Validé</option></select></label>
        <label className="grid gap-1 text-sm sm:col-span-2">Brief et notes<textarea className="min-h-20 rounded border bg-background p-2" maxLength={5000} value={brief} onChange={event => setBrief(event.target.value)} placeholder="Objectif, audience, offre, éléments à vérifier…" /></label>
        <Button className="w-fit" disabled={!campaignId || mutation.isPending}>Enregistrer le brief</Button>
      </form>
      {!campaigns.length && <p className="text-xs text-muted-foreground">Programmez une campagne pour pouvoir lui associer un brief.</p>}
    </>}
  </div>;
}

export function CampaignNotebook({ id }: { id: string }) {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState<Category>('observation');
  const [note, setNote] = useState('');
  const read = useServerFn(readCampaignNotes);
  const save = useServerFn(addCampaignNote);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['campaign-notes', id, page], queryFn: () => read({ data: { campaignId: id, page } }) });
  const update = useMutation({
    mutationFn: () => save({ data: { campaignId: id, note, category } }),
    onSuccess: async () => {
      setPage(0);
      setNote('');
      await client.invalidateQueries({ queryKey: ['campaign-notes', id] });
      toast.success('Note ajoutée.');
    },
    onError: error => toast.error(error.message),
  });
  if (query.data === null) return null;
  return <details className="space-y-2 rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Carnet de campagne</summary>
    {query.error && <p role="alert" className="text-destructive">{query.error.message}</p>}
    {query.isPending && <p role="status">Chargement…</p>}
    {query.data && <>
      {query.data.map(entry => <div key={entry.id} className="space-y-1 border-b py-2">
        <div className="flex flex-wrap items-center gap-2"><Pill>{labels[entry.category as Category]}</Pill>{dates.format(new Date(entry.created_at))}</div>
        <p className="whitespace-pre-wrap break-words">{entry.note}</p>
      </div>)}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Précédent</Button>
        <Button size="sm" variant="outline" disabled={query.data.length < 20} onClick={() => setPage(page + 1)}>Suivant</Button>
      </div>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); update.mutate(); }}>
        <label className="grid w-fit gap-1">Type de note
          <select className="h-9 rounded border bg-background px-2" value={category} onChange={event => setCategory(event.target.value as Category)}>
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <Textarea aria-label="Note de campagne" required value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
        <Button size="sm" disabled={update.isPending || !note.trim()}>Ajouter une note</Button>
      </form>
    </>}
  </details>;
}
