import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { KeyRound, FileCode2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Panel, Pill } from './kit';
import { issueAgentToken, previewAgentConfig } from '@/lib/infrastructure.functions';

type Agent = { status: string; agent_version: string | null; kumo_version: string | null; config_hash: string | null; applied_hash: string | null; metrics: any; last_error: string | null; last_seen: string | null };

export function AgentPanel({ serverId, agent, admin }: { serverId: string; agent?: Agent | undefined; admin: boolean }) {
  const qc = useQueryClient(), issue = useServerFn(issueAgentToken), preview = useServerFn(previewAgentConfig);
  const [cmd, setCmd] = useState(''), [lua, setLua] = useState(''), [busy, setBusy] = useState(false);
  const stale = agent?.last_seen ? Date.now() - new Date(agent.last_seen).getTime() > 5 * 60_000 : true;
  const tone = !agent ? 'neutral' : agent.status === 'error' ? 'bad' : agent.status === 'online' && !stale ? 'ok' : 'warn';
  const label = !agent ? 'Non installé' : agent.status === 'awaiting' ? 'En attente de la 1re connexion' : agent.status === 'error' ? 'Erreur' : stale ? 'Hors ligne' : 'En ligne';
  const synced = agent?.config_hash && agent.config_hash === agent.applied_hash;
  const m = agent?.metrics ?? {};
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success('Copié'));
  const go = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  return (
    <Panel title="Moteur KumoMTA">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div><p className="text-muted-foreground">Agent</p><Pill tone={tone as any}>{label}</Pill></div>
        <div><p className="text-muted-foreground">Configuration</p><p>{!agent?.config_hash ? '—' : synced ? 'Appliquée' : 'En cours d’application'}</p></div>
        <div><p className="text-muted-foreground">CPU / RAM</p><p>{m.cpu != null ? `${Math.round(m.cpu)} % / ${Math.round(m.ram ?? 0)} %` : '—'}</p></div>
        <div><p className="text-muted-foreground">Dernier contact</p><p>{agent?.last_seen ? new Date(agent.last_seen).toLocaleString('fr-FR') : '—'}</p></div>
      </div>
      {agent?.kumo_version && <p className="mt-2 text-xs text-muted-foreground">{agent.kumo_version} · agent {agent.agent_version}</p>}
      {agent?.last_error && <p role="alert" className="mt-2 text-sm text-destructive break-all">{agent.last_error}</p>}
      <p className="mt-3 text-sm text-muted-foreground">L’agent récupère chaque minute la configuration (pools, IPs, quotas de chauffe, double DKIM) et installe automatiquement les clés DKIM des domaines associés.</p>
      {admin && <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => go(async () => { const r = await issue({ data: { id: serverId } }); setCmd(`curl -fsSL ${location.origin}/api/public/agent/install.sh | sudo KAG_TOKEN=${r.token} bash`); await qc.invalidateQueries({ queryKey: ['infrastructure'] }); })}><KeyRound className="h-4 w-4" /> {agent ? 'Réinstaller l’agent' : 'Installer l’agent'}</Button>
        <Button variant="outline" disabled={busy} onClick={() => go(async () => setLua((await preview({ data: { id: serverId } })).lua))}><FileCode2 className="h-4 w-4" /> Voir la configuration</Button>
      </div>}
      {cmd && <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
        <p className="mb-2 text-sm">À lancer une seule fois sur le serveur (connecté en root). Ce code n’est affiché qu’une fois.</p>
        <code className="block break-all text-xs">{cmd}</code>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => copy(cmd)}><Copy className="h-3 w-3" /> Copier</Button>
      </div>}
      {lua && <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs">{lua}</pre>}
    </Panel>
  );
}
