import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { readMessageTrace } from '@/lib/delivery.functions';
import { smtpDiagnostic } from '@/lib/smtp-diagnostic';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DataTable, Pill } from './kit';

const eventNames: Record<string, string> = {
  delivered: 'Accepté en SMTP', bounce: 'Rebond', deferred: 'Report SMTP', complaint: 'Plainte',
};
const queueNames: Record<string, string> = { queued: 'En file', claimed: 'Réservé par un agent', sent: 'Confié à KumoMTA', failed: 'Écarté ou en échec', skipped: 'Écarté avant envoi', expired: 'Expiré avant envoi' };
const deliveryNames: Record<string, string> = { pending: 'En attente', delivered: 'Accepté en SMTP', deferred: 'Report SMTP', bounced: 'Rebond', complained: 'Plainte' };
const formatDate = (value: string) => new Date(value).toLocaleString('fr-FR');

export function MessageTrace({ reference, onClose }: { reference: string; onClose: () => void }) {
  const read = useServerFn(readMessageTrace);
  const query = useQuery({ queryKey: ['message-trace', reference], queryFn: () => read({ data: reference }), enabled: !!reference, retry: false });
  const trace = query.data;
  const steps = trace ? [
    { label: 'Ajouté à la file', at: trace.message.created_at },
    { label: 'Disponible à partir de', at: trace.message.available_at },
    { label: 'Dernière prise en charge par l’agent', at: trace.message.claimed_at },
    { label: 'Dernière autorisation d’injection', at: trace.message.permit_granted_at },
    { label: 'Injection confirmée par KumoMTA', at: trace.message.sent_at },
    { label: 'Expiré avant envoi', at: trace.message.expired_at },
  ] : [];

  return <Dialog open={!!reference} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
      <DialogTitle>Trace du message</DialogTitle>
      <DialogDescription>De la file d’envoi aux événements SMTP enregistrés. Le placement en boîte de réception se mesure séparément avec Test Inbox.</DialogDescription>
      {query.isPending && <p role="status" className="text-sm">Recherche du message…</p>}
      {query.isError && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
      {trace === null && <p role="status" className="text-sm">Aucun message accessible pour cet identifiant.</p>}
      {trace && <>
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all text-xs">{trace.messageId}</code>
          <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser la trace</Button>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Destinataire</dt><dd className="break-all">{trace.message.email}</dd></div>
          <div><dt className="text-muted-foreground">Serveur assigné</dt><dd>{trace.server ?? '—'}</dd></div>
          <div><dt className="text-muted-foreground">Campagne</dt><dd>{trace.campaign?.name ?? '—'}</dd></div>
          <div><dt className="text-muted-foreground">Objet enregistré dans la campagne</dt><dd>{trace.campaign?.subject ?? '—'}{trace.message.variant !== null && ` · Variante ${trace.message.variant + 1}`}</dd></div>
          <div><dt className="text-muted-foreground">État de la file</dt><dd>{queueNames[trace.message.status] ?? trace.message.status}</dd></div>
          <div><dt className="text-muted-foreground">Dernier état de livraison</dt><dd>{trace.message.status === 'expired' ? 'Aucune tentative SMTP' : deliveryNames[trace.message.delivery_state] ?? trace.message.delivery_state}</dd></div>
        </dl>
        {trace.message.error && <p className="break-words text-sm text-destructive">Motif enregistré · {trace.message.error}</p>}
        <h3 className="font-semibold">Étapes de la file</h3>
        <ol className="space-y-2 text-sm">
          {steps.filter(step => step.at).map(step => <li key={step.label} className="flex flex-wrap justify-between gap-1 border-b pb-1">
            <span>{step.label}</span><time dateTime={step.at!} className="text-muted-foreground">{formatDate(step.at!)}</time>
          </li>)}
        </ol>
        <h3 className="font-semibold">Événements SMTP</h3>
        {trace.events.length ? <DataTable cols={['Date', 'Événement', 'FAI et IP source', 'SMTP', 'Détail']} rows={trace.events.map(event => {
          const diagnostic = smtpDiagnostic(event.code, event.detail, event.isp);
          return [formatDate(event.at), <Pill tone={event.type === 'delivered' ? 'ok' : event.type === 'deferred' ? 'warn' : 'bad'}>{diagnostic?.label ?? eventNames[event.type] ?? event.type}</Pill>,
          <div>{event.isp}<div className="text-xs text-muted-foreground">{event.ip ?? 'IP non enregistrée'}</div></div>,
          diagnostic?.enhanced ? `${event.code} ${diagnostic.enhanced}` : event.code ?? '—',
          <div className="max-w-sm whitespace-normal break-words">{event.detail || '—'}{diagnostic && <p className="mt-1 text-xs text-muted-foreground">{diagnostic.advice}</p>}</div>];
        })} /> : <p className="text-sm text-muted-foreground">Aucun événement SMTP enregistré pour ce message.</p>}
        {trace.truncated && <p className="text-xs text-muted-foreground">Les 100 derniers événements sont affichés.</p>}
      </>}
    </DialogContent>
  </Dialog>;
}
