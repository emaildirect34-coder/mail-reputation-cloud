import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Sparkles, Loader2, Check, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Pill } from './kit';
import { diagnoseEmail } from '@/lib/ai.functions';
import { aiSkills, canApplyText, type AiInput, type AiResult } from '@/lib/ai.schemas';

export function AiDiagnostic({ input, onApply, before = '', compact = false }: {
  input: AiInput; onApply?: (replacement: string) => void; before?: string; compact?: boolean;
}) {
  const diagnose = useServerFn(diagnoseEmail);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AiResult | null>(null);
  const [snapshot, setSnapshot] = useState('');
  const [applied, setApplied] = useState(false);
  async function analyze() {
    setBusy(true); setError(''); setResult(null); setApplied(false); setSnapshot(before);
    try { setResult(await diagnose({ data: input })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Analyse indisponible'); }
    finally { setBusy(false); }
  }
  const changed = snapshot !== before && !applied;
  return <>
    <Button variant="outline" size={compact ? 'icon' : 'sm'} aria-label={`IA · ${aiSkills[input.skill].title}`} title={`IA · ${aiSkills[input.skill].title}`} onClick={() => { setOpen(true); setResult(null); setError(''); setApplied(false); }}>
      <Sparkles className="size-4"/>{!compact && `IA · ${aiSkills[input.skill].title}`}
    </Button>
    <Dialog open={open} onOpenChange={v => { if (!busy) setOpen(v); }}>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-lg">
        <DialogTitle>IA Gateway · {aiSkills[input.skill].title}</DialogTitle>
        <DialogDescription>Diagnostic sur demande · proposition à valider · aucune garantie de placement inbox</DialogDescription>
        <div className="flex flex-wrap items-center gap-2"><Pill>GPT-6 Astra</Pill><Button disabled={busy} onClick={() => void analyze()}>{busy ? <Loader2 className="size-4 animate-spin"/> : <Sparkles className="size-4"/>}{busy ? 'Analyse en cours…' : 'Analyser'}</Button></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {result && <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2"><Pill tone={result.risk === 'high' ? 'bad' : result.risk === 'medium' ? 'warn' : result.risk === 'low' ? 'ok' : 'neutral'}>Risque {({low:'faible',medium:'modéré',high:'élevé',unknown:'indéterminé'})[result.risk]}</Pill><Pill>Évaluation qualitative</Pill></div>
          <p className="whitespace-pre-wrap break-words">{result.summary}</p>
          {[{title:'Constats',items:result.findings},{title:'Recommandations',items:result.recommendations},{title:'Limites',items:result.limitations}].map(g => g.items.length > 0 && <div key={g.title}><h3 className="font-semibold">{g.title}</h3><ul className="mt-1 list-disc space-y-1 pl-5">{g.items.map((t,i)=><li className="break-words" key={i}>{t}</li>)}</ul></div>)}
          {onApply && canApplyText(input.skill, result) && <>
            <label className="block space-y-1 font-semibold">Avant<Textarea aria-label="Avant correction IA" readOnly value={snapshot} className="min-h-24 font-normal"/></label>
            <label className="block space-y-1 font-semibold">Proposition<Textarea aria-label="Proposition IA" readOnly value={result.replacement} className="min-h-24 font-normal"/></label>
            {changed && <p role="alert" className="text-destructive">Le contenu a changé. Relancez l’analyse avant application.</p>}
            <div className="flex flex-wrap gap-2"><Button disabled={applied || changed} onClick={() => { onApply(result.replacement); setApplied(true); }}><Check className="size-4"/>{applied ? 'Appliqué au brouillon' : 'Appliquer au brouillon'}</Button>{applied && <Button variant="outline" onClick={() => { onApply(snapshot); setApplied(false); }}><Undo2 className="size-4"/>Annuler la correction</Button>}</div>
          </>}
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}