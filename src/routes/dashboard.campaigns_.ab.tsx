import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Plus, RefreshCw, Trophy, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CampaignTabs, MiniKpi, ModuleHeader, StatusBar } from "@/components/dash/campaign-tabs";
import { Panel } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readAb, startAb, decideAbNow } from "@/lib/ab.functions";
import { wilson95 } from "@/lib/ab-confidence";

export const Route = createFileRoute("/dashboard/campaigns_/ab")({
  head: () => ({ meta: [
    { title: "Tests A/B — Email Direct" },
    { name: "description", content: "Testez plusieurs objets ou expéditeurs sur un échantillon, le gagnant part automatiquement au reste de la liste." },
    { property: "og:title", content: "Tests A/B — Email Direct" },
    { property: "og:description", content: "Split-testing automatique avec envoi du gagnant." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: AbPage,
});

const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0") + " %";

function AbPage() {
  const qc = useQueryClient(), read = useServerFn(readAb), start = useServerFn(startAb), decide = useServerFn(decideAbNow);
  const q = useQuery({ queryKey: ["ab"], queryFn: () => read(), refetchInterval: 30000 });
  const [cid, setCid] = useState(""), [variants, setVariants] = useState([{ subject: "", fromName: "" }, { subject: "", fromName: "" }]);
  const [share, setShare] = useState(20), [hours, setHours] = useState(4), [minSample, setMinSample] = useState(100), [metric, setMetric] = useState<"open" | "click">("open"), [busy, setBusy] = useState(false);
  const tests = q.data?.tests ?? [], eligible = q.data?.eligible ?? [];
  const camp = eligible.find(c => c.id === cid);
  const estimatedPerVariant = camp ? Math.floor(Math.max(variants.length, Math.round(camp.total * share / 100)) / variants.length) : 0;
  const setV = (i: number, k: "subject" | "fromName", v: string) => setVariants(p => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await start({ data: { campaignId: cid, variants, pct: share, hours, minSample, metric } });
      toast.success(`Test lancé : ${r.sample} contacts testés, ${r.holdout} recevront le gagnant.`);
      setCid(""); setVariants([{ subject: "", fromName: "" }, { subject: "", fromName: "" }]);
      await qc.invalidateQueries({ queryKey: ["ab"] });
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };

  return <div className="space-y-3 pb-4">
    <ModuleHeader icon={<FlaskConical />} title="Tests A/B" desc="Envoyez 2 ou 3 versions à un échantillon. La meilleure part automatiquement au reste de la liste." actions={
      <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["ab"] })}><RefreshCw className="size-4" />Actualiser</Button>} />
    <CampaignTabs active="ab" />

    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <MiniKpi icon={<FlaskConical />} label="Tests en cours" value={String(tests.filter(t => t.ab_winner == null).length)} delta="" />
      <MiniKpi icon={<Trophy />} label="Gagnants choisis" value={String(tests.filter(t => t.ab_winner != null).length)} delta="" />
      <MiniKpi icon={<Plus />} label="Campagnes testables" value={String(eligible.length)} delta="" />
      <MiniKpi icon={<Timer />} label="Contacts en test" value={String(tests.reduce((a, t) => a + t.variants.reduce((b, v) => b + v.assigned, 0), 0))} delta="" />
    </div>
    {q.error && <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>}

    <Panel title="Nouveau test A/B">
      <form className="grid gap-3" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Campagne (pas encore envoyée)</Label>
            <select aria-label="Campagne" className={sel} value={cid} onChange={e => setCid(e.target.value)} required>
              <option value="">Choisir une campagne</option>{eligible.map(c => <option key={c.id} value={c.id}>{c.name} — {c.total} contacts</option>)}
            </select>
            {!q.isLoading && !eligible.length && <p className="mt-1 text-xs text-muted-foreground">Créez une campagne et mettez-la en pause avant son premier envoi pour la tester.</p>}
          </div>
          <div><Label>Critère du gagnant</Label>
            <select aria-label="Critère" className={sel} value={metric} onChange={e => setMetric(e.target.value as "open" | "click")}>
              <option value="open">Meilleur taux d'ouverture</option><option value="click">Meilleur taux de clic</option>
            </select></div>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {variants.map((v, i) => <div key={i} className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">Version {String.fromCharCode(65 + i)}
              {i > 1 && <button type="button" aria-label="Retirer" onClick={() => setVariants(p => p.filter((_, j) => j !== i))}><Trash2 className="size-4 text-muted-foreground" /></button>}</div>
            <Label>Objet</Label><Input value={v.subject} onChange={e => setV(i, "subject", e.target.value)} placeholder={camp?.subject ?? "Objet"} />
            <Label className="mt-2 block">Nom d'expéditeur</Label><Input value={v.fromName} onChange={e => setV(i, "fromName", e.target.value)} placeholder={camp?.from_name ?? "Expéditeur"} />
          </div>)}
          {variants.length < 3 && <button type="button" onClick={() => setVariants(p => [...p, { subject: "", fromName: "" }])} className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground"><Plus className="mx-auto size-4" />Ajouter une version C</button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Échantillon testé : {share} % de la liste</Label><input aria-label="Échantillon" type="range" min={5} max={50} value={share} onChange={e => setShare(+e.target.value)} className="w-full" /></div>
          <div><Label>Choisir le gagnant après : {hours} h</Label><input aria-label="Durée" type="range" min={1} max={72} value={hours} onChange={e => setHours(+e.target.value)} className="w-full" /></div>
        </div>
        <div className="grid gap-1 sm:max-w-sm"><Label htmlFor="ab-min-sample">Minimum d’envois par version : {minSample}</Label><input id="ab-min-sample" aria-label="Minimum d’envois par version" type="range" min={30} max={1000} step={10} value={minSample} onChange={e => setMinSample(+e.target.value)} className="w-full" /></div>
        {camp && estimatedPerVariant < minSample && <p role="status" className="text-xs text-amber-700">Avec cet échantillon, environ {estimatedPerVariant} envoi(s) par version sont prévus. Le test terminera sans résultat concluant et la version A sera utilisée, sauf si vous augmentez l’échantillon ou réduisez le minimum.</p>}
        <p className="text-xs text-muted-foreground">Un champ vide reprend l'objet ou l'expéditeur de la campagne. Le reste attend la fin du test. Un gagnant n’est retenu que si l’écart est statistiquement détectable et que chaque version atteint le minimum choisi ; sinon, la version A part au reste de la liste.</p>
        <Button className="w-fit" disabled={busy || !cid}><FlaskConical className="size-4" />Lancer le test</Button>
      </form>
    </Panel>

    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {tests.map(t => <Panel key={t.id} title={t.name}>
        <p className="mb-2 text-xs text-muted-foreground">
          {t.ab_decision_state === "significant" ? `Écart détectable : version ${String.fromCharCode(65 + (t.ab_winner ?? 0))} envoyée au reste de la liste.` : t.ab_decision_state === "insufficient_sample" ? `Échantillon insuffisant (minimum ${t.ab_min_sample} envois par version) : version A envoyée au reste de la liste.` : t.ab_decision_state === "inconclusive" ? "Aucun écart statistiquement concluant : version A envoyée au reste de la liste." : `Test en cours${t.ab_decide_at ? ` · décision prévue le ${new Date(t.ab_decide_at).toLocaleString("fr-FR")}` : ''} · critère : ${t.ab_metric === "click" ? "clics" : "ouvertures"}`}
        </p>
        <div className="space-y-2">
          {t.variants.map((v, i) => { const best = t.ab_winner === i; const rate = t.ab_metric === "click" ? v.clicked : v.opened;
            const interval = wilson95(rate, v.sent);
            return <div key={i} className={`rounded-xl border p-3 ${best ? "border-neon-green bg-neon-green/10" : "border-border"}`}>
              <div className="flex items-center justify-between text-sm font-semibold"><span>Version {String.fromCharCode(65 + i)} {best && <Trophy className="inline size-4 text-neon-green" />}</span><span>{pct(rate, v.sent)}</span></div>
              <p className="truncate text-xs">{v.subject} · {v.fromName}</p>
              <p className="text-xs text-muted-foreground">{v.sent}/{v.assigned} envoyés · {v.opened} ouvertures ({pct(v.opened, v.sent)}) · {v.clicked} clics ({pct(v.clicked, v.sent)})</p>
              <p className="text-xs text-muted-foreground">Intervalle indicatif à 95 % du critère {t.ab_metric === 'click' ? 'clic' : 'ouverture'} : {interval ? `${(interval[0] * 100).toFixed(1)}–${(interval[1] * 100).toFixed(1)} %` : 'en attente de données'}.</p>
            </div>; })}
        </div>
        {t.ab_winner != null && <p className="mt-2 text-xs text-muted-foreground">La décision compare chaque variante au meilleur taux observé avec correction des comparaisons multiples et exige au moins {t.ab_min_sample} envois par version. Les proxys d’ouverture et les scanners de liens peuvent fausser les mesures.</p>}
        {t.ab_winner == null && <Button size="sm" variant="outline" className="mt-3" onClick={async () => { try { const r = await decide({ data: { campaignId: t.id } }); toast.success(r.state === "significant" ? "Un écart concluant a été détecté." : "Pas de résultat concluant : la version A sera utilisée."); qc.invalidateQueries({ queryKey: ["ab"] }); } catch (e) { toast.error((e as Error).message); } }}><Trophy className="size-4" />Terminer le test</Button>}
      </Panel>)}
    </div>
    {!q.isLoading && !tests.length && <p className="text-sm text-muted-foreground">Aucun test pour l'instant.</p>}
    <StatusBar>{tests.length} test(s) · ouvertures et clics mesurés automatiquement dans chaque e-mail</StatusBar>
  </div>;
}
