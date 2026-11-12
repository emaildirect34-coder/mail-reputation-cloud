import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, Panel, Pill, Stat } from '@/components/dash/kit';
import { compareCampaignOutcomes, readCampaignFollowupTasks, updateCampaignFollowupTask } from '@/lib/campaign-outcomes.functions';

type Campaign = { id: string; name: string; subject: string; status: string; created_at: string };
const n = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('fr-FR');
const pct = (value: number | null) => value == null ? '—' : `${value.toLocaleString('fr-FR')} %`;

export function CampaignOutcomeComparison({ campaigns }: { campaigns: Campaign[] }) {
  const options = useMemo(() => campaigns.filter(item => item.status === 'done' || item.status === 'paused'), [campaigns]);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const compare = useServerFn(compareCampaignOutcomes);
  const result = useQuery({ queryKey: ['campaign-outcome-comparison', left, right], queryFn: () => compare({ data: { left, right } }), enabled: !!left && !!right && left !== right });
  const rows = (result.data ?? []).map(item => [
    item.name, n(item.audience), n(item.attempted), n(item.smtp_accepted), pct(item.acceptance_rate), n(item.bounced),
    n(item.complaints), n(item.unsubscribes), n(item.approved_purchases), `${n(item.purchase_amount_cents / 100)} €`,
  ]);
  return <Panel title="Comparer deux campagnes">
    <div className="flex flex-wrap gap-2">
      {[left, right].map((value, index) => <select key={index} className="h-9 min-w-56 rounded-md border bg-background px-2 text-sm" aria-label={index ? 'Deuxième campagne' : 'Première campagne'} value={value} onChange={event => index ? setRight(event.target.value) : setLeft(event.target.value)}>
        <option value="">{index ? 'Choisir la campagne B' : 'Choisir la campagne A'}</option>
        {options.map(item => <option key={item.id} value={item.id} disabled={value !== item.id && (index ? item.id === left : item.id === right)}>{item.name}</option>)}
      </select>)}
    </div>
    {options.length < 2 && <p className="mt-2 text-sm text-muted-foreground">Deux campagnes terminées ou suspendues sont nécessaires.</p>}
    {result.isPending && left && right && <p role="status" className="mt-2 text-sm">Calcul de la comparaison…</p>}
    {result.error && <p role="alert" className="mt-2 text-sm text-destructive">{result.error.message}</p>}
    {result.data === null && <p className="mt-2 text-sm text-muted-foreground">Applique la migration 0076 pour activer la comparaison.</p>}
    {result.data && <div className="mt-3 space-y-2">
      <DataTable cols={['Campagne','Audience','Tentatives','Acceptés SMTP','Acceptation','Rebonds','Plaintes','Désinscriptions','Achats confirmés','Valeur confirmée']} rows={rows} />
      <div className="grid gap-2 sm:grid-cols-2">
        {result.data.map(item => <div key={item.id} className="rounded-md border p-3"><h3 className="font-semibold">{item.name}</h3><div className="mt-2 grid grid-cols-2 gap-2 text-sm"><Stat label="Ouvertures observées" value={n(item.opens)} /><Stat label="Clics observés" value={n(item.clicks)} /></div><p className="mt-2 text-xs text-muted-foreground">Les ouvertures et clics sont des événements mesurés : les ouvertures peuvent être déclenchées par des proxies d’images et les clics par des scanners. Ils ne prouvent pas seuls une lecture humaine.</p></div>)}
      </div>
    </div>}
  </Panel>;
}

export function CampaignFollowup({ campaigns }: { campaigns: Campaign[] }) {
  const completed = campaigns.filter(campaign => campaign.status === 'done');
  const [campaignId, setCampaignId] = useState('');
  const read = useServerFn(readCampaignFollowupTasks);
  const update = useServerFn(updateCampaignFollowupTask);
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ['campaign-followup', campaignId], queryFn: () => read({ data: { campaignId } }), enabled: !!campaignId });
  const mutate = useMutation({
    mutationFn: (input: { taskId: string; done: boolean; note: string }) => update({ data: { campaignId, ...input } }),
    onSuccess: async () => { await cache.invalidateQueries({ queryKey: ['campaign-followup', campaignId] }); toast.success('Suivi mis à jour.'); },
    onError: error => toast.error(error.message),
  });
  return <Panel title="Actions après campagne">
    <label className="grid max-w-lg gap-1 text-sm">Campagne terminée
      <select className="h-9 rounded-md border bg-background px-2" value={campaignId} onChange={event => setCampaignId(event.target.value)}>
        <option value="">Choisir une campagne</option>{completed.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select>
    </label>
    {query.error && <p role="alert" className="mt-2 text-sm text-destructive">{query.error.message}</p>}
    {query.data === null && <p className="mt-2 text-sm text-muted-foreground">Applique la migration 0076 pour activer cette checklist.</p>}
    {query.data && <div className="mt-3 space-y-2">
      <p className="text-sm">{query.data.filter(task => task.status === 'done').length} / {query.data.length} actions terminées</p>
      {query.data.map(task => <TaskRow key={task.id} task={task} busy={mutate.isPending} onSave={data => mutate.mutate({ taskId: task.id, ...data })} />)}
      {!query.data.length && <p className="text-sm text-muted-foreground">Aucune tâche de suivi générée pour cette campagne.</p>}
    </div>}
  </Panel>;
}

function TaskRow({ task, busy, onSave }: { task: NonNullable<Awaited<ReturnType<typeof readCampaignFollowupTasks>>>[number]; busy: boolean; onSave: (data: { done: boolean; note: string }) => void }) {
  const [note, setNote] = useState(task.note);
  return <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto]">
    <div><p className="font-medium">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(task.created_at).toLocaleString('fr-FR')}</p>
      <Textarea aria-label={`Note : ${task.title}`} className="mt-2 min-h-16" maxLength={2000} value={note} onChange={event => setNote(event.target.value)} /></div>
    <div className="flex items-start gap-2"><Pill tone={task.status === 'done' ? 'ok' : 'warn'}>{task.status === 'done' ? 'Terminée' : 'À faire'}</Pill>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onSave({ done: task.status !== 'done', note })}>{task.status === 'done' ? 'Rouvrir' : 'Terminer'}</Button></div>
  </div>;
}
