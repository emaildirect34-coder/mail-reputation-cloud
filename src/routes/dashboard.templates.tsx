import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Layers, Star, Grid2x2, Euro, Target, Globe2, TrendingUp, Gauge, Plus, Upload, Download, HelpCircle, Search,
  Filter, Pencil, Copy, BarChart3, MoreHorizontal, Send, Trash2, CheckCircle2, Pause, Megaphone, ShoppingCart,
  ShieldCheck, Zap, Home, Car, HeartPulse, Plane, Wallet, GraduationCap,
} from "lucide-react";
import { toast } from "sonner";
import { StatusBar } from "@/components/dash/campaign-tabs";
import { Card, Kpi, Pill, type Tone } from "@/components/dash/lux";

export const Route = createFileRoute("/dashboard/templates")({
  head: () => ({
    meta: [
      { title: "Offres Sponsors — Email Direct" },
      { name: "description", content: "Bibliothèque des offres sponsors : payout, EPC, GEO, créas et performances." },
      { property: "og:title", content: "Offres Sponsors — Email Direct" },
      { property: "og:description", content: "Choisissez la meilleure offre sponsor selon l'EPC, la saison et le GEO." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Offers,
});

type Offer = { name: string; sponsor: string; cat: string; model: string; payout: string; epc: number; cr: number; geo: string; status: "Actif" | "En pause" | "Terminé"; tone: Tone; headline: string; tag: string };
const offers: Offer[] = [
  { name: "Assurance Auto Économique", sponsor: "LeadMax", cat: "Assurance", model: "CPL", payout: "4,20 €", epc: 0.62, cr: 14.8, geo: "FR · BE", status: "Actif", tone: "blue", headline: "ASSURANCE AUTO", tag: "-40%" },
  { name: "Énergie Verte Maison", sponsor: "GreenFlow", cat: "Énergie", model: "CPL", payout: "6,10 €", epc: 0.71, cr: 11.6, geo: "FR", status: "Actif", tone: "green", headline: "ÉNERGIE VERTE", tag: "-25%" },
  { name: "Crédit Conso Express", sponsor: "FinAds", cat: "Finance", model: "CPA", payout: "38,00 €", epc: 0.94, cr: 2.5, geo: "FR · LU", status: "Actif", tone: "violet", headline: "CRÉDIT EXPRESS", tag: "0%" },
  { name: "Panneaux Solaires", sponsor: "SunLead", cat: "Habitat", model: "CPL", payout: "18,50 €", epc: 0.55, cr: 3.0, geo: "FR", status: "En pause", tone: "amber", headline: "SOLAIRE", tag: "AIDES" },
  { name: "Mutuelle Santé Senior", sponsor: "HealthPro", cat: "Santé", model: "CPL", payout: "9,80 €", epc: 0.68, cr: 6.9, geo: "FR · CH", status: "Actif", tone: "blue", headline: "MUTUELLE", tag: "-30%" },
  { name: "Voyage Été Tout Inclus", sponsor: "TravelHub", cat: "Voyage", model: "CPS", payout: "6 %", epc: 0.41, cr: 1.2, geo: "EU", status: "Terminé", tone: "violet", headline: "VOYAGE ÉTÉ", tag: "-50%" },
  { name: "Formation Certifiante CPF", sponsor: "EduLeads", cat: "Formation", model: "CPL", payout: "12,00 €", epc: 0.58, cr: 4.8, geo: "FR", status: "Actif", tone: "green", headline: "FORMATION", tag: "CPF" },
  { name: "Box E-commerce Mensuelle", sponsor: "ShopNet", cat: "E-commerce", model: "CPA", payout: "15,00 €", epc: 0.47, cr: 3.1, geo: "FR · BE", status: "Actif", tone: "amber", headline: "BOX MENSUELLE", tag: "1€" },
];
const cats = [
  { n: "Toutes les offres", i: Layers, c: 412 }, { n: "Assurance", i: Car, c: 64 }, { n: "Énergie", i: Zap, c: 38 }, { n: "Finance", i: Wallet, c: 52 },
  { n: "Habitat", i: Home, c: 41 }, { n: "Santé", i: HeartPulse, c: 36 }, { n: "Voyage", i: Plane, c: 22 }, { n: "Formation", i: GraduationCap, c: 18 },
  { n: "E-commerce", i: ShoppingCart, c: 47 }, { n: "Promotion", i: Megaphone, c: 29 },
];
const stTone = { Actif: "green", "En pause": "amber", Terminé: "blue" } as const;

function Creative({ o, big }: { o: Offer; big?: boolean }) {
  const c = `var(--neon-${o.tone === "blue" ? "2" : o.tone})`;
  return (
    <div className={`relative min-w-0 overflow-hidden rounded-xl ${big ? "h-48" : "h-24"}`} style={{ background: `radial-gradient(circle at 80% 20%, color-mix(in oklab, ${c} 70%, transparent), transparent 55%), linear-gradient(135deg, var(--sidebar), color-mix(in oklab, ${c} 55%, var(--sidebar)))` }}>
      <div className="absolute inset-0 p-3">
        <p className={`font-display font-extrabold leading-none text-primary-foreground ${big ? "text-[30px]" : "text-[14px]"}`}>{o.headline}</p>
        <p className={`mt-1 font-display font-black ${big ? "text-[54px]" : "text-[26px]"}`} style={{ color: c, textShadow: "0 2px 10px var(--sidebar)" }}>{o.tag}</p>
      </div>
      <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="absolute bottom-0 h-1/3 w-full opacity-70"><path d="M0 30 C50 10 90 40 140 20 S200 15 200 15 V40 H0Z" fill={c} /></svg>
    </div>
  );
}

function Offers() {
  const [cat, setCat] = useState("Toutes les offres");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const list = useMemo(() => offers.filter((o) => (cat === "Toutes les offres" || o.cat === cat) && `${o.name} ${o.sponsor}`.toLowerCase().includes(q.toLowerCase())), [cat, q]);
  const o = offers[sel]!;

  return (
    <div className="space-y-3">
      <section className="card-lux flex flex-wrap items-center gap-4 px-5 py-3">
        <Layers className="h-14 w-14 shrink-0 text-primary" />
        <div className="mr-auto min-w-0">
          <h1 className="font-display text-[28px] font-extrabold leading-tight text-primary">Offres Sponsors</h1>
          <p className="text-[13px] font-semibold">Gérez vos offres partenaires, leurs créas et choisissez la meilleure au bon moment.</p>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-xl bg-neon-green px-4 py-2 text-[13px] font-bold text-primary-foreground" onClick={() => toast("Formulaire de nouvelle offre sponsor ouvert.")}><Plus className="h-4 w-4" />Nouvelle offre</button>
        {[[Upload, "Importer API"], [Download, "Exporter"], [HelpCircle, "Aide"]].map(([I, l]) => { const Ic = I as typeof Upload; return <button key={l as string} className="card-lux inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold text-primary" onClick={() => toast(`${l as string} : action de démonstration.`)}><Ic className="h-4 w-4 shrink-0" />{l as string}</button>; })}
      </section>

      <div className="flex flex-wrap gap-2 pb-1">
        <Link to="/dashboard/campaigns/new" className="card-lux flex shrink-0 items-center gap-2 px-5 py-2.5 text-[13px] font-semibold hover:text-primary"><Send className="h-4 w-4 text-primary" />Nouvelle campagne</Link>
        <span className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-primary-foreground"><Layers className="h-4 w-4" />Offres Sponsors</span>
        <Link to="/dashboard/preflight" className="card-lux flex shrink-0 items-center gap-2 px-5 py-2.5 text-[13px] font-semibold hover:text-primary"><ShieldCheck className="h-4 w-4 text-primary" />Tests & Préflight</Link>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi icon={<Layers />} label="Total offres" value="412" sub="↑ +12.8%" />
        <Kpi icon={<Star />} label="Actives" value="284" sub="↑ +14.3%" tone="violet" />
        <Kpi icon={<Grid2x2 />} label="Catégories" value="18" sub="↑ +5.9%" />
        <Kpi icon={<Globe2 />} label="Sponsors API" value="27" sub="✓ Synchronisés" tone="green" />
        <Kpi icon={<Euro />} label="Payout moyen" value="11,40 €" sub="↑ +6.2%" />
        <Kpi icon={<Target />} label="EPC moyen" value="0,62 €" sub="↑ +0,04 €" tone="green" />
        <Kpi icon={<TrendingUp />} label="Revenu 30j" value="184 k€" sub="↑ +22.1%" tone="violet" />
        <Kpi icon={<Gauge />} label="Score qualité" value="98.7%" sub="↑ +0.9 pts" tone="green" />
      </div>

      <div className="space-y-3">
        <Card title="Détails de l'offre" icon={<Layers />}>
          <Creative o={o} big />
          <div className="mt-3 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1"><p className="truncate font-display text-[17px] font-bold text-primary" title={o.name}>{o.name}</p><p className="text-[12px] text-muted-foreground">{o.sponsor} · {o.cat} · {o.model} · {o.geo}</p></div>
            <Pill tone={stTone[o.status]}>{o.status}</Pill>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[["Payout", o.payout], ["EPC", `${o.epc.toFixed(2)} €`], ["Conv.", `${o.cr}%`], ["Score", `${Math.round(o.epc * 100 + o.cr)}`]].map(([l, v]) => (
              <div key={l} className="min-w-0"><p className="truncate text-[11px] font-semibold">{l}</p><p className="truncate font-display text-[16px] font-extrabold text-primary">{v}</p></div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-border p-2 text-[12px]">
            <p className="font-bold text-primary">Recommandation Atlas IA</p>
            <p className="text-muted-foreground">Meilleure fenêtre : mardi–jeudi 10h-12h. Segment conseillé : actifs 30 jours. Fatigue faible.</p>
          </div>
        </Card>

        <Card title="Catégories" icon={<Layers />}>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
            {cats.map((c) => (
              <button key={c.n} onClick={() => setCat(c.n)} className={`flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold ${cat === c.n ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                <c.i className={`h-4 w-4 shrink-0 ${cat === c.n ? "" : "text-primary"}`} /><span className="min-w-0 truncate">{c.n}</span><span className="ml-auto shrink-0 rounded-md bg-muted px-1.5 text-[11px] text-foreground">{c.c}</span>
              </button>
            ))}
            <button className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-border py-2 text-[13px] font-semibold text-primary" onClick={() => toast("Nouvelle catégorie à nommer.")}><Plus className="h-4 w-4" />Nouvelle catégorie</button>
          </div>
        </Card>

        <section className="card-lux min-w-0 p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une offre, un sponsor..." className="w-full min-w-0 bg-transparent text-[13px] outline-none" /></label>
            <select className="rounded-lg border border-border bg-card px-2 text-[12px]" aria-label="Modèle"><option>Tous modèles</option><option>CPL</option><option>CPA</option><option>CPS</option></select>
            <select className="rounded-lg border border-border bg-card px-2 text-[12px]" aria-label="Statut"><option>Tous statuts</option><option>Actif</option><option>En pause</option></select>
            <button className="inline-flex items-center gap-1 rounded-lg border border-border px-3 text-[12px] font-semibold" onClick={() => toast("Filtres avancés : GEO, EPC, saisonnalité.")}><Filter className="h-3.5 w-3.5" />Plus de filtres</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {list.map((x) => {
              const i = offers.indexOf(x);
              return (
                <button key={x.name} onClick={() => setSel(i)} className={`card-lux min-w-0 overflow-hidden p-2 text-left transition ${sel === i ? "ring-2 ring-primary" : ""}`}>
                  <div className="mb-1.5 flex items-center justify-between"><Pill tone={stTone[x.status]}>{x.status === "Actif" ? <CheckCircle2 className="h-3 w-3" /> : <Pause className="h-3 w-3" />}{x.status}</Pill><span className="text-[11px] font-bold text-primary">{x.model}</span></div>
                  <Creative o={x} />
                  <p className="mt-2 truncate text-[13px] font-bold text-primary" title={x.name}>{x.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{x.sponsor} · {x.cat} · {x.geo}</p>
                  <div className="mt-1 flex justify-between text-[11px] font-semibold"><span>{x.payout}</span><span>EPC {x.epc.toFixed(2)} €</span><span>CR {x.cr}%</span></div>
                  <div className="mt-2 flex justify-between border-t border-border pt-1.5 text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5"><Pencil /><Copy /><BarChart3 /><MoreHorizontal /></div>
                </button>
              );
            })}
            {list.length === 0 && <p className="col-span-full py-10 text-center text-[13px] text-muted-foreground">Aucune offre ne correspond.</p>}
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">Afficher {list.length} sur 412 offres</p>
        </section>

        <Card title="Actions rapides" icon={<Zap />}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[[Send, "Campagne"], [Copy, "Dupliquer"], [Pencil, "Modifier"], [Download, "Exporter"], [Trash2, "Supprimer"]].map(([I, l]) => { const Ic = I as typeof Send; return (
              l === "Campagne"
                ? <Link key="c" to="/dashboard/campaigns/new" className="card-lux flex flex-col items-center gap-1 p-2 text-[10.5px] font-semibold text-primary"><Ic className="h-5 w-5" />Lancer</Link>
                : <button key={l as string} className="card-lux flex flex-col items-center gap-1 p-2 text-[10.5px] font-semibold" style={l === "Supprimer" ? { color: "var(--neon-red)" } : undefined} onClick={() => toast(`${l as string} : action de démonstration sur « ${o.name} ».`)}><Ic className="h-5 w-5 text-current" />{l as string}</button>
            ); })}
          </div>
        </Card>
      </div>
      <StatusBar>8 offres affichées · 27 sponsors synchronisés · EPC moyen 0,62 €</StatusBar>
    </div>
  );
}
