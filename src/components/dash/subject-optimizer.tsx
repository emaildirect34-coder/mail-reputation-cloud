import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Sparkles, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { suggestSubjects } from '@/lib/subjects.functions';

const SPAM = ['gratuit', 'urgent', 'gagnez', 'gagné', '100%', 'argent facile', 'cliquez ici', 'promo exclusive', 'félicitations', '€€€', 'free', 'winner'];

export function subjectWarnings(s: string): string[] {
  const w: string[] = [];
  const clean = s.replace(/\{[^}]+\}/g, 'Prénom');
  if (clean.length > 50) w.push(`${clean.length} caractères : coupé sur mobile (idéal ≤ 50).`);
  const letters = clean.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length > 6 && letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length > 0.5) w.push('Trop de MAJUSCULES.');
  if (/[!?]{2,}/.test(clean)) w.push('Ponctuation répétée (!! ou ??).');
  const hit = SPAM.filter(m => clean.toLowerCase().includes(m));
  if (hit.length) w.push(`Mots à risque : ${hit.join(', ')}.`);
  if (/^(re|tr|fw|fwd)\s*:/i.test(clean)) w.push('Faux « RE:/TR: » pénalisé par les FAI.');
  return w;
}

type Idea = { angle: string; subject: string; preheader: string; why: string };

export function SubjectOptimizer({ subject, body, offer, onApply }: { subject: string; body: string; offer?: string; onApply: (subject: string, preheader: string) => void }) {
  const run = useServerFn(suggestSubjects);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [busy, setBusy] = useState(false);
  const current = subjectWarnings(subject);

  async function go() {
    setBusy(true);
    try { setIdeas(await run({ data: { subject, body, offer } })); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Échec'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-2 rounded-xl border border-border/60 p-3">
    <div className="flex items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-[12px] font-bold text-primary"><Sparkles className="size-4" />Optimiseur d'objet IA</p>
      <button type="button" onClick={go} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-60">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{ideas.length ? 'Régénérer' : '5 propositions'}
      </button>
    </div>
    {current.length > 0
      ? <ul className="space-y-0.5">{current.map(w => <li key={w} className="flex items-start gap-1 text-[11px] text-warning"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{w}</li>)}</ul>
      : subject && <p className="flex items-center gap-1 text-[11px] text-success"><Check className="size-3" />Objet actuel lisible et sans mot à risque.</p>}
    {ideas.map(i => {
      const warn = subjectWarnings(i.subject);
      return <div key={i.angle + i.subject} className="rounded-lg border border-border bg-card p-2">
        <div className="flex items-center justify-between gap-2"><span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{i.angle}</span><span className="text-[10px] text-muted-foreground">{i.subject.length} car.</span></div>
        <p className="mt-1 text-[12.5px] font-semibold">{i.subject}</p>
        <p className="text-[11.5px] text-muted-foreground">{i.preheader}</p>
        <p className="mt-1 text-[10.5px] italic text-muted-foreground">{i.why}</p>
        {warn.length > 0 && <p className="mt-1 text-[10.5px] text-warning">{warn.join(' ')}</p>}
        <button type="button" onClick={() => { onApply(i.subject, i.preheader); toast.success('Objet et pré-en-tête appliqués.'); }} className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-primary px-2 py-0.5 text-[11px] font-semibold text-primary"><Check className="size-3" />Utiliser</button>
      </div>;
    })}
  </div>;
}
