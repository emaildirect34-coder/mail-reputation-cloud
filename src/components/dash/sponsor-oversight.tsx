import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, Panel, Pill, Stat } from './kit';
import { SponsorCsvImport } from './sponsor-csv-import';
import {
  importSponsorConversionReport, readSponsorConversionReport, exportSponsorDiscrepancies,
  readSponsorLinkMonitoring, sponsorConversionCampaigns,
} from '@/lib/finance.functions';

const dates = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const statusLabels = { ok: 'Accessible', review: 'À vérifier', alert: 'Alerte' };
const reasonLabels = {
  missing: 'Postback absent', attribution: 'Attribuée ailleurs', unverified: 'Achat à vérifier',
  status: 'Statut différent', local_only: 'Absente du rapport sponsor',
};
const purchaseStatuses: Record<string, string> = {
  pending: 'En attente', approved: 'Confirmé', rejected: 'Refusé', paid: 'Payé',
};
const selectStyle = 'h-9 rounded-md border bg-background px-2 text-sm';

export function SponsorLinkMonitoring() {
  const read = useServerFn(readSponsorLinkMonitoring);
  const query = useQuery({ queryKey: ['sponsor-link-monitoring'], queryFn: () => read(), refetchInterval: 60_000 });
  return <Panel title="Surveillance des liens après envoi" action={
    <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser</Button>
  }>
    {query.isPending && <p role="status">Chargement…</p>}
    {query.error && <p role="alert" className="text-destructive">{query.error.message}</p>}
    {query.data && (!query.data.available ? <p>Appliquez la migration 0069 pour activer la surveillance.</p>
      : !query.data.configured ? <p>Renseignez les hôtes approuvés pour activer les contrôles automatiques.</p>
      : !query.data.campaigns.length ? <p>Aucune campagne sponsor vérifiée récemment.</p>
      : <DataTable cols={['Campagne', 'Offre', 'Contrôle', 'Dernière vérification', 'Observations']}
        rows={query.data.campaigns.map(row => [
          <Link className="text-primary underline" to="/dashboard/campaigns/list" search={{ monitor: row.id }}>{row.name}</Link>,
          row.offer ?? '—',
          <Pill tone={row.check?.status === 'alert' ? 'bad' : row.check?.status === 'ok' ? 'ok' : 'warn'}>
            {row.check ? statusLabels[row.check.status] : 'En attente'}
          </Pill>,
          row.checkedAt ? dates.format(new Date(row.checkedAt)) : '—',
          <div className="max-w-lg whitespace-normal">{row.check?.notes.join(' ') || '—'}</div>,
        ])} />)}
  </Panel>;
}

function ConversionReport({ campaignId, from, to, isAdmin }: {
  campaignId: string; from: string; to: string; isAdmin: boolean;
}) {
  const [page, setPage] = useState(0);
  const [references, setReferences] = useState('');
  const [empty, setEmpty] = useState(false);
  const read = useServerFn(readSponsorConversionReport);
  const save = useServerFn(importSponsorConversionReport);
  const exportReport = useServerFn(exportSponsorDiscrepancies);
  const cache = useQueryClient();
  const key = ['sponsor-conversion-report', campaignId, from, to];
  const query = useQuery({ queryKey: [...key, page], queryFn: () => read({ data: { campaignId, from, to, page } }) });
  const report = query.data?.report;
  const upload = useMutation({
    mutationFn: () => save({ data: { campaignId, from, to, transactionIds: references.split(/\r?\n/).map(line => line.trim()).filter(Boolean) } }),
    onSuccess: async count => {
      setPage(0);
      setReferences('');
      setEmpty(false);
      await cache.invalidateQueries({ queryKey: key });
      toast.success(`${count} transaction(s) sponsor enregistrée(s).`);
    },
    onError: error => toast.error(error.message),
  });
  const download = useMutation({
    mutationFn: () => exportReport({ data: { campaignId, from, to } }),
    onSuccess: evidence => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `ecarts-sponsor-${from}-${to}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: error => toast.error(error.message),
  });
  return <div className="space-y-3">
    {query.isPending && <p role="status">Chargement du rapprochement…</p>}
    {query.error && <p role="alert" className="text-destructive">{query.error.message}</p>}
    {query.data?.available === false && <p>Appliquez la migration 0069 pour afficher les rapprochements.</p>}
    {query.data?.available && !report && <p>Aucun rapport sponsor importé pour cette campagne et ces dates.</p>}
    {report && <>
      <p className="text-sm text-muted-foreground">Rapport importé le {dates.format(new Date(report.importedAt))} · {report.reported} achats déclarés</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Achats rapprochés" value={String(report.counts.matched)} />
        {Object.entries(reasonLabels).map(([reason, label]) =>
          <Stat key={reason} label={label} value={String(report.counts[reason as keyof typeof reasonLabels])} />)}
      </div>
      {report.issues.length ? <DataTable cols={['Transaction', 'Écart', 'État Email Direct']}
        rows={report.issues.map(issue => [
          issue.transaction_id, reasonLabels[issue.reason], issue.local_status ? purchaseStatuses[issue.local_status] ?? 'À vérifier' : '—',
        ])} /> : <p>Aucun écart sur cette page.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Précédent</Button>
        <Button size="sm" variant="outline" disabled={(page + 1) * 50 >= report.reported - report.counts.matched + report.counts.local_only}
          onClick={() => setPage(page + 1)}>Suivant</Button>
        <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser les écarts</Button>
        <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>Exporter le dossier sponsor</Button>
      </div>
    </>}
    {isAdmin && query.data?.available && <form className="space-y-2" onSubmit={event => { event.preventDefault(); upload.mutate(); }}>
      <SponsorCsvImport onExtract={ids => { setEmpty(false); setReferences(ids.join('\n')); }} />
      <label className="block space-y-1 text-sm">
        <span>Identifiants des achats confirmés du rapport sponsor</span>
        <Textarea value={references} onChange={event => setReferences(event.target.value)} disabled={empty || upload.isPending}
          maxLength={605000} placeholder="Un identifiant de transaction par ligne, sans en-tête" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={empty} disabled={!!references.trim() || upload.isPending} onChange={event => setEmpty(event.target.checked)} />
        Le rapport sponsor confirme zéro achat sur cette période
      </label>
      <p className="text-xs text-muted-foreground">Importe la liste complète de cette campagne sur les dates sélectionnées, en UTC. Le rapprochement utilise jusqu’à 5 000 identifiants et ne modifie ni le journal financier ni les acheteurs.</p>
      <Button disabled={upload.isPending || (!empty && !references.trim())}>{report ? 'Remplacer le rapport' : 'Importer le rapport'}</Button>
    </form>}
  </div>;
}

export function SponsorConversionReconciliation({ offers, from, to, isAdmin }: {
  offers: { id: string; name: string }[]; from: string; to: string; isAdmin: boolean;
}) {
  const [offerId, setOfferId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const readCampaigns = useServerFn(sponsorConversionCampaigns);
  const validOffer = offers.some(offer => offer.id === offerId);
  const campaigns = useQuery({
    queryKey: ['sponsor-conversion-campaigns', offerId], queryFn: () => readCampaigns({ data: { offerId } }), enabled: validOffer,
  });
  const interval = Date.parse(to) - Date.parse(from);
  const validPeriod = interval >= 0 && interval <= 30 * 86_400_000;
  return <Panel title="Rapprochement des conversions sponsor">
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Offre sponsor
          <select className={selectStyle} value={validOffer ? offerId : ''} onChange={event => { setOfferId(event.target.value); setCampaignId(''); }}>
            <option value="">Choisir une offre</option>
            {offers.map(offer => <option key={offer.id} value={offer.id}>{offer.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Campagne
          <select className={selectStyle} value={campaignId} disabled={!campaigns.data?.length} onChange={event => setCampaignId(event.target.value)}>
            <option value="">Choisir une campagne</option>
            {campaigns.data?.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.created_at.slice(0, 10)}</option>)}
          </select>
        </label>
      </div>
      {validOffer && campaigns.isPending && <p role="status">Chargement des campagnes…</p>}
      {campaigns.error && <p role="alert" className="text-destructive">{campaigns.error.message}</p>}
      {validOffer && campaigns.data?.length === 0 && <p>Aucune campagne liée à cette offre.</p>}
      {!validPeriod && <p>Choisis une période de 1 à 31 jours dans le filtre en haut de la page.</p>}
      {validPeriod && campaigns.data?.some(campaign => campaign.id === campaignId) &&
        <ConversionReport key={`${campaignId}:${from}:${to}`} {...{ campaignId, from, to, isAdmin }} />}
    </div>
  </Panel>;
}
