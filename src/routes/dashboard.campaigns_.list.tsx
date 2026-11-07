import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, Copy, Download, FileText, Filter, FlaskConical, Layers, LayoutGrid, List, Mail, MousePointer2, Pause, Pencil, Play, Plus, Search, Upload, CircleHelp } from "lucide-react";
import { toast } from "sonner";
import { CampaignTabs, LineChart, MiniKpi, ModuleHeader, StatusBar } from "@/components/dash/campaign-tabs";

export const Route = createFileRoute("/dashboard/campaigns_/list")({
  head: () => ({ meta: [
    { title: "Mes campagnes — Email Direct" },
    { name: "description", content: "Gérez, surveillez et optimisez toutes vos campagnes d'emailing." },
    { property: "og:title", content: "Mes campagnes — Email Direct" },
    { property: "og:description", content: "Liste, filtres, performances et actions rapides sur vos campagnes." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ListPage,
});

type Status = "Active" | "Terminée" | "En pause" | "Planifiée";
type Camp = { name: string; date: string; offer: string; status: Status; aud: number; sent: number; open: number; click: number; conv: number; rev: number; ab?: boolean };
const seed: Camp[] = [
  { name: "Lancement Printemps 2025", date: "24 avr. 2025 - 14:00", offer: "Offre Premium", status: "Active", aud: 250000, sent: 248125, open: 42.8, click: 8.9, conv: 3.2, rev: 9480 },
  { name: "Newsletter Hebdo #128", date: "23 avr. 2025 - 10:30", offer: "Newsletter", status: "Active", aud: 124000, sent: 123921, open: 41.5, click: 8.1, conv: 2.6, rev: 4920 },
  { name: "Offre Été - Early Access", date: "22 avr. 2025 - 16:20", offer: "Accès Anticipé", status: "Terminée", aud: 98500, sent: 98432, open: 46.7, click: 10.2, conv: 4.1, rev: 12360 },
  { name: "Relance Panier Abandonné", date: "22 avr. 2025 - 09:00", offer: "E-commerce", status: "En pause", aud: 75000, sent: 37420, open: 38.9, click: 7.6, conv: 2.8, rev: 3840 },
  { name: "Réactivation Inactifs", date: "21 avr. 2025 - 18:45", offer: "Fidélisation", status: "Terminée", aud: 180000, sent: 179662, open: 39.1, click: 7.5, conv: 2.9, rev: 7980 },
  { name: "Promo Flash 48h", date: "21 avr. 2025 - 11:00", offer: "Promo -50%", status: "Active", aud: 320000, sent: 318970, open: 43.7, click: 9.8, conv: 3.6, rev: 16420 },
  { name: "Test A/B - Objet", date: "20 avr. 2025 - 15:30", offer: "A/B Test", status: "Terminée", aud: 50000, sent: 49982, open: 48.5, click: 11.2, conv: 4.3, rev: 5610, ab: true },
  { name: "Webinaire - Inscription", date: "19 avr. 2025 - 09:00", offer: "Webinaire", status: "Planifiée", aud: 75000, sent: 0, open: 0, click: 0, conv: 0, rev: 0 },
  { name: "Offre Partenaire - USA", date: "18 avr. 2025 - 20:00", offer: "Partenaire", status: "Terminée", aud: 150000, sent: 149702, open: 40.2, click: 8.4, conv: 3.0, rev: 11250 },
  { name: "Test Délivrabilité (Seed)", date: "18 avr. 2025 - 10:00", offer: "Test Inbox", status: "Terminée", aud: 10000, sent: 9987, open: 99.6, click: 12.4, conv: 0, rev: 0, ab: true },
];
const statusCls: Record<Status, string> = {
  Active: "bg-neon-green/15 text-neon-green border-neon-green/40", "Terminée": "bg-primary/10 text-primary border-primary/30",
  "En pause": "bg-neon-amber/15 text-neon-amber border-neon-amber/40", "Planifiée": "bg-muted text-foreground border-border",
};
const fmt = (n: number) => n.toLocaleString("fr-FR");
const sel = "h-9 rounded-xl border border-border bg-card px-3 text-[12.5px] font-semibold";

function ListPage() {
  const [rows, setRows] = useState(seed);
  const [q, setQ] = useState(""); const [st, setSt] = useState("Tous les statuts"); const [of, setOf] = useState("Toutes les offres");
  const [cur, setCur] = useState(0); const [tab, setTab] = useState<"Performance" | "Configuration" | "Logs">("Performance");
  const [checked, setChecked] = useState<number[]>([]);
  const list = useMemo(() => rows.map((r, i) => ({ ...r, i })).filter(r => r.name.toLowerCase().includes(q.toLowerCase()) && (st === "Tous les statuts" || r.status === st) && (of === "Toutes les offres" || r.offer === of)), [rows, q, st, of]);
  const c = rows[cur] ?? seed[0]!;
  const count = (s: Status) => rows.filter(r => r.status === s).length;
  const toggle = (i: number) => { setRows(p => p.map((r, j) => j === i ? { ...r, status: r.status === "Active" ? "En pause" : r.status === "En pause" ? "Active" : r.status } : r)); toast.success("Statut mis à jour."); };
  const dup = (i: number) => { const r = rows[i]; if (!r) return; setRows(p => [{ ...r, name: `${r.name} (copie)`, status: "Planifiée", sent: 0 }, ...p]); toast.success("Campagne dupliquée."); };
  const exportCsv = () => {
    const csv = ["Campagne;Offre;Statut;Audience;Envoyés;Ouv;Clics;Conv;Revenus", ...rows.map(r => [r.name, r.offer, r.status, r.aud, r.sent, r.open, r.click, r.conv, r.rev].join(";"))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "campagnes.csv"; a.click();
  };
  const btn = "inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[12.5px] font-semibold text-primary";

  return <div className="space-y-3 pb-4">
    <ModuleHeader icon={<Layers />} title="Mes campagnes" desc="Gérez, surveillez et optimisez toutes vos campagnes d'emailing." actions={<>
      <Link to="/dashboard/campaigns/new" className="inline-flex items-center gap-1.5 rounded-xl bg-neon-green px-4 py-2 text-[12.5px] font-bold text-primary-foreground"><Plus className="size-4" />Nouvelle campagne</Link>
      <button className={btn} onClick={() => toast("Import CSV : glissez votre fichier dans Nouvelle campagne.")}><Upload className="size-4" />Importer</button>
      <button className={btn} onClick={exportCsv}><Download className="size-4" />Exporter</button>
      <button className={btn} onClick={() => toast("Cliquez une ligne pour voir ses détails à droite.")}><CircleHelp className="size-4" />Aide</button>
    </>} />
    <CampaignTabs active="list" />
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5 xl:grid-cols-9">
      <MiniKpi icon={<Layers />} label="Total campagnes" value={String(rows.length)} delta="+18.8%" />
      <MiniKpi icon={<Play />} label="Actives" value={String(count("Active"))} delta="+12.0%" />
      <MiniKpi icon={<CalendarDays />} label="Planifiées" value={String(count("Planifiée"))} delta="+50.0%" />
      <MiniKpi icon={<Pause />} label="En pause" value={String(count("En pause"))} delta="-14.3%" down />
      <MiniKpi icon={<CheckCircle2 />} label="Terminées" value={String(count("Terminée"))} delta="+7.7%" />
      <MiniKpi icon={<AlertTriangle />} label="En erreur" value="0" delta="-100%" down />
      <MiniKpi icon={<Mail />} label="Emails envoyés" value={`${(rows.reduce((a, r) => a + r.sent, 0) / 1e6).toFixed(2)} M`} delta="+3.8 pts" />
      <MiniKpi icon={<MousePointer2 />} label="Taux d'ouverture" value="8.9%" delta="+1.4 pts" />
      <MiniKpi icon={<Filter />} label="Taux de clic" value="3.1%" delta="+0.5 pts" />
    </div>

    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="card-lux space-y-3 p-3">
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-56 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une campagne (nom, offre, domaine...)" className={`${sel} w-full pl-9 font-normal`} /></label>
          <select aria-label="Statut" value={st} onChange={e => setSt(e.target.value)} className={sel}>{["Tous les statuts", "Active", "Terminée", "En pause", "Planifiée"].map(o => <option key={o}>{o}</option>)}</select>
          <select aria-label="Offre" value={of} onChange={e => setOf(e.target.value)} className={sel}>{["Toutes les offres", ...new Set(seed.map(s => s.offer))].map(o => <option key={o}>{o}</option>)}</select>
          <select aria-label="Période" className={sel}><option>30 derniers jours</option><option>7 derniers jours</option><option>90 derniers jours</option></select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-border/60 text-left text-[12px] font-bold text-primary">
              <th className="p-2"><input type="checkbox" aria-label="Tout sélectionner" checked={checked.length === list.length && list.length > 0} onChange={e => setChecked(e.target.checked ? list.map(r => r.i) : [])} className="accent-primary" /></th>
              {["Campagne", "Offre / Sujet", "Statut", "Audience", "Envoyés", "Ouv.", "Clics", "Conv.", "Revenus", "Actions"].map(h => <th key={h} className="whitespace-nowrap p-2">{h}</th>)}
            </tr></thead>
            <tbody>{list.map(r => <tr key={r.i} onClick={() => setCur(r.i)} className={`cursor-pointer border-b border-border/40 hover:bg-primary/5 ${cur === r.i ? "bg-primary/10" : ""}`}>
              <td className="p-2" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={r.name} checked={checked.includes(r.i)} onChange={e => setChecked(p => e.target.checked ? [...p, r.i] : p.filter(x => x !== r.i))} className="accent-primary" /></td>
              <td className="p-2"><div className="flex items-center gap-2">{r.ab ? <FlaskConical className="size-4 text-primary" /> : <Mail className="size-4 text-primary" />}<div><p className="whitespace-nowrap font-bold text-primary">{r.name}</p><p className="whitespace-nowrap text-[11px] text-muted-foreground">{r.date}</p></div></div></td>
              <td className="whitespace-nowrap p-2">{r.offer}</td>
              <td className="p-2"><span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusCls[r.status]}`}>{r.status}</span></td>
              <td className="p-2">{fmt(r.aud)}</td><td className="p-2">{fmt(r.sent)}</td>
              <td className="p-2">{r.sent ? `${r.open}%` : "-"}</td><td className="p-2">{r.sent ? `${r.click}%` : "-"}</td><td className="p-2">{r.conv ? `${r.conv}%` : "-"}</td><td className="whitespace-nowrap p-2">{r.rev ? `${fmt(r.rev)} €` : "-"}</td>
              <td className="p-2" onClick={e => e.stopPropagation()}><div className="flex gap-1.5 text-primary [&_button]:rounded [&_button]:p-0.5 hover:[&_button]:bg-primary/10">
                <button aria-label="Statistiques" onClick={() => { setCur(r.i); setTab("Performance"); }}><BarChart3 className="size-4" /></button>
                <Link aria-label="Modifier" to="/dashboard/campaigns/new" className="p-0.5"><Pencil className="size-4" /></Link>
                <button aria-label="Dupliquer" onClick={() => dup(r.i)}><Copy className="size-4" /></button>
                <button aria-label="Pause / reprise" onClick={() => toggle(r.i)}>{r.status === "En pause" ? <Play className="size-4" /> : <Pause className="size-4" />}</button>
              </div></td>
            </tr>)}</tbody>
          </table>
          {list.length === 0 && <p className="p-6 text-center text-[13px] text-muted-foreground">Aucune campagne ne correspond à ces filtres.</p>}
        </div>
        <p className="text-[12px] text-muted-foreground">Afficher <b>{list.length}</b> sur {rows.length} campagnes{checked.length > 0 && ` · ${checked.length} sélectionnée(s)`}</p>
      </section>

      <aside className="space-y-3">
        <section className="card-lux p-3.5">
          <div className="mb-3 flex items-center gap-2"><Layers className="size-5 text-primary" /><h2 className="font-display text-[16px] font-bold text-primary">Détails de la campagne</h2><div className="ml-auto flex gap-1 text-primary"><List className="size-4" /><LayoutGrid className="size-4" /></div></div>
          <div className="mb-3 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Mail className="size-6" /></span><div className="min-w-0 flex-1"><p className="truncate font-display text-[15px] font-bold text-primary">{c.name}</p><p className="text-[11.5px] text-muted-foreground">{c.offer} · {c.date}</p></div><span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusCls[c.status]}`}>{c.status}</span></div>
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">{(["Performance", "Configuration", "Logs"] as const).map(t => <button key={t} onClick={() => setTab(t)} className={`rounded-lg py-1.5 text-[12px] font-bold ${tab === t ? "bg-primary text-primary-foreground" : "text-primary"}`}>{t}</button>)}</div>
          {tab === "Performance" && <>
            <div className="mb-2 grid grid-cols-5 gap-1 rounded-xl border border-border/60 p-2 text-center">{[["Envoyés", fmt(c.sent)], ["Ouvertures", `${c.open}%`], ["Clics", `${c.click}%`], ["Conversions", `${c.conv}%`], ["Revenus", `${fmt(c.rev)} €`]].map(([l, v]) => <div key={l}><p className="text-[10px] text-muted-foreground">{l}</p><p className="font-display text-[13px] font-extrabold text-primary">{v}</p></div>)}</div>
            <LineChart labels={["24", "25", "26", "27", "28", "29", "30 avr."]} series={[
              { name: "Ouvertures", color: "var(--neon-2)", values: [30, 32, 34, 33, 37, 39, c.open] },
              { name: "Clics", color: "var(--neon-green)", values: [8, 9, 8, 9, 10, 9, c.click] },
              { name: "Conversions", color: "var(--neon-violet)", values: [3, 3, 3, 3.5, 3, 3.2, c.conv] },
            ]} />
          </>}
          {tab === "Configuration" && <dl className="divide-y divide-border/50 text-[12.5px]">{[["Offre", c.offer], ["Audience", fmt(c.aud)], ["Pool VMTA", "Pool Gold (VIP)"], ["Vitesse", "Automatique"], ["Désabonnement", "RFC 8058 activé"]].map(([k, v]) => <div key={k} className="flex justify-between py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>}
          {tab === "Logs" && <ul className="space-y-1 font-mono text-[11px]">{["14:00:02 Démarrage de l'envoi", "14:00:05 250 OK gmail.com", "14:02:11 421 ralentissement outlook.com — pacing ajusté", "14:10:44 Lot 12/40 livré"].map(l => <li key={l} className="rounded bg-muted px-2 py-1">{l}</li>)}</ul>}
        </section>
        <section className="card-lux p-3.5">
          <h2 className="mb-2 font-display text-[15px] font-bold text-primary">⚡ Actions rapides</h2>
          <div className="grid grid-cols-4 gap-2">
            {[{ i: Pause, l: c.status === "En pause" ? "Reprendre" : "Mettre en pause", f: () => toggle(cur) }, { i: Copy, l: "Dupliquer", f: () => dup(cur) }, { i: Pencil, l: "Modifier", f: () => toast("Ouvrez Nouvelle campagne pour modifier.") }, { i: FileText, l: "Rapport PDF", f: () => window.print() }].map(a => <button key={a.l} onClick={a.f} className="card-lux flex flex-col items-center gap-1 p-2 text-[11px] font-semibold text-primary"><a.i className="size-5" />{a.l}</button>)}
          </div>
        </section>
      </aside>
    </div>
    <StatusBar>Module Campagnes opérationnel : {count("Active")} campagnes actives · Délivrabilité moyenne 99.8% · Aucune alerte critique</StatusBar>
  </div>;
}
