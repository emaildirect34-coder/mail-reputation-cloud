import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { changedText } from '@/lib/campaign-version';
import { readCampaignVersion, readCampaignVersions } from '@/lib/sending.functions';

type Version = Awaited<ReturnType<typeof readCampaignVersion>>;
const date = (value: string) => new Date(value).toLocaleString('fr-FR');
const sources = { existing: 'État initial archivé', created: 'Création', edited: 'Modification', sponsor: 'Lien sponsor modifié' };
const priorityNames: Record<number, string> = { '-1': 'Basse', 0: 'Normale', 1: 'Haute' };

function VersionText({ before, after }: { before: string; after: string }) {
  const diff = changedText(before, after);
  return <div className="grid gap-2 sm:grid-cols-2">
    {(['before', 'after'] as const).map(side => <div key={side} className="min-w-0">
      <p className="text-xs font-medium">{side === 'before' ? 'Avant' : 'Après'}</p>
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
        {diff.leading}<mark className={side === 'before' ? 'bg-destructive/20 text-foreground' : 'bg-primary/20 text-foreground'}>{diff[side]}</mark>{diff.trailing}
      </pre>
    </div>)}
  </div>;
}

function compareFields(before: Version['snapshot'], after: Version['snapshot']) {
  const fields: { label: string; previous: string | null; next: string | null }[] = [];
  const add = (label: string, previous: string | null, next: string | null) => {
    if (previous !== next) fields.push({ label, previous, next });
  };
  const addNamed = (label: string, previous: string | null, next: string | null, previousId: string | null, nextId: string | null) => {
    const sameName = previous && previous === next && previousId !== nextId;
    add(label, sameName ? previous + ' · ' + previousId : previous ?? previousId,
      sameName ? next + ' · ' + nextId : next ?? nextId);
  };
  add('Nom', before.name, after.name);
  add('Objet', before.subject, after.subject);
  add('Expéditeur', before.fromName + ' <' + before.fromEmail + '>', after.fromName + ' <' + after.fromEmail + '>');
  add('Adresse de réponse', before.replyTo, after.replyTo);
  addNamed('Offre sponsor', before.sponsorName, after.sponsorName, before.sponsorId, after.sponsorId);
  add('Lien de l’offre sponsor', before.sponsorUrl, after.sponsorUrl);
  add('Thème', before.topic, after.topic);
  addNamed('Liste', before.listName, after.listName, before.listId, after.listId);
  addNamed('Serveur', before.servers.map(server => server.label).join(', '), after.servers.map(server => server.label).join(', '),
    before.servers.map(server => server.id).join(', '), after.servers.map(server => server.id).join(', '));
  addNamed('Pool', before.poolName, after.poolName, before.poolId, after.poolId);
  add('Priorité', priorityNames[before.priority] ?? null, priorityNames[after.priority] ?? null);
  add('Date de départ', before.scheduledAt && date(before.scheduledAt), after.scheduledAt && date(after.scheduledAt));
  add('Date limite d’envoi', before.sendExpiresAt && date(before.sendExpiresAt), after.sendExpiresAt && date(after.sendExpiresAt));
  const window = (version: Version['snapshot']) => {
    const clock = (minute: number) => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
    return version.windowStart === null || version.windowEnd === null ? null : clock(version.windowStart) + ' – ' + clock(version.windowEnd);
  };
  add('Plage horaire', window(before), window(after));
  add('Format', before.weeklyDigest ? 'Récapitulatif' : 'Campagne', after.weeklyDigest ? 'Récapitulatif' : 'Campagne');
  add('Variantes A/B', before.variants, after.variants);
  return fields;
}

function VersionComparison({ before, after }: { before: Version; after: Version }) {
  const fields = compareFields(before.snapshot, after.snapshot);
  const previousLinks = new Map(before.links.map(link => [link.href, link.count]));
  const nextLinks = new Map(after.links.map(link => [link.href, link.count]));
  const links = [...new Set([...previousLinks.keys(), ...nextLinks.keys()])].flatMap(href => {
    const delta = (nextLinks.get(href) ?? 0) - (previousLinks.get(href) ?? 0);
    return delta ? [{ href, delta }] : [];
  });
  const htmlChanged = before.snapshot.html !== after.snapshot.html;
  const ampChanged = before.snapshot.ampHtml !== after.snapshot.ampHtml;
  return <div className="space-y-3">
    {fields.map(field => <div key={field.label}>
      <h4 className="font-medium">{field.label}</h4>
      <VersionText before={field.previous ?? '—'} after={field.next ?? '—'} />
    </div>)}
    {!!links.length && <div>
      <h4 className="font-medium">Liens dans l’e-mail</h4>
      <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5">
        {links.map(({ href, delta }) => <li key={href} className="break-all"><strong>{delta > 0 ? 'Ajout' : 'Retrait'}{Math.abs(delta) > 1 ? ' ×' + Math.abs(delta) : ''}</strong> {href}</li>)}
      </ul>
    </div>}
    {before.text !== after.text && <div><h4 className="font-medium">Texte de l’e-mail</h4><VersionText before={before.text} after={after.text} /></div>}
    {htmlChanged && <details><summary className="cursor-pointer font-medium">Comparer le code HTML</summary><VersionText before={before.snapshot.html} after={after.snapshot.html} /></details>}
    {ampChanged && <details><summary className="cursor-pointer font-medium">Comparer le code AMP</summary><VersionText before={before.snapshot.ampHtml ?? ''} after={after.snapshot.ampHtml ?? ''} /></details>}
    {!fields.length && !links.length && !htmlChanged && !ampChanged && <p className="text-muted-foreground">Aucune différence entre les deux versions sélectionnées.</p>}
  </div>;
}

export function CampaignVersionHistory({ id, onRestore }: { id: string; onRestore: () => void }) {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState<number | null>(null);
  const [second, setSecond] = useState<number | null>(null);
  const readList = useServerFn(readCampaignVersions);
  const readVersion = useServerFn(readCampaignVersion);
  const history = useInfiniteQuery({
    queryKey: ['campaign-versions', id], enabled: open, initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => readList({ data: { id, before: pageParam } }),
    getNextPageParam: page => page?.next,
  });
  const items = history.data?.pages.flatMap(page => page?.items ?? []) ?? [];
  const firstVersion = first ?? items[1]?.version ?? items[0]?.version;
  const secondVersion = second ?? items[0]?.version;
  const before = useQuery({
    queryKey: ['campaign-version', id, firstVersion], enabled: open && !!firstVersion,
    queryFn: () => readVersion({ data: { id, version: firstVersion! } }),
  });
  const after = useQuery({
    queryKey: ['campaign-version', id, secondVersion], enabled: open && !!secondVersion && secondVersion !== firstVersion,
    queryFn: () => readVersion({ data: { id, version: secondVersion! } }),
  });
  const secondData = firstVersion !== secondVersion ? after.data : undefined;
  const options = items.map(item => <option key={item.version} value={item.version}>Version {item.version} · {date(item.created_at)} · {sources[item.source]}</option>);
  const restore = (version: number) => <Button asChild size="sm" variant="outline">
    <Link to="/dashboard/campaigns/new" search={{ campaign: id, version }} onClick={onRestore}>Restaurer la version {version} dans le brouillon</Link>
  </Button>;
  const error = history.error ?? before.error ?? after.error;
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Historique des versions</summary>
    {open && <div className="mt-3 space-y-3">
      {error && <p role="alert" className="text-destructive">{error.message}</p>}
      {history.isPending && <p role="status">Chargement des versions…</p>}
      {!history.isPending && !error && !items.length && <p className="text-muted-foreground">Aucune version archivée pour cette campagne.</p>}
      {!!items.length && <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1">Version de référence<select className="rounded border bg-background p-2" value={firstVersion} onChange={event => setFirst(Number(event.target.value))}>{options}</select></label>
        {items.length > 1 && <label className="grid min-w-0 gap-1">Version à comparer<select className="rounded border bg-background p-2" value={secondVersion} onChange={event => setSecond(Number(event.target.value))}>{options}</select></label>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={history.isFetching} onClick={() => void history.refetch()}>Actualiser l’historique</Button>
        {history.hasNextPage && <Button size="sm" variant="outline" disabled={history.isFetching} onClick={() => void history.fetchNextPage()}>Charger les versions précédentes</Button>}
      </div>
      {!!items.length && !error && (before.isFetching || after.isFetching) && <p role="status">Chargement de la comparaison…</p>}
      {before.data && secondData && <VersionComparison before={before.data} after={secondData} />}
      {before.data && firstVersion === secondVersion && <div className="space-y-1">
        <p><strong>Objet</strong> {before.data.snapshot.subject}</p>
        <details><summary className="cursor-pointer">Texte de la version</summary><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{before.data.text}</pre></details>
      </div>}
      {before.data && <div className="flex flex-wrap gap-2">
        {restore(before.data.version)}{secondData && restore(secondData.version)}
      </div>}
    </div>}
  </details>;
}
