import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readSponsorCsv, sponsorCsvTransactions } from '@/lib/sponsor-report-import';

const layout = 'h-9 rounded-md border bg-background px-2';
const suggestions = /^(transaction.?id|conversion.?id|order.?id|txid|transaction)$/i;
type Mapping = { transaction: string; status: string; value: string };

export function SponsorCsvImport({ onExtract }: { onExtract: (ids: string[]) => void }) {
  const [network, setNetwork] = useState('cake');
  const [csv, setCsv] = useState<ReturnType<typeof readSponsorCsv>>();
  const [map, setMap] = useState<Mapping>({ transaction: '', status: '', value: 'approved' });
  const key = 'email-direct.sponsor-report-mapping.' + network;
  async function read(file: File) {
    try {
      if (file.size > 2_000_000) throw new Error('Choisis un export de moins de 2 Mo.');
      const parsed = readSponsorCsv(await file.text());
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Mapping | null;
      setMap({
        transaction: parsed.header.includes(saved?.transaction ?? '') ? saved!.transaction : parsed.header.find(name => suggestions.test(name)) ?? '',
        status: parsed.header.includes(saved?.status ?? '') ? saved!.status : '',
        value: typeof saved?.value === 'string' ? saved.value : 'approved',
      });
      setCsv(parsed);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Lecture CSV impossible.'); }
  }
  return <details className="space-y-2 rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Charger un export CSV sponsor</summary>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1">Réseau
        <select className={layout} value={network} onChange={event => { setNetwork(event.target.value); setCsv(undefined); }}>
          <option value="cake">Cake</option><option value="everflow">Everflow</option><option value="autre">Autre</option>
        </select>
      </label>
      <label className="grid gap-1">Export avec en-têtes<Input key={network} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={event => {
        const file = event.target.files?.[0];
        if (file) void read(file);
      }} /></label>
    </div>
    {csv && <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1">Colonne transaction
        <select className={layout} value={map.transaction} onChange={event => setMap({ ...map, transaction: event.target.value })}>
          <option value="">Choisir la colonne</option>{csv.header.map(column => <option key={column}>{column}</option>)}
        </select>
      </label>
      <label className="grid gap-1">Colonne statut
        <select className={layout} value={map.status} onChange={event => setMap({ ...map, status: event.target.value })}>
          <option value="">Export déjà filtré aux achats confirmés</option>{csv.header.map(column => <option key={column}>{column}</option>)}
        </select>
      </label>
      {map.status && <label className="grid gap-1">Valeur du statut confirmé<Input value={map.value} onChange={event => setMap({ ...map, value: event.target.value })} /></label>}
      <Button size="sm" type="button" variant="outline" disabled={!map.transaction || (!!map.status && !map.value.trim())} onClick={() => {
        try {
          const ids = sponsorCsvTransactions(csv.rows, csv.header.indexOf(map.transaction), csv.header.indexOf(map.status), map.value);
          if (!ids.length) { toast.error('Aucun achat confirmé dans la sélection.'); return; }
          localStorage.setItem(key, JSON.stringify(map));
          onExtract(ids);
          toast.success(`${ids.length} référence(s) prêtes à importer.`);
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Extraction impossible.'); }
      }}>Extraire les références</Button>
    </div>}
  </details>;
}
