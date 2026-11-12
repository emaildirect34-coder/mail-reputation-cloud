import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, Panel, Pill } from '@/components/dash/kit';
import { inboxTestServers } from '@/lib/sending.functions';
import { confirmSenderProfileCode, createSenderReplyChannel, issueSenderProfileCode, markSenderProfileReplyHandled, readSenderProfileReplies, readSenderProfiles, revokeSenderReplyChannel, saveSenderProfile, senderReplyChannelEnabled } from '@/lib/sender-profiles.functions';

export const Route = createFileRoute('/dashboard/sender-profiles')({
  head: () => ({ meta: [{ title: 'Profils expéditeur — Email Direct' }] }),
  component: SenderProfilesPage,
});

type Profile = NonNullable<Awaited<ReturnType<typeof readSenderProfiles>>>[number];
const key = ['sender-profiles'];

function ProfileEditor({ profile, onDone }: { profile?: Profile; onDone: () => void }) {
  const [draft, setDraft] = useState({
    label: profile?.label ?? '', fromName: profile?.from_name ?? '', fromEmail: profile?.from_email ?? '',
    replyTo: profile?.reply_to ?? '', enabled: profile?.enabled ?? true,
  });
  const save = useServerFn(saveSenderProfile);
  const cache = useQueryClient();
  const update = useMutation({
    mutationFn: () => save({ data: { ...draft, id: profile?.id } }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: key });
      toast.success('Profil expéditeur enregistré.');
      onDone();
    },
    onError: error => toast.error(error.message),
  });
  const fields = [
    ['label', 'Nom du profil', 'text', true],
    ['fromName', 'Nom affiché', 'text', true],
    ['fromEmail', 'Adresse d’envoi', 'email', true],
    ['replyTo', 'Adresse de réponse (facultative)', 'email', false],
  ] as const;
  return <form className="space-y-3" onSubmit={event => { event.preventDefault(); update.mutate(); }}>
    <div className="grid gap-3 sm:grid-cols-2">{fields.map(([field, text, type, required]) =>
      <label key={field} className="grid gap-1 text-sm">{text}
        <Input type={type} value={draft[field]} required={required} maxLength={type === 'email' ? 254 : 120}
          onChange={event => setDraft(previous => ({ ...previous, [field]: event.target.value }))} />
      </label>)}</div>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={draft.enabled} onChange={event => setDraft(previous => ({ ...previous, enabled: event.target.checked }))} />
      Activer le profil
    </label>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={update.isPending}>Enregistrer</Button>
      <Button size="sm" type="button" variant="outline" disabled={update.isPending} onClick={onDone}>Annuler</Button>
    </div>
  </form>;
}

function VerifyAddress({ profileId, serverId, address, target, verified, enabled }: {
  profileId: string; serverId: string; address: string; target: 'from' | 'reply'; verified: boolean; enabled: boolean;
}) {
  const [code, setCode] = useState('');
  const send = useServerFn(issueSenderProfileCode);
  const confirm = useServerFn(confirmSenderProfileCode);
  const cache = useQueryClient();
  const issue = useMutation({
    mutationFn: () => send({ data: { id: profileId, serverId, target } }),
    onSuccess: () => { setCode(''); toast.success('Code mis en file. Consulte la boîte indiquée.'); },
    onError: error => toast.error(error.message),
  });
  const check = useMutation({
    mutationFn: () => confirm({ data: { id: profileId, target, code } }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: key });
      toast.success('Adresse vérifiée.');
    },
    onError: error => toast.error(error.message),
  });
  const busy = issue.isPending || check.isPending;
  return <div className="space-y-2 rounded-md border p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <strong>{target === 'from' ? 'Adresse d’envoi' : 'Adresse de réponse'}</strong>
      <span className="break-all">{address}</span>
      <Pill tone={verified ? 'ok' : 'warn'}>{verified ? 'Vérifiée' : 'À vérifier'}</Pill>
    </div>
    {enabled && !verified && <div className="flex flex-wrap items-end gap-2">
      <Button size="sm" type="button" variant="outline" disabled={!serverId || busy} onClick={() => issue.mutate()}>Envoyer un code</Button>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); check.mutate(); }}>
        <label className="grid gap-1 text-xs">
          Code à huit chiffres
          <Input className="w-36" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
        </label>
        <Button size="sm" disabled={busy || code.length !== 8}>Vérifier</Button>
      </form>
    </div>}
  </div>;
}

function SenderReplies({ profileId, enabled, verified }: { profileId: string; enabled: boolean; verified: boolean }) {
  const cache = useQueryClient();
  const readEnabled = useServerFn(senderReplyChannelEnabled);
  const readReplies = useServerFn(readSenderProfileReplies);
  const create = useServerFn(createSenderReplyChannel);
  const revoke = useServerFn(revokeSenderReplyChannel);
  const mark = useServerFn(markSenderProfileReplyHandled);
  const [newToken, setNewToken] = useState<string>();
  const channel = useQuery({ queryKey: ['sender-reply-channel', profileId], queryFn: () => readEnabled({ data: { id: profileId } }) });
  const replies = useQuery({ queryKey: ['sender-profile-replies', profileId], queryFn: () => readReplies({ data: { id: profileId } }), refetchInterval: 60_000, enabled: channel.data === true });
  const createMutation = useMutation({ mutationFn: () => create({ data: { id: profileId } }), onSuccess: async result => { setNewToken(result.token); await cache.invalidateQueries({ queryKey: ['sender-reply-channel', profileId] }); toast.success('Canal de réponses créé. Copie son jeton maintenant.'); }, onError: error => toast.error(error.message) });
  const revokeMutation = useMutation({ mutationFn: () => revoke({ data: { id: profileId } }), onSuccess: async () => { setNewToken(undefined); await Promise.all([cache.invalidateQueries({ queryKey: ['sender-reply-channel', profileId] }), cache.invalidateQueries({ queryKey: ['sender-profile-replies', profileId] })]); toast.success('Canal révoqué.'); }, onError: error => toast.error(error.message) });
  const markMutation = useMutation({ mutationFn: (data: { replyId: string; handled: boolean }) => mark({ data: { id: profileId, ...data } }), onSuccess: () => cache.invalidateQueries({ queryKey: ['sender-profile-replies', profileId] }), onError: error => toast.error(error.message) });
  return <section className="space-y-3 rounded-md border p-3">
    <div><h3 className="font-medium">Suivi des réponses</h3><p className="text-xs text-muted-foreground">Prépare un point d’entrée sécurisé pour un connecteur de boîte de réception. Les messages ne sont pas relevés automatiquement par cette page.</p></div>
    {!channel.isPending && <div className="flex flex-wrap items-center gap-2 text-sm">
      <Pill tone={channel.data ? 'ok' : 'neutral'}>{channel.data ? 'Canal actif' : 'Canal non configuré'}</Pill>
      {!channel.data ? <Button size="sm" variant="outline" disabled={!enabled || !verified || createMutation.isPending} onClick={() => createMutation.mutate()}>Créer un canal</Button>
        : <Button size="sm" variant="outline" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate()}>Révoquer le canal</Button>}
    </div>}
    {newToken && <div className="space-y-1 rounded bg-muted p-3 text-xs"><p>Copie ce jeton maintenant : il ne sera plus affiché après avoir quitté cette page.</p><code className="block break-all">{newToken}</code><p>Le connecteur doit transmettre seulement In-Reply-To, un identifiant de source et la date de réception à <code>/api/public/sender-replies</code>.</p></div>}
    {channel.data && <div className="space-y-2">
      {replies.error && <p role="alert" className="text-sm text-destructive">{replies.error.message}</p>}
      {replies.data === null && <p className="text-sm text-muted-foreground">Applique la migration 0075 pour activer le suivi.</p>}
      {replies.data?.map(reply => <div key={reply.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
        <span className="min-w-40 flex-1"><strong>{reply.email || 'Adresse indisponible'}</strong><span className="block text-xs text-muted-foreground">{reply.campaign} · {new Date(reply.received_at).toLocaleString()}</span></span>
        <Pill tone={reply.handled_at ? 'ok' : 'warn'}>{reply.handled_at ? 'Traitée' : 'À traiter'}</Pill>
        <Button size="sm" variant="outline" disabled={markMutation.isPending} onClick={() => markMutation.mutate({ replyId: reply.id, handled: !reply.handled_at })}>{reply.handled_at ? 'Rouvrir' : 'Marquer traitée'}</Button>
      </div>)}
      {replies.data?.length === 0 && <p className="text-sm text-muted-foreground">Aucune réponse signalée par le connecteur.</p>}
    </div>}
  </section>;
}

function ProfileCard({ profile, serverId }: { profile: Profile; serverId: string }) {
  const [editing, setEditing] = useState(false);
  return <article className="space-y-3 rounded-lg border bg-card p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="font-medium">{profile.label}</h2>
      <span className="text-sm text-muted-foreground">{profile.from_name}</span>
      <Pill tone={profile.enabled && profile.verified ? 'ok' : 'neutral'}>{profile.enabled ? profile.verified ? 'Prêt à utiliser' : 'Vérification requise' : 'Désactivé'}</Pill>
      {!editing && <Button className="ml-auto" size="sm" variant="outline" onClick={() => setEditing(true)}>Modifier</Button>}
    </div>
    {editing ? <ProfileEditor profile={profile} onDone={() => setEditing(false)} /> : <>
      <VerifyAddress key={profile.from_email} profileId={profile.id} serverId={serverId} address={profile.from_email}
        target="from" verified={!!profile.from_verified_at} enabled={profile.enabled} />
      {profile.reply_to && profile.reply_to !== profile.from_email && <VerifyAddress key={profile.reply_to}
        profileId={profile.id} serverId={serverId} address={profile.reply_to}
        target="reply" verified={!!profile.reply_verified_at} enabled={profile.enabled} />}
      <SenderReplies profileId={profile.id} enabled={profile.enabled} verified={profile.verified} />
    </>}
  </article>;
}

function SenderProfilesPage() {
  const read = useServerFn(readSenderProfiles);
  const readServers = useServerFn(inboxTestServers);
  const profiles = useQuery({ queryKey: key, queryFn: () => read() });
  const servers = useQuery({ queryKey: ['campaign-send-servers'], queryFn: () => readServers() });
  const [creating, setCreating] = useState(false);
  const [serverId, setServerId] = useState('');

  return <>
    <PageHeader title="Profils expéditeur" desc="Enregistre tes identités d’envoi pour les réutiliser dans tes campagnes." />
    <Panel title="Identités d’envoi" action={profiles.data && !creating
      ? <Button size="sm" onClick={() => setCreating(true)}>Ajouter un profil</Button> : undefined}>
      <div className="space-y-3">
        {profiles.isPending && <p role="status" className="text-sm">Chargement des profils…</p>}
        {profiles.error && <p role="alert" className="text-sm text-destructive">{profiles.error.message}</p>}
        {profiles.data === null && <p className="text-sm text-muted-foreground">Les profils expéditeur nécessitent la mise à jour 0068.</p>}
        {creating && <ProfileEditor onDone={() => setCreating(false)} />}
        {!!profiles.data?.some(profile => profile.enabled && !profile.verified) && <div className="space-y-1">
          <label className="grid max-w-sm gap-1 text-sm">Serveur pour les codes de vérification
            <select className="h-9 rounded-md border bg-background px-2" value={serverId} onChange={event => setServerId(event.target.value)}>
              <option value="">Choisir un serveur</option>
              {(servers.data ?? []).map(server => <option key={server.id} value={server.id}>{server.label}</option>)}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">Choisis un serveur où le domaine expéditeur est installé. Chaque code expire après 15 minutes.</p>
          {servers.error && <p role="alert" className="text-sm text-destructive">{servers.error.message}</p>}
        </div>}
        {profiles.data?.map(profile => <ProfileCard key={profile.id} profile={profile} serverId={serverId} />)}
        {profiles.data?.length === 0 && !creating && <p className="text-sm text-muted-foreground">Aucun profil expéditeur enregistré.</p>}
      </div>
    </Panel>
  </>;
}
