import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, Panel } from '@/components/dash/kit';
import { assignSponsorBrand, auditSponsorOffer, pauseSponsorOffer, readSponsorBuyers, saveSponsorPurchaseSettings } from '@/lib/finance.functions';
import { SponsorOfferWidgets } from './sponsor-offer-widgets';

const sendLabels: Record<string, string> = {
  not_queued: 'Non programmé', queued: 'En attente', claimed: 'En préparation',
  sent: 'Accepté par KumoMTA', failed: 'Interrompu ou à vérifier',
};
const selectStyle = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
type BuyerData = Awaited<ReturnType<typeof readSponsorBuyers>>;

function OfferBrand({ offerId, brand, brands }: { offerId: string; brand: string | null; brands: string[] }) {
  const [name, setName] = useState(brand ?? '');
  const [saving, setSaving] = useState(false);
  const assign = useServerFn(assignSponsorBrand);
  const cache = useQueryClient();
  const listId = 'sponsor-brands-' + offerId;
  return <form className="space-y-2" onSubmit={async event => {
    event.preventDefault();
    setSaving(true);
    try {
      await assign({ data: { offerId, name } });
      await cache.invalidateQueries({ queryKey: ['sponsor-buyers'] });
      toast.success('Marque de l’offre enregistrée.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Marque indisponible.');
    } finally {
      setSaving(false);
    }
  }}>
    <div className="flex flex-wrap items-end gap-2">
      <label className="w-full max-w-xs space-y-1 text-sm"><span>Marque de l’offre</span>
        <Input required maxLength={100} list={listId} value={name} onChange={event => setName(event.target.value)} />
      </label>
      <datalist id={listId}>{brands.map(option => <option key={option} value={option} />)}</datalist>
      <Button size="sm" variant="outline" disabled={saving || !name.trim()}>Enregistrer la marque</Button>
    </div>
    <p className="text-xs text-muted-foreground">Utilisez la même marque pour toutes ses offres, même si elles viennent de réseaux différents.</p>
  </form>;
}

function PurchaseSettings({ offerId, data }: { offerId: string; data: BuyerData }) {
  const [eventKey, setEventKey] = useState(data.settings?.event_key ?? '');
  const [reviewUrl, setReviewUrl] = useState(data.settings?.review_url ?? '');
  const [listId, setListId] = useState(data.settings?.consent_list_id ?? '');
  const [enabled, setEnabled] = useState(data.settings?.thank_you_enabled ?? false);
  const [saving, setSaving] = useState(false);
  const save = useServerFn(saveSponsorPurchaseSettings);
  const cache = useQueryClient();
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault();
    setSaving(true);
    try {
      await save({ data: { offerId, eventKey, reviewUrl, enabled, consentListId: listId || null } });
      await cache.invalidateQueries({ queryKey: ['sponsor-buyers', offerId] });
      toast.success('Suivi des achats enregistré');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }}>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="space-y-1 text-sm"><span>Événement d’achat du postback</span>
        <Input required maxLength={100} placeholder="purchase" value={eventKey} onChange={e => setEventKey(e.target.value)} />
      </label>
      <label className="space-y-1 text-sm"><span>URL HTTPS de votre page d’avis</span>
        <Input type="url" placeholder="Facultatif, à ajouter plus tard" value={reviewUrl} onChange={e => setReviewUrl(e.target.value)} />
      </label>
      <label className="space-y-1 text-sm"><span>Liste après consentement</span>
        <select className={selectStyle} value={listId} onChange={e => setListId(e.target.value)} required={enabled}>
          <option value="">Sélectionner une liste</option>
          {data.lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
      </label>
    </div>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
      Envoyer automatiquement un remerciement après un achat confirmé
    </label>
    <p className="text-sm text-muted-foreground">Configurez le postback sur l’événement de vente de cette offre. Il doit retourner le clic, la transaction, l’événement et le statut confirmé.</p>
    <Button disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le suivi'}</Button>
  </form>;
}

function OfferBuyers({ offerId }: { offerId: string }) {
  const [page, setPage] = useState(0);
  const read = useServerFn(readSponsorBuyers);
  const audit = useServerFn(auditSponsorOffer);
  const pause = useServerFn(pauseSponsorOffer);
  const cache = useQueryClient();
  const [auditResult, setAuditResult] = useState<Awaited<ReturnType<typeof auditSponsorOffer>>>();
  const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ['sponsor-buyers', offerId, page], queryFn: () => read({ data: { offerId, page } }), placeholderData: previous => previous });
  if (query.isPending) return <p>Chargement…</p>;
  if (query.isError) return <p role="alert" className="text-destructive">{query.error.message}</p>;
  return <div className="space-y-5">
    {query.data.brandAvailable && <OfferBrand key={query.data.brand ?? ''} offerId={offerId} brand={query.data.brand} brands={query.data.brands} />}
    <div className="space-y-2">
      <h3 className="font-medium">Qualité de l’offre sur les 7 derniers jours</h3>
      {query.data.quality?.length ? <DataTable cols={['Liste source', 'SMTP acceptés', 'Rebonds', 'Plaintes reçues', 'Désabonnements']}
        rows={query.data.quality.map(row => [row.source, row.accepted, row.hard_bounces, row.complaints, row.unsubscribes])} />
        : <p className="text-sm text-muted-foreground">{query.data.quality ? 'Aucun événement observé.' : 'Données indisponibles. Appliquez la migration 0051.'}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
          setBusy(true);
          try { setAuditResult(await audit({ data: { id: offerId } })); }
          catch { toast.error('Contrôle de la destination indisponible.'); }
          finally { setBusy(false); }
        }}>Vérifier le lien sponsor</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
          if (!query.data.paused && !window.confirm('Mettre cette offre et ses envois en pause ?')) return;
          setBusy(true);
          try {
            await pause({ data: { id: offerId, paused: !query.data.paused } });
            await cache.invalidateQueries();
            toast.success(query.data.paused ? 'Suspension retirée.' : 'Offre mise en pause.');
          } catch { toast.error('Modification impossible.'); }
          finally { setBusy(false); }
        }}>{query.data.paused ? 'Retirer la suspension' : 'Suspendre cette offre'}</Button>
      </div>
      {auditResult && <p role="status" className="text-sm">{auditResult.detail} {auditResult.hosts.join(' → ')}</p>}
    </div>
    <SponsorOfferWidgets offerId={offerId} />
    <PurchaseSettings offerId={offerId} data={query.data} />
    {query.data.buyers.length ? <DataTable cols={['Acheteur', 'Achats', 'Dernier achat', 'Accord offres', 'Remerciement']}
      rows={query.data.buyers.map(buyer => [
        buyer.email, buyer.purchases, new Date(buyer.last_purchase_at).toLocaleString('fr-FR'),
        buyer.subscribed ? 'Confirmé' : '—', sendLabels[buyer.thank_you_status] ?? '—',
      ])} /> : <p className="text-sm text-muted-foreground">Aucun achat confirmé sur cette page.</p>}
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={page === 0 || query.isFetching} onClick={() => setPage(page - 1)}>Précédent</Button>
      <Button variant="outline" size="sm" disabled={query.data.buyers.length < 50 || query.isFetching} onClick={() => setPage(page + 1)}>Suivant</Button>
      <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser</Button>
    </div>
  </div>;
}

export function SponsorBuyers({ offers }: { offers: { id: string; name: string }[] }) {
  const [selected, setSelected] = useState('');
  if (!offers.length) return null;
  const offerId = offers.some(offer => offer.id === selected) ? selected : offers[0]!.id;
  return <Panel title="Acheteurs confirmés">
    <label className="mb-4 block max-w-sm space-y-1 text-sm"><span>Offre sponsor</span>
      <select className={selectStyle} value={offerId} onChange={e => setSelected(e.target.value)}>
        {offers.map(offer => <option key={offer.id} value={offer.id}>{offer.name}</option>)}
      </select>
    </label>
    <OfferBuyers key={offerId} offerId={offerId} />
  </Panel>;
}
