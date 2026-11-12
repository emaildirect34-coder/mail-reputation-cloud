import { useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { forecastCampaignConflicts } from '@/lib/sending.functions';
import type { CampaignConflictsInput } from '@/lib/sending.schemas';
import { DataTable } from './kit';

const number = new Intl.NumberFormat('fr-FR');
const priorityNames: Record<number, string> = { '-1': 'Basse', 0: 'Normale', 1: 'Haute' };

export function CampaignConflicts({ input, disabled }: { input: CampaignConflictsInput; disabled: boolean }) {
  const forecast = useServerFn(forecastCampaignConflicts);
  const analysis = useMutation({ mutationFn: (draft: CampaignConflictsInput) => forecast({ data: draft }) });
  const current = JSON.stringify(analysis.variables) === JSON.stringify(input);
  const result = current && !disabled ? analysis.data : undefined;
  const clock = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: input.scheduleTimeZone || 'UTC' });
  const caps = !!result?.capHours;

  return <section className="mt-3 space-y-2 rounded-md border p-3 text-sm" aria-label="Calendrier des conflits d’audience">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-medium">Conflits d’audience</h3>
      <Button size="sm" variant="outline" disabled={disabled || analysis.isPending} onClick={() => analysis.mutate(input)}>
        {analysis.isPending ? 'Analyse en cours…' : result ? 'Recalculer' : 'Vérifier les chevauchements'}
      </Button>
    </div>
    {disabled && <p className="text-muted-foreground">Choisis une liste, un serveur et une date valides pour comparer les campagnes.</p>}
    {current && analysis.error && <p role="alert" className="text-destructive">{analysis.error.message}</p>}
    {result && <>
      <p role="status">
        <strong>{number.format(result.overlap)}</strong> destinataire(s) en commun sur <strong>{number.format(result.audience)}</strong> dans le brouillon.
        {caps && <> Le plafond de {result.capHours} h pourrait différer <strong>{number.format(result.draftAtRisk)}</strong> envoi(s) de ce brouillon.</>}
      </p>
      {!caps && <p className="text-muted-foreground">Le plafond global est désactivé. Les chevauchements sont recherchés à 24 h de part et d’autre de chaque envoi prévu.</p>}
      {!!result.campaigns.length && <DataTable
        cols={['Campagne', 'Début prévu', 'Priorité', 'Destinataires communs', ...(caps ? ['Brouillon différé', 'Autre campagne différée', 'Ordre incertain'] : [])]}
        rows={result.campaigns.map(campaign => [
          <div><span className="font-medium">{campaign.name}</span>{campaign.status === 'paused' && <p className="text-xs text-muted-foreground">En pause</p>}</div>,
          campaign.scheduled_at ? clock.format(new Date(campaign.scheduled_at)) : 'Déjà en file',
          priorityNames[campaign.send_priority] ?? priorityNames[0], number.format(campaign.overlap),
          ...(caps ? [campaign.draft_delayed, campaign.other_delayed, campaign.uncertain].map(value => number.format(value)) : []),
        ])}
      />}
      <p className="text-xs text-muted-foreground">Estimation calculée le {clock.format(new Date(result.asOf))} à partir des messages encore en file. Le calcul utilise la priorité à heure prévue égale sur un même serveur. Un même destinataire peut figurer dans plusieurs lignes.</p>
    </>}
  </section>;
}
