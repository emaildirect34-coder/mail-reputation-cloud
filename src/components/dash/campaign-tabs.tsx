import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Bot, FileText, FlaskConical, LayoutDashboard, Layers, PlusCircle, ShieldCheck } from "lucide-react";

const tabs = [
  { k: "overview", l: "Vue d'ensemble", i: LayoutDashboard, to: "/dashboard/campaigns" },
  { k: "new", l: "Nouvelle campagne", i: PlusCircle, to: "/dashboard/campaigns/new" },
  { k: "list", l: "Mes campagnes", i: Layers, to: "/dashboard/campaigns/list" },
  { k: "templates", l: "Templates", i: FileText, to: "/dashboard/templates" },
  { k: "ab", l: "A/B & SMTP", i: FlaskConical, to: "/dashboard/campaigns/ab" },
  { k: "preflight", l: "Tests & Préflight", i: ShieldCheck, to: "/dashboard/preflight" },
  { k: "auto", l: "Automatisations", i: Bot, to: "/dashboard/agent" },
] as const;

export type CampaignTab = (typeof tabs)[number]["k"];

/** Shared navigation between the campaign module pages. */
export function CampaignTabs({ active }: { active: CampaignTab }) {
  return (
    <nav aria-label="Module campagnes" className="flex gap-2 overflow-x-auto pb-1">
      {tabs.map(t => (
        <Link key={t.k} to={t.to} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition ${t.k === active ? "bg-primary text-primary-foreground shadow-[0_6px_18px_-6px_var(--primary)]" : "card-lux text-primary hover:bg-primary/10"}`}>
          <t.i className="size-4" />{t.l}
        </Link>
      ))}
    </nav>
  );
}

/** Page title block used by the campaign module pages. */
export function ModuleHeader({ icon, title, desc, actions }: { icon: ReactNode; title: string; desc: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_20px_-8px_var(--primary)] [&_svg]:size-8">{icon}</span>
      <div><h1 className="font-display text-[26px] font-extrabold leading-tight text-primary">{title}</h1><p className="text-[12.5px] font-semibold">{desc}</p></div>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBar({ children }: { children: ReactNode }) {
  return <div className="lux-banner flex items-center justify-center gap-3 rounded-2xl px-4 py-2.5 text-center text-[13px] font-semibold"><ShieldCheck className="size-5 shrink-0 text-neon-green" />{children}</div>;
}

export function MiniKpi({ icon, label, value, delta, down }: { icon: ReactNode; label: string; value: string; delta: string; down?: boolean }) {
  return (
    <div className="card-lux min-w-0 p-3">
      <div className="flex items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary [&_svg]:size-4">{icon}</span><p className="truncate text-[11.5px] font-semibold" title={label}>{label}</p></div>
      <p className="mt-1.5 truncate font-display text-[20px] font-extrabold leading-tight text-primary">{value}</p>
      <p className={`truncate text-[11px] font-bold ${down ? "text-neon-red" : "text-neon-green"}`}>{down ? "↓" : "↑"} {delta}</p>
    </div>
  );
}

export function LineChart({ series, labels }: { series: { name: string; color: string; values: number[] }[]; labels: string[] }) {
  const max = Math.max(...series.flatMap(s => s.values)) * 1.15 || 1;
  return (
    <div>
      <div className="mb-1 flex justify-center gap-4 text-[11px] font-semibold">{series.map(s => <span key={s.name} className="flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: s.color }} />{s.name}</span>)}</div>
      <svg viewBox="0 0 300 120" preserveAspectRatio="none" className="h-40 w-full">
        {[0, 1, 2, 3].map(i => <line key={i} x1="0" x2="300" y1={10 + i * 33} y2={10 + i * 33} stroke="var(--border)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
        {series.map(s => {
          const pts = s.values.map((v, i) => `${(i / (s.values.length - 1)) * 290 + 5},${110 - (v / max) * 100}`);
          return <g key={s.name}><polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />{pts.map(p => { const [x, y] = p.split(","); return <circle key={p} cx={x} cy={y} r="2.5" fill="var(--card)" stroke={s.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />; })}</g>;
        })}
      </svg>
      <div className="flex justify-between text-[10.5px] text-muted-foreground">{labels.map(l => <span key={l}>{l}</span>)}</div>
    </div>
  );
}
