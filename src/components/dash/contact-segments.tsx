import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { segmentPreferences, segmentProviders } from '@/lib/contact-segment';
import { previewContactSegment, readContactSegments, saveContactSegment } from '@/lib/contact-insights.functions';

type Provider = typeof segmentProviders[number];
type Preference = typeof segmentPreferences[number];
const selectClass = 'h-9 rounded-md border bg-background px-2 text-sm';

export function ContactSegments({ listId }: { listId: string }) {
  const [segmentId, setId] = useState('');
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<Provider | ''>('');
  const [preference, setPreference] = useState<Preference>('any');
  const list = useServerFn(readContactSegments);
  const check = useServerFn(previewContactSegment);
  const save = useServerFn(saveContactSegment);
  const client = useQueryClient();
  const queryKey = ['contact-segments', listId];
  const segments = useQuery({ queryKey, queryFn: () => list({ data: { listId } }) });
  const input = { listId, segmentId: segmentId || null, provider: provider || null, preference };
  const compare = useMutation({ mutationFn: () => check({ data: input }), onError: error => toast.error(error.message) });
  const update = useMutation({
    mutationFn: () => save({ data: { ...input, name, revision: compare.data?.revision ?? null } }),
    onSuccess: async id => {
      setId(id);
      compare.reset();
      await client.invalidateQueries({ queryKey });
      toast.success('Segment enregistré.');
    },
    onError: error => toast.error(error.message),
  });
  const busy = compare.isPending || update.isPending;
  if (segments.isPending) return <p role="status">Chargement des segments…</p>;
  if (segments.error) return <p role="alert" className="text-destructive">{segments.error.message}</p>;
  if (!segments.data) return <p>Appliquez la migration 0074 pour gérer les segments de la liste.</p>;
  const options = segments.data;
  return <details className="space-y-2 rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Créer ou comparer un segment</summary>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1">Segment de référence
        <select className={selectClass} value={segmentId} disabled={busy} onChange={event => {
          const id = event.target.value;
          const selected = options.find(segment => segment.id === id);
          setId(id);
          setName(selected?.name ?? '');
          setProvider((selected?.provider ?? '') as Provider | '');
          setPreference((selected?.preference ?? 'any') as Preference);
          compare.reset();
        }}><option value="">Nouveau segment</option>{segments.data.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</select>
      </label>
      <label className="grid gap-1">Nom du segment<Input value={name} disabled={busy} onChange={event => setName(event.target.value)} maxLength={100} /></label>
      <label className="grid gap-1">Fournisseur de boîte
        <select className={selectClass} value={provider} disabled={busy} onChange={event => { setProvider(event.target.value as Provider | ''); compare.reset(); }}>
          <option value="">Tous</option>{segmentProviders.map(item => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label className="grid gap-1">Catégories de préférence
        <select className={selectClass} value={preference} disabled={busy} onChange={event => { setPreference(event.target.value as Preference); compare.reset(); }}>
          <option value="any">Toutes les adresses</option><option value="recorded">Avec des catégories enregistrées</option><option value="none">Sans catégories enregistrées</option>
        </select>
      </label>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => compare.mutate()}>Comparer les filtres</Button>
      <Button size="sm" disabled={busy || !name.trim() || !compare.data} onClick={() => update.mutate()}>Enregistrer le segment</Button>
    </div>
    {compare.data && <p role="status">{compare.data.previous} avant · {compare.data.next} après · {compare.data.entering} entrant(s) · {compare.data.leaving} sortant(s). Contacts actifs et non supprimés.</p>}
  </details>;
}
