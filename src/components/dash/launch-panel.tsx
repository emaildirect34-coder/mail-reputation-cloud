import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Rocket, Pause, Play, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Pill, DataTable } from './kit';
import { readSending, launchCampaign, setCampaignStatus } from '@/lib/sending.functions';

const cls = 'h-9 w-full rounded-md border border-border bg-card px-2 text-[12px]';
type Fields = { name: string; fromName: string; fromEmail: string; replyTo: string; subject: string; body: string; sponsorOfferId?:string };

/** Real sending: picks a contact list and agent-equipped servers, then queues the campaign. */
export function LaunchPanel({ d, testMode }: { d: Fields; testMode: boolean }) {
  const qc = useQueryClient(), read = useServerFn(readSending), launch = useServerFn(launchCampaign), status = useServerFn(setCampaignStatus);
  const q = useQuery({ queryKey: ['sending'], queryFn: () => read(), refetchInterval: 15000 });
  const [listId, setListId] = useState(''), [servers, setServers] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await qc.invalidateQueries({ queryKey: ['sending'] }); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  const list = q.data?.lists.find(l => l.id === listId);
  return (
    <section id="envoi" className="card-lux mb-3 scroll-mt-24 p-3.5">
      <h2 className="mb-2 flex items-center gap-2 font-display text-[16px] font-bold text-primary"><Rocket className="size-5" />Envoi réel</h2>
      {q.error && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
      <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
        <div><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Liste de contacts</span>
          <select aria-label="Liste de contacts" className={cls} value={listId} onChange={e => setListId(e.target.value)}><option value="">Choisir une liste</option>{(q.data?.lists ?? []).map(l => <option key={l.id} value={l.id}>{l.name} · {l.active} actifs</option>)}</select></div>
        <div><span className="mb-1 block text-[11.5px] font-semibold text-muted-foreground">Serveurs d’envoi (agent installé requis)</span>
          <div className="flex flex-wrap gap-1.5">{(q.data?.servers ?? []).map(s => { const on = servers.includes(s.id); return <button key={s.id} type="button" onClick={() => setServers(p => on ? p.filter(x => x !== s.id) : [...p, s.id])} className={`rounded-md border px-2 py-1 text-[12px] font-semibold ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card'}`}>{s.label}</button>; })}{!q.data?.servers.length && <span className="text-[12px] text-muted-foreground">Aucun serveur. <Link to="/dashboard/servers" className="text-primary underline">Ajouter un serveur</Link></span>}</div></div>
        <Button disabled={busy || testMode || !listId || !servers.length} onClick={() => run(async () => { const r = await launch({ data: { sponsorOfferId:d.sponsorOfferId||undefined, name: d.name, fromName: d.fromName, fromEmail: d.fromEmail, replyTo: d.replyTo, subject: d.subject, html: d.body, listId, serverIds: servers } }); toast.success(`${r.total} email(s) en file · ${r.suppressed} supprimé(s)`); })}><Rocket className="h-4 w-4" /> Lancer l’envoi</Button>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">{testMode ? 'Désactivez le Mode Test pour lancer un envoi réel. ' : ''}Les adresses désinscrites ou en liste de suppression sont retirées automatiquement. Un lien de désinscription en un clic est ajouté à chaque email.{list ? ` Liste choisie : ${list.active} contact(s) actif(s).` : ''} <Link to="/dashboard/suppression" className="text-primary underline">Gérer les listes</Link></p>
      {!!q.data?.campaigns.length && <div className="mt-3"><DataTable cols={['Campagne', 'Objet', 'Envoyés', 'En file', 'Échecs', 'Supprimés', 'État', '']} rows={q.data.campaigns.map(c => [c.name, c.subject, String(c.sent), String(c.queued), String(c.failed), String(c.suppressed),
        <Pill tone={c.status === 'done' ? 'ok' : c.status === 'queued' ? 'warn' : 'neutral'}>{({ queued: 'En cours', paused: 'En pause', done: 'Terminée', cancelled: 'Annulée' } as Record<string, string>)[c.status] ?? c.status}</Pill>,
        c.status === 'done' || c.status === 'cancelled' ? '—' : <div className="flex gap-1">{c.status === 'queued' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => status({ data: { id: c.id, status: 'paused' } }))}><Pause className="h-3 w-3" /></Button> : <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => status({ data: { id: c.id, status: 'queued' } }))}><Play className="h-3 w-3" /></Button>}<Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => status({ data: { id: c.id, status: 'cancelled' } }))}><X className="h-3 w-3" /></Button></div>])} /></div>}
    </section>
  );
}
