import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { readCampaignDeliveryReconciliation } from '@/lib/sending.functions';
import { DataTable } from './kit';

const format = new Intl.NumberFormat('fr-FR');
const labels = [
  ['queued', 'En file ou réservé par l’agent'],
  ['injection_pending', 'Confirmation d’injection attendue'],
  ['injection_uncertain', 'Injection à vérifier'],
  ['smtp_pending', 'Confié à KumoMTA, réponse SMTP attendue'],
  ['smtp_deferred', 'Report temporaire du serveur destinataire'],
  ['smtp_bounced', 'Rebond sans acceptation SMTP enregistrée'],
  ['complaint_unconfirmed', 'Plainte sans acceptation SMTP enregistrée'],
  ['expired', 'Expiré avant envoi'],
  ['suppressed', 'Adresse en suppression avant l’envoi'],
  ['preferences', 'Écarté selon les préférences ou la cadence'],
  ['sponsor', 'Écarté suite à un achat ou à son annulation'],
  ['mailbox_hold', 'Écarté pendant la suspension liée à une boîte pleine'],
  ['injection_refused', 'Injection refusée par KumoMTA'],
  ['cancelled', 'Annulé avant envoi'],
  ['excluded', 'Autre exclusion avant envoi'],
  ['other', 'État à examiner'],
] as const;

export function CampaignDeliveryReconciliation({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const read = useServerFn(readCampaignDeliveryReconciliation);
  const report = useQuery({
    queryKey: ['campaign-delivery-reconciliation', id], enabled: open,
    queryFn: () => read({ data: { id } }),
  });
  const data = report.data;
  const accepted = data?.outcomes['accepted'] ?? 0;
  const missing = data ? Math.max(0, data.planned - data.tracked) : 0;
  const volume = data ? Math.max(data.planned, data.tracked) : 0;
  const gap = volume - accepted;
  const rows = data ? labels.flatMap<[string, number]>(([key, label]) => {
    const count = data.outcomes[key] ?? 0;
    return count ? [[label, count]] : [];
  }) : [];
  if (missing) rows.push(['Messages prévus sans trace dans la file', missing]);
  const unexplained = gap - rows.reduce((total, [, count]) => total + count, 0);
  if (unexplained > 0) rows.push(['Autres états à examiner', unexplained]);

  return <details className="rounded-md border p-3 text-sm" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">Bilan des écarts</summary>
    {open && <div className="mt-3 space-y-3">
      {report.isPending && <p role="status">Calcul du bilan…</p>}
      {report.error && <p role="alert" className="text-destructive">{report.error.message}</p>}
      {data === null && <p className="text-muted-foreground">Le bilan nécessite la mise à jour 0064.</p>}
      {data && <>
        <dl className="grid gap-2 sm:grid-cols-3">
          {([
            ['Messages prévus', data.planned],
            ['Acceptés en SMTP', accepted],
            ['Sans acceptation SMTP enregistrée', gap],
          ] as const).map(([label, count]) => <div key={label} className="rounded-md bg-muted/60 p-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{format.format(count)}</dd>
          </div>)}
        </dl>
        {data.tracked > data.planned && <p role="status" className="text-muted-foreground">
          Le bilan couvre {format.format(data.tracked)} messages retrouvés dans la file, pour {format.format(data.planned)} prévus.
        </p>}
        {!!rows.length && <DataTable cols={['Motif ou état', 'Messages']} rows={rows.map(([label, count]) => [label, format.format(count)])} />}
        {!!data.excluded_before && <p className="text-muted-foreground">{format.format(data.excluded_before)} contact(s) écarté(s) avant la mise en file.</p>}
        {!!data.retries && <p className="text-muted-foreground">{format.format(data.retries)} nouvelle(s) tentative(s) rattachée(s) aux messages d’origine.</p>}
        <p className="text-xs text-muted-foreground">Chaque message compte une fois. Une acceptation SMTP reste comptée si un rebond ou une plainte est enregistré ensuite.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={report.isFetching} onClick={() => void report.refetch()}>Actualiser le bilan</Button>
          <time className="text-xs text-muted-foreground" dateTime={data.observed_at}>{new Date(data.observed_at).toLocaleString('fr-FR')}</time>
        </div>
      </>}
    </div>}
  </details>;
}
