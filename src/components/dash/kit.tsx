import type { ReactNode } from "react";

export function PageHeader({ title, desc, action }: { title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

type Tone = "ok" | "warn" | "bad" | "neutral";
const tones: Record<Tone, string> = {
  ok: "bg-success/15 text-success",
  warn: "bg-accent text-accent-foreground",
  bad: "bg-destructive/15 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card">
      {title && (
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function DataTable({ cols, rows }: { cols: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-3">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Bar({ value }: { value: number }) {
  return <div className="h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${value}%` }} /></div>;
}
