import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, CircleHelp, Copy, Download, FileText, FlaskConical, Gauge, Inbox, Mail, MousePointer2, Pause, Pencil, Plus, Rocket, Scale, Search, Server, Settings, Trophy, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { CampaignTabs, LineChart, MiniKpi, ModuleHeader, StatusBar } from "@/components/dash/campaign-tabs";

export const Route = createFileRoute("/dashboard/campaigns_/ab")({
  head: () => ({ meta: [
    { title: "A/B & SMTP — Email Direct" },
    { name: "description", content: "Testez, comparez et optimisez vos variantes d'emails et vos configurations SMTP." },
    { property: "og:title", content: "A/B & SMTP — Email Direct" },
    { property: "og:description", content: "Tests A/B, bibliothèque SMTP et analyse comparative." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: AbPage,
});

type T = { n: string; type: string; st: string; aud: number; a: string; b: string; win: "A" | "B" | "-"; lift: string; open: string; click: string };
const tests: T[] = [
  { n: "Objet – Offre Premium", type: "Objet", st: "Actif", aud: 250000, a: "Offre exclusive", b: "Promo limitée", win: "B", lift: "+3.8 pts", open: "42.1%", click: "8.9%" },
  { n: "CTA – Newsletter Hebdo", type: "CTA", st: "Terminé", aud: 124000, a: "Découvrir", b: "Voir l'offre", win: "B", lift: "+1.6 pts", open: "41.5%", click: "8.1%" },
  { n: "Expéditeur – Promo Flash", type: "From Name", st: "En pause", aud: 500000, a: "Email Direct", b: "Promo Direct", win: "B", lift: "+2.9 pts", open: "44.7%", click: "9.6%" },
  { n: "Préheader – Webinar", type: "Préheader", st: "Planifié", aud: 75000, a: "Webinar gratuit", b: "Inscription ouverte", win: "-", lift: "–", open: "–", click: "–" },
  { n: "Template – Welcome Flow", type: "HTML", st: "Terminé", aud: 180000, a: "Template v1", b: "Template v2", win: "B", lift: "+4.2 pts", open: "46.9%", click: "10.3%" },
  { n: "Objet – Relance Panier", type: "Objet", st: "Actif", aud: 310000, a: "Votre panier vous attend", b: "Dernière chance !", win: "A", lift: "+1.1 pts", open: "39.8%", click: "7.4%" },
  { n: "CTA – Offre Été", type: "CTA", st: "Terminé", aud: 205000, a: "J'en profite", b: "Profiter maintenant", win: "B", lift: "+2.7 pts", open: "43.6%", click: "9.8%" },
];
const smtp = [
  { s: "SERV001", t: "Principal", ip: "vmta-192_236_161_81", r: "Gmail / Outlook", ok: true },
  { s: "SERV002", t: "Warmup", ip: "vmta-45_83_210_16", r: "Yahoo / AOL", ok: true },
  { s: "SES-EU-01", t: "Relais", ip: "amazon SES", r: "Transactionnel", ok: true },
  { s: "SMTP-MG-01", t: "Mailgun", ip: "mail.mailgun.org", r: "Backup", ok: true },
  { s: "SERV003", t: "Test Inbox", ip: "vmta-88_120_45_90", r: "Seed tests", ok: false },
  { s: "SERV004", t: "Secondaire", ip: "vmta-77_190_12_33", r: "Diversifié", ok: true },
];
const stCls = (s: string) => s === "Actif" ? "bg-neon-green/15 text-neon-green" : s === "En pause" ? "bg-neon-amber/15 text-neon-amber" : s === "Planifié" ? "bg-muted text-foreground" : "bg-primary/10 text-primary";

function AbPage() {
  const [rows, setRows] = useState(tests);
  const [servers, setServers] = useState(smtp);
  const [q, setQ] = useState(""); const [cur, setCur] = useState(0);
  const [tab, setTab] = useState<"Performance" | "Configuration SMTP" | "Logs">("Performance");
  const t = rows[cur] ?? tests[0]!;
  const list = rows.map((r, i) => ({ ...r, i })).filter(r => (r.n + r.a + r.b).toLowerCase().includes(q.toLowerCase()));
  const btn = "inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[12.5px] font-semibold text-primary";
  const pause = () => { setRows(p => p.map((r, j) => j === cur ? { ...r, st: r.st === "En pause" ? "Actif" : "En pause" } : r)); toast.success("Statut du test mis à jour."); };
  const dup = () => { setRows(p => [{ ...t, n: `${t.n} (copie)`, st: "Planifié", win: "-" }, ...p]); toast.success("Test dupliqué."); };

  return <div className="space-y-3 pb-4">
    <ModuleHeader icon={<FlaskConical />} title="A/B & SMTP" desc="Testez, comparez et optimisez vos variantes d'emails et vos configurations SMTP." actions={<>
      <button onClick={() => { setRows(p => [{ n: `Nouveau test #${p.length + 1}`, type: "Objet", st: "Planifié", aud: 50000, a: "Variante A", b: "Variante B", win: "-", lift: "–", open: "–", click: "–" }, ...p]); setCur(0); toast.success("Test A/B créé."); }} className="inline-flex items-center gap-1.5 rounded-xl bg-neon-green px-4 py-2 text-[12.5px] font-bold text-primary-foreground"><Plus className="size-4" />Nouveau test A/B</button>
      <button className={btn} onClick={() => { setServers(p => [...p, { s: `SMTP-${p.length + 1}`, t: "Nouveau", ip: "à configurer", r: "—", ok: false }]); toast.success("Serveur SMTP ajouté (à configurer)."); }}><Mail className="size-4" />Ajouter serveur SMTP</button>
      <button className={btn} onClick={() => toast("Export prêt (démo).")}><Download className="size-4" />Exporter</button>
      <button className={btn} onClick={() => toast("Cliquez un test pour voir son analyse à droite.")}><CircleHelp className="size-4" />Aide</button>
    </>} />
    <CampaignTabs active="ab" />
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
      <MiniKpi icon={<FlaskConical />} label="Tests A/B actifs" value={String(rows.filter(r => r.st === "Actif").length)} delta="+20.0%" />
      <MiniKpi icon={<Server />} label="Serveurs SMTP" value={String(servers.length)} delta="100% opérationnels" />
      <MiniKpi icon={<Trophy />} label="Variantes gagnantes" value="27" delta="+14.3%" />
      <MiniKpi icon={<Mail />} label="Ouverture moyenne" value="42.8%" delta="+1.9 pts" />
      <MiniKpi icon={<MousePointer2 />} label="CTR moyen" value="9.3%" delta="+0.8 pts" />
      <MiniKpi icon={<Inbox />} label="Inbox rate" value="99.1%" delta="+0.4 pts" />
      <MiniKpi icon={<Gauge />} label="Débit SMTP" value="1.4 M/h" delta="Stable" />
      <MiniKpi icon={<AlertTriangle />} label="Erreurs SMTP" value="0.02%" delta="-18.0%" down />
    </div>

    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="space-y-3">
        <section className="card-lux space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-[16px] font-bold text-primary"><FlaskConical className="mr-2 inline size-5" />Tests A/B en cours et récents</h2>
            <label className="relative ml-auto min-w-52"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un test, un objet..." className="h-9 w-full rounded-xl border border-border bg-card pl-9 text-[12.5px]" /></label></div>
          <div className="overflow-x-auto"><table className="w-full text-[12px]">
            <thead><tr className="border-b border-border/60 text-left font-bold text-primary">{["Test", "Type", "Statut", "Audience", "Variante A", "Variante B", "Gagnant", "Lift", "Ouv.", "Clics"].map(h => <th key={h} className="whitespace-nowrap p-2">{h}</th>)}</tr></thead>
            <tbody>{list.map(r => <tr key={r.i} onClick={() => setCur(r.i)} className={`cursor-pointer border-b border-border/40 hover:bg-primary/5 ${cur === r.i ? "bg-primary/10" : ""}`}>
              <td className="whitespace-nowrap p-2 font-bold text-primary">{r.n}</td><td className="p-2">{r.type}</td>
              <td className="p-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ${stCls(r.st)}`}>{r.st}</span></td>
              <td className="p-2">{r.aud.toLocaleString("fr-FR")}</td><td className="max-w-32 truncate p-2">{r.a}</td><td className="max-w-32 truncate p-2">{r.b}</td>
              <td className="p-2">{r.win === "-" ? "—" : <span className={`grid size-6 place-items-center rounded-full text-[11px] font-bold text-primary-foreground ${r.win === "B" ? "bg-neon-green" : "bg-primary"}`}>{r.win}</span>}</td>
              <td className="p-2 font-bold text-neon-green">{r.lift}</td><td className="p-2">{r.open}</td><td className="p-2">{r.click}</td>
            </tr>)}</tbody>
          </table></div>
        </section>
        <div className="grid items-start gap-3 lg:grid-cols-2">
          <section className="card-lux p-3">
            <div className="mb-2 flex items-center"><h2 className="font-display text-[16px] font-bold text-primary"><Server className="mr-2 inline size-5" />Bibliothèque SMTP</h2></div>
            <table className="w-full text-[11.5px]"><thead><tr className="text-left font-bold text-primary">{["Serveur", "Type", "IP / VMTA", "Routage", "État"].map(h => <th key={h} className="p-1.5">{h}</th>)}</tr></thead>
              <tbody>{servers.map((s, i) => <tr key={s.s} className="border-t border-border/40"><td className="p-1.5 font-bold">{s.s}</td><td className="p-1.5"><span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{s.t}</span></td><td className="truncate p-1.5">{s.ip}</td><td className="p-1.5">{s.r}</td>
                <td className="p-1.5"><button onClick={() => setServers(p => p.map((x, j) => j === i ? { ...x, ok: !x.ok } : x))} className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${s.ok ? "bg-neon-green/15 text-neon-green" : "bg-neon-amber/15 text-neon-amber"}`}>{s.ok ? "Actif" : "En pause"}</button></td></tr>)}</tbody></table>
          </section>
          <section className="card-lux p-3">
            <h2 className="mb-2 font-display text-[16px] font-bold text-primary"><Scale className="mr-2 inline size-5" />Analyse comparative</h2>
            <div className="grid grid-cols-2 gap-2">{(["A", "B"] as const).map(v => { const win = t.win === v; return <div key={v} className={`rounded-xl border p-2.5 ${win ? "border-neon-green/50 bg-neon-green/5" : "border-border/60"}`}>
              <div className="mb-1.5 flex items-center gap-1"><p className="font-display text-[14px] font-bold text-primary">Variante {v}</p>{win && <span className="ml-auto rounded-full bg-neon-green px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">🏆 Gagnante</span>}</div>
              <p className="text-[11.5px]"><b>Contenu :</b> {v === "A" ? t.a : t.b}</p>
              <div className="mt-2 grid grid-cols-2 gap-1 text-center"><div><p className="text-[10px] text-muted-foreground">Ouv.</p><p className="font-display font-extrabold text-primary">{t.open === "–" ? "–" : win ? t.open : `${(parseFloat(t.open) - parseFloat(t.lift.replace("+", ""))).toFixed(1)}%`}</p></div><div><p className="text-[10px] text-muted-foreground">Clics</p><p className="font-display font-extrabold text-primary">{t.click}</p></div></div>
            </div>; })}</div>
          </section>
        </div>
      </div>

      <aside className="space-y-3">
        <section className="card-lux p-3.5">
          <h2 className="mb-2 font-display text-[16px] font-bold text-primary">Détails du test</h2>
          <div className="mb-3 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Mail className="size-6" /></span><div className="min-w-0 flex-1"><p className="truncate font-display text-[15px] font-bold text-primary">{t.n}</p><p className="text-[11.5px] text-muted-foreground">{t.type} · {t.aud.toLocaleString("fr-FR")} destinataires</p></div><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${stCls(t.st)}`}>{t.st}</span></div>
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">{(["Performance", "Configuration SMTP", "Logs"] as const).map(x => <button key={x} onClick={() => setTab(x)} className={`rounded-lg py-1.5 text-[11.5px] font-bold ${tab === x ? "bg-primary text-primary-foreground" : "text-primary"}`}>{x}</button>)}</div>
          {tab === "Performance" && <>
            <div className="mb-2 grid grid-cols-4 gap-1 text-center">{[[Mail, "Ouvertures", t.open], [MousePointer2, "Clics", t.click], [BarChart3, "Conversions", "3.2%"], [TrendingUp, "Lift", t.lift]].map(([I, l, v]) => { const Ic = I as typeof Mail; return <div key={l as string} className="rounded-xl border border-border/60 p-1.5"><Ic className="mx-auto size-4 text-primary" /><p className="text-[10px] text-muted-foreground">{l as string}</p><p className="font-display text-[13px] font-extrabold text-primary">{v as string}</p></div>; })}</div>
            <LineChart labels={["18 avr.", "19", "20", "21", "22", "23", "24 avr."]} series={[{ name: "Variante B", color: "var(--neon-green)", values: [33, 35, 37, 39, 40, 41, 42.1] }, { name: "Variante A", color: "var(--neon-2)", values: [31, 33, 34, 36, 37, 38, 38.3] }]} />
          </>}
          {tab === "Configuration SMTP" && <dl className="grid grid-cols-2 gap-x-4 text-[12px]">{[["Serveur", "SERV001 [Principal]"], ["Débit", "100 emails / minute"], ["Interface", "VMTA 192.236.161.81"], ["Batch", "100"], ["Protocole", "SMTP"], ["Pause", "1 minute"], ["Rotation IP", "1 email"], ["Queue watcher", "Actif"], ["Script d'envoi", "Queue (x/time)"], ["Warmup", "Oui"]].map(([k, v]) => <div key={k} className="flex justify-between border-b border-border/40 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>}
          {tab === "Logs" && <ul className="space-y-1 font-mono text-[11px]">{["14:00 Répartition 50/50 démarrée", "14:30 Variante B en tête (+2.1 pts)", "15:00 Seuil de confiance 95% atteint", "15:01 Gagnant appliqué au reste de l'audience"].map(l => <li key={l} className="rounded bg-muted px-2 py-1">{l}</li>)}</ul>}
        </section>
        <section className="card-lux p-3.5">
          <h2 className="mb-2 font-display text-[15px] font-bold text-primary">⚡ Actions rapides</h2>
          <div className="grid grid-cols-5 gap-1.5">{[{ i: Copy, l: "Dupliquer", f: dup }, { i: Pause, l: t.st === "En pause" ? "Reprendre" : "Pause", f: pause }, { i: Pencil, l: "Modifier", f: () => toast("Modification : ouvrez Nouvelle campagne.") }, { i: Rocket, l: "Préflight", f: () => toast.success("Préflight lancé sur les 2 variantes.") }, { i: FileText, l: "Rapport", f: () => window.print() }].map(a => <button key={a.l} onClick={a.f} className="card-lux flex flex-col items-center gap-1 p-2 text-[10.5px] font-semibold text-primary"><a.i className="size-5" />{a.l}</button>)}</div>
        </section>
        <section className="card-lux p-3.5"><h2 className="mb-1 flex items-center gap-2 font-display text-[15px] font-bold text-primary"><Settings className="size-4" />Configuration SMTP active</h2><p className="flex items-center gap-1.5 text-[12px]"><CheckCircle2 className="size-4 text-neon-green" />SERV001 [Principal] · 100 emails / minute · Warmup actif</p></section>
      </aside>
    </div>
    <StatusBar>Module A/B & SMTP opérationnel · {rows.filter(r => r.st === "Actif").length} tests actifs · {servers.filter(s => s.ok).length} serveurs SMTP sains · Inbox rate moyen 99.1%</StatusBar>
  </div>;
}
