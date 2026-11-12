import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { deleteEmailContentBlock, readEmailTemplateLibrary, readEmailTemplateVersions, restoreEmailTemplateVersion, saveEmailContentBlock, saveEmailTemplate } from '@/lib/email-template.functions';

type Snapshot = { name: string; subject: string; html: string };
const key = ['email-template-library'];

export function EmailTemplateLibrary({ subject, html, onApply }: { subject: string; html: string; onApply: (subject: string, html: string) => void }) {
  const client = useQueryClient();
  const read = useServerFn(readEmailTemplateLibrary);
  const versionsRead = useServerFn(readEmailTemplateVersions);
  const save = useServerFn(saveEmailTemplate);
  const restore = useServerFn(restoreEmailTemplateVersion);
  const saveBlock = useServerFn(saveEmailContentBlock);
  const deleteBlock = useServerFn(deleteEmailContentBlock);
  const query = useQuery({ queryKey: key, queryFn: () => read() });
  const [selected, setSelected] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [blockName, setBlockName] = useState('');
  const [blockHtml, setBlockHtml] = useState('');
  const [editingBlock, setEditingBlock] = useState('');
  const versions = useQuery({ queryKey: [...key, selected, 'versions'], queryFn: () => versionsRead({ data: { id: selected } }), enabled: !!selected });
  const mutateSave = useMutation({
    mutationFn: () => save({ data: { id: selected || null, name: templateName, subject, html } }),
    onSuccess: async result => { setSelected(result.id); setTemplateName(''); await client.invalidateQueries({ queryKey: key }); toast.success(`Modèle enregistré · version ${result.version}.`); },
    onError: error => toast.error(error.message),
  });
  const mutateRestore = useMutation({
    mutationFn: (version: number) => restore({ data: { id: selected, version } }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: key }); await client.invalidateQueries({ queryKey: [...key, selected, 'versions'] }); toast.success('Version restaurée comme nouvelle version. Recharge le modèle pour l’appliquer au brouillon.'); },
    onError: error => toast.error(error.message),
  });
  const mutateBlock = useMutation({
    mutationFn: () => saveBlock({ data: { id: editingBlock || null, name: blockName, html: blockHtml } }),
    onSuccess: async () => { setBlockName(''); setBlockHtml(''); setEditingBlock(''); await client.invalidateQueries({ queryKey: key }); toast.success('Bloc enregistré.'); },
    onError: error => toast.error(error.message),
  });
  const removeBlock = useMutation({ mutationFn: (id: string) => deleteBlock({ data: { id } }), onSuccess: () => client.invalidateQueries({ queryKey: key }), onError: error => toast.error(error.message) });
  const active = query.data?.templates.find(item => item.id === selected);
  function applySelected() {
    if (!active) return;
    onApply(active.subject, active.html);
    setTemplateName(active.name);
    toast.success('Modèle chargé dans le brouillon.');
  }
  return <details className="rounded-lg border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Modèles enregistrés et blocs réutilisables</summary>
    {query.error && <p role="alert" className="mt-2 text-destructive">{query.error.message}</p>}
    {query.data === null && <p className="mt-2 text-muted-foreground">Applique la migration 0077 pour activer la bibliothèque.</p>}
    {query.data && <div className="mt-3 space-y-4">
      <section className="space-y-2 rounded-md bg-muted/40 p-3">
        <h3 className="font-medium">Modèles avec historique</h3>
        <div className="flex flex-wrap gap-2">
          <select className="h-9 min-w-56 rounded-md border bg-background px-2" aria-label="Choisir un modèle" value={selected} onChange={event => { setSelected(event.target.value); const item = query.data?.templates.find(template => template.id === event.target.value); setTemplateName(item?.name ?? ''); }}>
            <option value="">Nouveau modèle</option>{query.data.templates.map(template => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}
          </select>
          {active && <Button size="sm" type="button" variant="outline" onClick={applySelected}>Charger dans le brouillon</Button>}
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); mutateSave.mutate(); }}>
          <Input className="max-w-sm" aria-label="Nom du modèle" placeholder="Nom du modèle" required maxLength={120} value={templateName} onChange={event => setTemplateName(event.target.value)} />
          <Button size="sm" disabled={mutateSave.isPending || !templateName.trim()}>{mutateSave.isPending ? 'Enregistrement…' : active ? 'Enregistrer une nouvelle version' : 'Enregistrer ce brouillon'}</Button>
        </form>
        {active && <div className="space-y-1 border-t pt-2">
          <p className="text-xs text-muted-foreground">Les restaurations sont enregistrées comme une nouvelle version.</p>
          {versions.error && <p role="alert" className="text-xs text-destructive">{versions.error.message}</p>}
          {versions.data?.map(version => {
            const snapshot = version.snapshot as Snapshot;
            return <div key={version.version} className="flex flex-wrap items-center gap-2 text-xs"><span>v{version.version} · {new Date(version.created_at).toLocaleString('fr-FR')}</span><span className="truncate text-muted-foreground">{snapshot.name}</span>{version.version !== active.version && <Button size="sm" type="button" variant="ghost" disabled={mutateRestore.isPending} onClick={() => { if (confirm(`Restaurer la version ${version.version} ? Elle sera créée comme nouvelle version.`)) mutateRestore.mutate(version.version); }}>Restaurer</Button>}</div>;
          })}
        </div>}
      </section>
      <section className="space-y-2 rounded-md bg-muted/40 p-3">
        <h3 className="font-medium">Blocs HTML réutilisables</h3>
        <p className="text-xs text-muted-foreground">Les blocs sont ajoutés à la fin du brouillon. Vérifie le rendu et les liens avant l’envoi.</p>
        <div className="flex flex-wrap gap-2">{query.data.blocks.map(block => <div key={block.id} className="flex items-center gap-1 rounded border bg-background px-2 py-1">
          <span>{block.name}</span><Button size="sm" type="button" variant="ghost" onClick={() => onApply(subject, `${html}\n${block.html}`)}>Insérer</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => { setEditingBlock(block.id); setBlockName(block.name); setBlockHtml(block.html); }}>Modifier</Button>
          <Button size="sm" type="button" variant="ghost" disabled={removeBlock.isPending} onClick={() => { if (confirm(`Supprimer le bloc « ${block.name} » ?`)) removeBlock.mutate(block.id); }}>Supprimer</Button>
        </div>)}</div>
        <form className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]" onSubmit={event => { event.preventDefault(); mutateBlock.mutate(); }}>
          <Input aria-label="Nom du bloc" placeholder="Nom du bloc" maxLength={120} required value={blockName} onChange={event => setBlockName(event.target.value)} />
          <Textarea aria-label="HTML du bloc" placeholder="HTML responsive du bloc" maxLength={100_000} required value={blockHtml} onChange={event => setBlockHtml(event.target.value)} />
          <Button size="sm" disabled={mutateBlock.isPending || !blockName.trim() || !blockHtml.trim()}>{editingBlock ? 'Mettre à jour' : 'Ajouter le bloc'}</Button>
        </form>
      </section>
    </div>}
  </details>;
}
