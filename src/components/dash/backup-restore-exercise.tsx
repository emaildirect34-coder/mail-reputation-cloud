import { useEffect, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const items = [
  'Repérer la date et le point de restauration disponibles dans Lovable Cloud.',
  'Restaurer dans un environnement de test séparé, jamais par-dessus la production pour cet exercice.',
  'Vérifier les tables clés, les migrations, les rôles et les accès des agents.',
  'Effectuer une vérification de lecture et de navigation avant de conclure l’exercice.',
  'Noter la date, le résultat, le temps de restauration et les écarts à corriger.',
];
const storageKey = 'email-direct-backup-restore-checklist-v1';

export function BackupRestoreExercise() {
  const [checked, setChecked] = useState<boolean[]>(items.map(() => false));
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); if (Array.isArray(saved) && saved.length === items.length) setChecked(saved); } catch { /* Start with an empty exercise. */ }
  }, []);
  function update(index: number, value: boolean) {
    setChecked(previous => {
      const next = previous.map((item, i) => i === index ? value : item);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* The checklist still works for this page view. */ }
      return next;
    });
  }
  return <section className="space-y-3 rounded-xl border p-4">
    <div><h3 className="font-semibold">Exercice guidé de restauration</h3><p className="mt-1 text-xs text-muted-foreground">Cette checklist accompagne un exercice manuel dans Lovable Cloud. Elle ne déclenche pas la restauration ni ne certifie la sauvegarde.</p></div>
    <ol className="space-y-2">{items.map((label, index) => <li key={label}><label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" checked={checked[index]} onChange={event => update(index, event.target.checked)} className="mt-1" /><span>{label}</span></label></li>)}</ol>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{checked.filter(Boolean).length}/{items.length} étapes notées</span>
      {checked.every(Boolean) && <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="h-3.5 w-3.5" />Checklist terminée localement</span>}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setChecked(items.map(() => false)); localStorage.removeItem(storageKey); }}><RotateCcw className="mr-1 h-3.5 w-3.5" />Réinitialiser</Button>
    </div>
  </section>;
}
