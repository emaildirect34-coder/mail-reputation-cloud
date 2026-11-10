import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { readDeliveryDashboard } from '@/lib/delivery.functions';
import { DataTable, Panel, Stat } from './kit';

const periods = { '24h': '24 dernières heures', '7j': '7 derniers jours', '30j': '30 derniers jours' } as const;
const eventNames: Record<string, string> = { delivered: 'Livraison SMTP', bounce: 'Rebond', deferred: 'Report temporaire', complaint: 'Plainte' };
const format = (value: string) => new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const integer = new Intl.NumberFormat('fr-FR');

export function DeliveryDashboard() {
  const [period, setPeriod] = useState<keyof typeof periods>('24h');
  const [printError, setPrintError] = useState(false);
  const load = useServerFn(readDeliveryDashboard);
  const query = useQuery({ queryKey: ['delivery-dashboard', period], queryFn: () => load({ data: period }), refetchInterval: 60_000 });
  const data = query.data;
  const stats = data ? [
    ['Livraisons SMTP', data.delivered], ['Rebonds', data.bounced],
    ['Reports temporaires', data.deferred], ['Plaintes', data.complaints],
  ] as const : [];
  const rows = data?.events.map(event => [
    format(event.occurred_at), eventNames[event.event_type] ?? event.event_type, event.isp, String(event.smtp_code ?? '—'),
  ]) ?? [];
  const columns = ['Date et heure', 'Événement', 'FAI', 'Code SMTP'];
  const max = Math.max(1, ...(data?.buckets.map(bucket => bucket.count) ?? []));

  function printReport() {
    if (!data) return;
    const popup = window.open('', '_blank');
    setPrintError(!popup);
    if (!popup) return;
    popup.opener = null;
    const doc = popup.document;
    doc.title = 'Rapport de délivrabilité SMTP';
    const style = doc.createElement('style');
    style.textContent = 'body{font:14px system-ui;margin:32px;color:#171717}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{text-align:left;padding:6px;border-bottom:1px solid #ccc}tr{break-inside:avoid}thead{display:table-header-group}';
    doc.head.append(style);
    const heading = doc.createElement('h1');
    heading.textContent = doc.title;
    const subtitle = doc.createElement('p');
    subtitle.textContent = 'Du ' + format(data.from) + ' au ' + format(data.to);
    doc.body.append(heading, subtitle);

    function table(headers: string[], records: readonly (readonly string[])[]) {
      const element = doc.createElement('table');
      const header = element.createTHead().insertRow();
      for (const label of headers) {
        const cell = doc.createElement('th');
        cell.textContent = label;
        header.append(cell);
      }
      const body = element.createTBody();
      for (const record of records) {
        const row = body.insertRow();
        for (const value of record) row.insertCell().textContent = value;
      }
      doc.body.append(element);
    }

    table(['Métrique', 'Événements'], stats.map(([label, value]) => [label, integer.format(value)]));
    table(['Début', 'Fin', 'Événements'], data.buckets.map(bucket => [format(bucket.from), format(bucket.to), integer.format(bucket.count)]));
    const recent = doc.createElement('h2');
    recent.textContent = 'Derniers événements (50 maximum)';
    doc.body.append(recent);
    table(columns, rows);
    popup.print();
  }

  return <Panel title="Délivrabilité SMTP">
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">Période
        <select className="rounded-md border bg-card px-2 py-1.5" value={period} onChange={e => setPeriod(e.target.value as keyof typeof periods)}>
          {Object.entries(periods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <Button variant="outline" disabled={!data} onClick={printReport}>Imprimer ou enregistrer en PDF</Button>
    </div>
    {printError && <p role="alert">Autorisez l’ouverture du rapport dans votre navigateur.</p>}
    {query.isPending && <p role="status">Chargement des métriques…</p>}
    {query.isError && <p role="alert" className="text-destructive">{query.error.message}</p>}
    {data && <>
      <p className="mb-3 text-sm text-muted-foreground">Événements observés du {format(data.from)} au {format(data.to)}. Une livraison SMTP correspond à une acceptation par le serveur destinataire.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{stats.map(([label, value]) => <Stat key={label} label={label} value={integer.format(value)} />)}</div>
      <h3 className="mt-4 text-sm font-semibold">Volume d’événements par intervalle</h3>
      <ul className="my-3 space-y-2">
        {data.buckets.map(bucket => <li key={bucket.from} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
          <time dateTime={bucket.from}>{format(bucket.from)}</time>
          <meter min={0} max={max} value={bucket.count} className="h-3 w-full" aria-label={'Événements à partir du ' + format(bucket.from)} />
          <span>{integer.format(bucket.count)}</span>
        </li>)}
      </ul>
      <h3 className="mt-4 text-sm font-semibold">Derniers événements</h3>
      {rows.length ? <DataTable cols={columns} rows={rows} /> : <p className="text-sm text-muted-foreground">Aucun événement sur cette période.</p>}
    </>}
  </Panel>;
}
