import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter, Mail, Network, Settings, CheckSquare, Edit3, X, Zap } from "lucide-react";
import { readCampaignVmtaPools } from "@/lib/sending.functions";

const inCls = "h-7 w-full min-w-0 rounded-md border border-border bg-card px-2 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring";
const lbl = "text-[11.5px] font-semibold";

function Box({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="card-lux mb-3 p-3.5">
    <header className="mb-2.5 flex items-center gap-2"><span className="text-primary [&_svg]:size-5">{icon}</span><h2 className="font-display text-[16px] font-bold text-primary">{title}</h2></header>
    <div className="space-y-2">{children}</div>
  </section>;
}
const Arrow = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) =>
  <button type="button" aria-label={label} title={label} onClick={onClick} className="grid h-5 w-9 place-items-center rounded bg-neon-green text-primary-foreground [&_svg]:size-3.5">{children}</button>;

export function BuilderDelivery({ servers, serverId, poolId, onServer, onPool }: {
  servers: { id: string; label: string }[]; serverId: string; poolId: string; onServer: (id: string) => void; onPool: (id: string) => void;
}) {
  const readPools = useServerFn(readCampaignVmtaPools);
  const pools = useQuery({ queryKey: ["campaign-vmta-pools"], queryFn: () => readPools() });
  const [qa, setQa] = useState(""), [qb, setQb] = useState(""), [qi, setQi] = useState("");
  const [hl, setHl] = useState(""), [kind, setKind] = useState("Tous");
  const [f, setF] = useState({ script: "queue", rotate: "1", speed: "0", unit: "minute", batch: "100", pause: "1", pauseUnit: "minute", auto: "off", random: "off", arot: "1", accounts: "" });
  const s = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  const avail = servers.filter(x => x.id !== serverId && x.label.toLowerCase().includes(qa.toLowerCase()));
  const chosen = servers.filter(x => x.id === serverId && x.label.toLowerCase().includes(qb.toLowerCase()));
  const poolList = (pools.data ?? []).filter(p => (!serverId || p.serverIds.includes(serverId)) && p.name.toLowerCase().includes(qi.toLowerCase()));
  const selPool = (pools.data ?? []).find(p => p.id === poolId);
  const listCls = "h-24 overflow-y-auto rounded-md border border-border bg-card p-1 text-[11.5px]";

  return <>
    <Box title="Délivrabilité" icon={<Zap />}>
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-primary"><Network className="size-4" />Serveurs de livraison :</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        <div className="space-y-1"><input aria-label="Rechercher serveur disponible" placeholder="Rechercher..." value={qa} onChange={e => setQa(e.target.value)} className={inCls} />
          <div className={listCls}>{avail.map(x => <button type="button" key={x.id} onClick={() => setHl(x.id)} onDoubleClick={() => onServer(x.id)} className={`block w-full truncate rounded px-1.5 py-0.5 text-left ${hl === x.id ? "bg-primary text-primary-foreground" : "hover:bg-primary/10"}`}>{x.label}</button>)}{servers.length === 0 && <p className="p-1 text-muted-foreground">Aucun serveur avec agent.</p>}</div></div>
        <div className="flex flex-col gap-1.5 pt-8">
          <Arrow label="Tout ajouter" onClick={() => avail[0] && onServer(avail[0].id)}><ChevronsRight /></Arrow>
          <Arrow label="Ajouter" onClick={() => hl && hl !== serverId && onServer(hl)}><ChevronRight /></Arrow>
          <Arrow label="Retirer" onClick={() => { onServer(""); onPool(""); }}><ChevronLeft /></Arrow>
          <Arrow label="Tout retirer" onClick={() => { onServer(""); onPool(""); }}><ChevronsLeft /></Arrow>
        </div>
        <div className="space-y-1"><input aria-label="Rechercher serveur choisi" placeholder="Rechercher..." value={qb} onChange={e => setQb(e.target.value)} className={inCls} />
          <div className={listCls}>{chosen.map(x => <div key={x.id} className="truncate rounded bg-primary px-1.5 py-0.5 text-primary-foreground">{x.label}</div>)}</div>
          <p className="text-right text-[10.5px] text-muted-foreground">{serverId ? 1 : 0}</p></div>
      </div>
      <div className="flex flex-wrap gap-1.5">{["IPv4", "IPv6", "SMTP", "Route", "Custom", "Tous"].map(k => <button type="button" key={k} onClick={() => setKind(k)} className={`flex-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${kind === k ? "bg-primary text-primary-foreground" : "bg-primary/80 text-primary-foreground opacity-80"}`}>{k}</button>)}</div>

      <p className="flex items-center gap-1.5 pt-1 text-[13px] font-bold text-primary"><Settings className="size-4" />Interfaces (VMTA & SMTP) :</p>
      <input aria-label="Rechercher interface" placeholder="Rechercher..." value={qi} onChange={e => setQi(e.target.value)} className={inCls} />
      <div className="max-h-20 overflow-y-auto rounded-md border border-border bg-card text-[11.5px]">
        {poolList.map(p => <button type="button" key={p.id} onClick={() => onPool(p.id)} className={`flex w-full items-center gap-2 px-2 py-1 text-left ${p.id === poolId ? "bg-primary/10 font-semibold text-primary" : "hover:bg-primary/5"}`}>[{servers.find(x => p.serverIds.includes(x.id))?.label ?? "—"}] - {p.name}{p.id === poolId && <X className="ml-auto size-3.5" onClick={e => { e.stopPropagation(); onPool(""); }} />}</button>)}
        {poolList.length === 0 && <p className="px-2 py-1 text-muted-foreground">{serverId ? "Aucun pool VMTA pour ce serveur (IPs du serveur utilisées)." : "Choisissez d’abord un serveur."}</p>}
      </div>
      <div className="flex items-center justify-end gap-1"><span className="mr-1 rounded border border-border px-1.5 text-[10.5px]">{selPool ? 1 : 0}/{poolList.length}</span>
        {[CheckSquare, Edit3, Filter].map((I, i) => <span key={i} className="grid size-5 place-items-center rounded bg-primary text-primary-foreground"><I className="size-3" /></span>)}</div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 pt-1">
        <span className={lbl}>Script d’envoi :</span><select aria-label="Script d’envoi" value={f.script} onChange={e => s("script", e.target.value)} className={inCls}><option value="queue">Queue (x/time)</option><option value="burst">Burst</option></select>
        <span className={lbl}>Changer d’interface (IP) après :</span><div className="flex items-center gap-2"><input aria-label="Rotation IP" value={f.rotate} onChange={e => s("rotate", e.target.value)} className={inCls} /><span className="text-[11px]">Email(s)</span></div>
        <span className={lbl}>Vitesse d’envoi :</span><div className="flex items-center gap-2"><input aria-label="Vitesse" value={f.speed} onChange={e => s("speed", e.target.value)} className={inCls} /><span className="whitespace-nowrap text-[11px]">Emails/s</span><select aria-label="Unité" value={f.unit} onChange={e => s("unit", e.target.value)} className={inCls}><option value="minute">Minute</option><option value="hour">Heure</option></select></div>
        <span className={lbl}>Batch :</span><div className="flex items-center gap-2"><input aria-label="Batch" value={f.batch} onChange={e => s("batch", e.target.value)} className={inCls} /><span className="whitespace-nowrap text-[11px]">emails par livraison.</span></div>
        <span className={lbl}>Pause :</span><div className="flex items-center gap-2"><input aria-label="Pause" value={f.pause} onChange={e => s("pause", e.target.value)} className={inCls} /><select aria-label="Unité pause" value={f.pauseUnit} onChange={e => s("pauseUnit", e.target.value)} className={inCls}><option value="minute">Minute</option><option value="second">Seconde</option></select><span className="whitespace-nowrap text-[10.5px]">avant le prochain envoi.</span></div>
      </div>
      <div className="rounded-lg border border-neon-amber/40 bg-neon-amber/10 p-2">
        <p className="flex items-center gap-1.5 text-[12px] font-bold text-primary"><AlertCircle className="size-4 text-neon-amber" />Observateur de file (Queue Watcher)</p>
        <p className="text-[10.5px] text-neon-red">Cette fonctionnalité fonctionne uniquement en mode serveur mono.</p>
      </div>
      <p className="text-[10.5px] text-muted-foreground">Le rythme réel est appliqué par le Traffic Shaping et le Warm-up de chaque IP.</p>
    </Box>
    <Box title="Auto-Réponse" icon={<Mail />}>
      <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2 gap-y-1.5">
        <span className={lbl}>Statut :</span><select aria-label="Statut auto-réponse" value={f.auto} onChange={e => s("auto", e.target.value)} className={inCls}><option value="off">Désactivée</option><option value="on">Activée</option></select>
        <span className={lbl}>Aléatoire :</span><select aria-label="Aléatoire" value={f.random} onChange={e => s("random", e.target.value)} className={inCls}><option value="off">Désactivée</option><option value="on">Activée</option></select>
        <span className={lbl}>Rotation :</span><input aria-label="Rotation auto-réponse" value={f.arot} onChange={e => s("arot", e.target.value)} className={inCls} /><span /><span />
      </div>
      <div className="grid grid-cols-[auto_1fr] items-start gap-2"><span className={lbl}>Comptes email :</span><textarea aria-label="Comptes email" value={f.accounts} onChange={e => s("accounts", e.target.value)} placeholder="Collez ici les comptes email actifs pour l’auto-réponse..." className="h-12 w-full resize-y rounded-md border border-border bg-card p-1.5 text-[11px]" /></div>
    </Box>
  </>;
}
