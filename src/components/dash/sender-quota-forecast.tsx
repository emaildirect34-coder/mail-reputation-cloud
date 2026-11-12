import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { forecastSenderDomainQuota } from '@/lib/sending.functions';
import type { SenderQuotaForecastInput } from '@/lib/sending.schemas';
import { DataTable } from './kit';

const number = new Intl.NumberFormat('fr-FR');
const utcDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'UTC' });
const observed = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' });

export function SenderQuotaForecast({ input, disabled }: { input: SenderQuotaForecastInput; disabled: boolean }) {
  const forecast = useServerFn(forecastSenderDomainQuota);
  const analysis = useMutation({ mutationFn: (draft: SenderQuotaForecastInput) => forecast({ data: draft }) });
  const current = JSON.stringify(analysis.variables) === JSON.stringify(input);
  const result = current && !disabled ? analysis.data : undefined;

  return <section className="mt-3 space-y-2 rounded-md border p-3 text-sm" aria-label="Prévision de saturation du domaine">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-medium">Prévision de saturation du domaine</h3>
      <Button size="sm" variant="outline" disabled={disabled || analysis.isPending} onClick={() => analysis.mutate(input)}>
        {analysis.isPending ? 'Calcul en cours…' : result ? 'Recalculer le quota' : 'Prévoir le quota du domaine'}
      </Button>
    </div>
    {disabled && <p className="text-muted-foreground">Renseigne l’expéditeur, la liste, le serveur et une date de programmation valide.</p>}
    {current && analysis.error && <p role="alert" className="text-destructive">{analysis.error.message}</p>}
    {result?.kind === 'unconfigured' && <p role="status">
      Aucun plafond journalier actif pour {result.domain}. <Link className="text-primary underline" to="/dashboard/domains">Ouvrir les domaines</Link>
    </p>}
    {result?.kind === 'forecast' && <>
      <p><strong>{result.domain}</strong> · {number.format(result.limit)} autorisations par jour · {number.format(result.used)} déjà prises aujourd’hui (UTC).</p>
      <p role="status"><strong>{number.format(result.deferred)}</strong> message(s) sur {number.format(result.audience)} pourraient attendre un jour UTC suivant.</p>
      {!!result.expired && <p role="status">{number.format(result.expired)} message(s) pourraient atteindre la date limite avant d’obtenir une place.</p>}
      <DataTable
        cols={['Jour UTC', 'File existante', 'Brouillon prévu', 'Brouillon pouvant partir', 'Brouillon en attente', ...(result.expired ? ['Expirations estimées'] : [])]}
        rows={result.days.map(day => [
          utcDate.format(new Date(day.day + 'T00:00:00Z')),
          `${number.format(day.existingReady)} prêts · ${number.format(day.existingAuthorized)} places`,
          number.format(day.draftPlanned), number.format(day.draftAuthorized), number.format(day.draftWaiting),
          ...(result.expired ? [number.format(day.draftExpired)] : []),
        ])}
      />
      {!!result.waitingAfterHorizon && <p role="status">{number.format(result.waitingAfterHorizon)} message(s) resteraient en attente au-delà des sept jours suivant le dernier créneau prévu.</p>}
      <p className="text-xs text-muted-foreground">Estimation au {observed.format(new Date(result.asOf))} UTC. Le calcul attribue les places d’abord à la file existante, puis au brouillon. Les pauses, les limites des serveurs et les plages horaires peuvent décaler les envois.</p>
    </>}
  </section>;
}
