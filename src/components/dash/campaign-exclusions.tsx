import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/dash/kit';
import { exportCampaignExclusions } from '@/lib/sending.functions';

const reasonLabels: Record<string, string> = {
  segment: 'Hors du segment choisi', suppression: 'Désabonné ou supprimé', format: 'Préférence de format',
  invalid_address: 'Adresse invalide', role_address: 'Adresse de fonction', domain_typo: 'Domaine probablement mal saisi',
  inactive: 'Inactif selon la règle choisie', purchased: 'Achat antérieur', brand_block: 'Offres de la marque refusées', dns_unavailable: 'Domaine sans route mail valide',
};
const csv = (value: string) => {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
};

export function CampaignExclusionExport({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const run = useServerFn(exportCampaignExclusions);
  const [campaignId, setCampaignId] = useState('');
  const [busy, setBusy] = useState(false);
  async function download() {
    if (!campaignId || busy) return;
    setBusy(true);
    try {
      const result = await run({ data: { campaignId } });
      if (result === null) { toast.info('Applique la migration 0083 pour enregistrer les exclusions.'); return; }
      const lines = [['email', 'email_md5', 'motif'], ...result.rows.map(row => [row.email ?? '', row.email_md5, reasonLabels[row.reason] ?? row.reason])];
      const blob = new Blob(['\uFEFF' + lines.map(line => line.map(csv).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `exclusions-${result.campaignName.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60)}.csv`; anchor.click(); URL.revokeObjectURL(url);
      toast.success(`${result.rows.length.toLocaleString('fr-FR')} exclusion(s) exportée(s).`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Export indisponible.'); }
    finally { setBusy(false); }
  }
  return <Panel title="Exporter les exclusions d’une campagne">
    <p className="mb-3 text-sm text-muted-foreground">Le fichier indique les adresses retirées de l’audience et leur motif. L’export est réservé au Superadmin et est inscrit au journal d’audit.</p>
    <div className="flex flex-wrap gap-2">
      <select aria-label="Campagne à exporter" className="h-9 min-w-64 rounded-md border bg-background px-2 text-sm" value={campaignId} onChange={event => setCampaignId(event.target.value)}>
        <option value="">Choisir une campagne</option>{campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select>
      <Button variant="outline" disabled={!campaignId || busy} onClick={() => void download()}><Download className="mr-2 h-4 w-4" />{busy ? 'Préparation…' : 'Télécharger CSV'}</Button>
    </div>
  </Panel>;
}
