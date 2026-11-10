import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EmailPreview } from './email-preview';

const names = { title: 'Titre', text: 'Texte', button: 'Bouton', image: 'Image', divider: 'Séparateur', unsubscribe: 'Désinscription' } as const;
type Kind = keyof typeof names;
type Block = { id: string; kind: Kind; text: string; url: string };
const escaped = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function safeUrl(value: string) {
  if (value === '{offer_url}' || value === '{image_url}') return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? escaped(url.href) : '';
  } catch {
    return '';
  }
}

function render(blocks: Block[]) {
  const rows = blocks.map(block => {
    const text = escaped(block.text).replace(/\r?\n/g, '<br>');
    const url = safeUrl(block.url);
    const content = {
      title: `<h1 style="margin:0;font-size:26px">${text}</h1>`,
      text: `<p style="margin:0;font-size:16px;line-height:1.5">${text}</p>`,
      button: url ? `<a href="${url}" style="display:inline-block;padding:12px 20px;background:#17396b;color:#fff;text-decoration:none">${text}</a>` : '',
      image: url ? `<img src="${url}" alt="${escaped(block.text)}" style="display:block;max-width:100%;height:auto;border:0">` : '',
      divider: '<hr style="border:0;border-top:1px solid #ddd">',
      unsubscribe: '<a href="{unsubscribe_url}" style="font-size:12px;color:#555">Se désinscrire</a>',
    }[block.kind];
    return `<tr><td style="padding:12px 20px">${content}</td></tr>`;
  });
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;font-family:Arial,sans-serif;color:#172036">${rows.join('\n')}</table>`;
}

export function VisualEmailEditor({ onApply }: { onApply: (html: string) => void }) {
  const [open, setOpen] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const html = render(blocks);
  const invalid = blocks.some(block => (block.kind === 'button' || block.kind === 'image') && !safeUrl(block.url));

  function add(kind: Kind) {
    const block = { id: crypto.randomUUID(), kind, text: kind === 'button' ? 'En savoir plus' : '', url: '' };
    setBlocks(current => [...current, block]);
  }
  function edit(id: string, changes: Partial<Pick<Block, 'text' | 'url'>>) {
    setBlocks(current => current.map(block => block.id === id ? { ...block, ...changes } : block));
  }
  function move(id: string, index: number) {
    setBlocks(current => {
      const block = current.find(item => item.id === id);
      if (!block || index < 0 || index >= current.length) return current;
      const next = current.filter(item => item.id !== id);
      next.splice(index, 0, block);
      return next;
    });
  }

  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Éditeur visuel</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-1rem)] overflow-y-auto sm:max-w-4xl">
        <DialogTitle>Éditeur visuel d’e-mail</DialogTitle>
        <DialogDescription>Ajoutez des blocs et réorganisez-les en les glissant ou avec les boutons Monter et Descendre.</DialogDescription>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(names) as Kind[]).map(kind => <Button key={kind} type="button" size="sm" variant="outline" onClick={() => add(kind)}>+ {names[kind]}</Button>)}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <ol className="space-y-2">
            {!blocks.length && <li className="text-sm text-muted-foreground">Ajoutez un bloc pour commencer.</li>}
            {blocks.map((block, index) => <li key={block.id} className="space-y-2 rounded-md border p-2"
              onDragOver={event => { if (dragged) event.preventDefault(); }}
              onDrop={event => { event.preventDefault(); if (dragged) move(dragged, index); setDragged(null); }}>
              <div className="flex flex-wrap items-center gap-1">
                <span draggable onDragStart={event => { event.dataTransfer.setData('text/plain', block.id); setDragged(block.id); }} onDragEnd={() => setDragged(null)}
                  className="mr-auto cursor-grab select-none text-sm font-medium">⠿ {names[block.kind]}</span>
                <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => move(block.id, index - 1)}>Monter</Button>
                <Button type="button" variant="ghost" size="sm" disabled={index === blocks.length - 1} onClick={() => move(block.id, index + 1)}>Descendre</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setBlocks(current => current.filter(item => item.id !== block.id))}>Retirer</Button>
              </div>
              {block.kind === 'text' && <Textarea aria-label="Texte du bloc" value={block.text} onChange={event => edit(block.id, { text: event.target.value })} />}
              {(block.kind === 'title' || block.kind === 'button' || block.kind === 'image') &&
                <Input aria-label={block.kind === 'image' ? 'Texte alternatif' : names[block.kind]} placeholder={block.kind === 'image' ? 'Texte alternatif' : names[block.kind]} value={block.text} onChange={event => edit(block.id, { text: event.target.value })} />}
              {(block.kind === 'button' || block.kind === 'image') &&
                <Input aria-label="Adresse URL" placeholder="https://…" value={block.url} onChange={event => edit(block.id, { url: event.target.value })} />}
            </li>)}
          </ol>
          <EmailPreview html={html} fromName="" subject="Aperçu du modèle" />
        </div>
        {invalid && <p role="status" className="text-sm text-destructive">Renseignez une URL valide pour chaque bouton et image.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Fermer</Button>
          <Button type="button" disabled={!blocks.length || invalid} onClick={() => { onApply(html); setOpen(false); }}>Remplacer le HTML du brouillon</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
