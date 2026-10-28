import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, Panel, Stat } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ChevronsRight, ChevronRight, ChevronLeft, ChevronsLeft, Save, Rocket } from "lucide-react";

export const Route = createFileRoute("/dashboard/campaigns")({
  head: () => ({ meta: [{ title: "Campagnes Pro — Email Direct" }, { name: "description", content: "Éditeur de campagnes avancé : rotation d'en-têtes, macros, VMTA." }] }),
  component: Campaigns,
});

const defaultHeader = `Return-Path: <{an,5}@[domain]>
Date: [smtp_date]
Message-Id: <{n,15}.{n,1}.{A,3}{n,10}@[domain]>
To: [to]
From: [from_name] <[from_email]>
Subject: [subject]
Content-Type: text/html; charset=UTF-8
Mime-Version: 1.0
Content-Transfer-Encoding: 8bit`;

const allServers = ["SRV011 · fra-1", "SRV012 · fra-2", "SRV020 · ams-1", "SRV031 · nyc-1", "SRV044 · lon-1"];
const vmtas = ["vmta-45_13_38_26-N1 · trackcom.site", "vmta-45_13_38_27-N1 · trackcom.site", "vmta-45_13_38_28-N2 · mail.brand.io"];

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
function Sel({ opts }: { opts: string[] }) {
  return <select className="h-9 w-full rounded-md border bg-background px-2 text-sm">{opts.map((o) => <option key={o}>{o}</option>)}</select>;
}

function Campaigns() {
  const [avail, setAvail] = useState(allServers.slice(1));
  const [chosen, setChosen] = useState([allServers[0]!]);
  const [sel, setSel] = useState<string | null>(null);
  const move = (dir: "r" | "l" | "rr" | "ll") => {
    if (dir === "rr") { setChosen([...chosen, ...avail]); setAvail([]); }
    else if (dir === "ll") { setAvail([...avail, ...chosen]); setChosen([]); }
    else if (sel && dir === "r" && avail.includes(sel)) { setAvail(avail.filter((x) => x !== sel)); setChosen([...chosen, sel]); }
    else if (sel && dir === "l" && chosen.includes(sel)) { setChosen(chosen.filter((x) => x !== sel)); setAvail([...avail, sel]); }
  };
  const List = ({ items }: { items: string[] }) => (
    <div className="h-36 overflow-auto rounded-md border bg-background p-1 font-mono text-xs">
      {items.map((i) => (
        <button key={i} onClick={() => setSel(i)} className={`block w-full rounded px-2 py-1 text-left ${sel === i ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{i}</button>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Éditeur de campagnes Pro"
        desc="Offre, structure d'email avec macros, et distribution sur vos serveurs KumoMTA."
        action={<div className="flex items-center gap-3"><div className="flex items-center gap-2 text-sm"><Switch defaultChecked /> Mode test</div><Button variant="outline"><Save className="h-4 w-4" /> Enregistrer</Button><Button><Rocket className="h-4 w-4" /> Enregistrer & lancer</Button></div>}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Ouvertures" value="0" /><Stat label="Clics" value="0" /><Stat label="Désinscriptions" value="0" /><Stat label="Ventes" value="0 €" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4">
          <Panel title="Offre">
            <div className="space-y-3">
              <F label="Nom de campagne"><Input defaultValue="AUTO" /></F>
              <F label="Planifier à"><Input type="datetime-local" /></F>
              <F label="Offre"><Sel opts={["[Google] Unsubscribe offer", "[Shop] Promo Q4"]} /></F>
              <F label="GEO autorisés"><Input defaultValue="all" /></F>
              <div className="grid grid-cols-2 gap-3">
                <F label="Période de test (emails)"><Input defaultValue="1000" /></F>
                <F label="Rotation tests"><Input defaultValue="1" /></F>
              </div>
              <F label="Emails de test"><Textarea rows={2} defaultValue="seed@gmail.com" /></F>
              <div className="flex items-center justify-between rounded-md border p-3 text-sm"><span>Protection anti-bots (liens uniques)</span><Switch defaultChecked /></div>
            </div>
          </Panel>
          <Panel title="Configuration du corps">
            <div className="space-y-3">
              <F label="Domaine de tracking"><Input defaultValue="trackcom.site" /></F>
              <F label="Suffixe URL"><Input placeholder="?utm_source=ed" /></F>
              <F label="Image désinscription"><Sel opts={["Pixel", "Image", "Aucune"]} /></F>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Structure de l'email">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <F label="Nom expéditeur"><Input defaultValue="Support" /></F>
                <F label="Email expéditeur"><Input defaultValue="news@[domain]" /></F>
                <F label="Reply-To"><Input /></F>
                <F label="Return-Path"><Input defaultValue="bounce@[domain]" /></F>
              </div>
              <F label="Sujet"><Input defaultValue="Votre récapitulatif {A,4}" /></F>
              <div className="grid grid-cols-3 gap-3">
                <F label="Type"><Sel opts={["text/html", "text/plain", "multipart"]} /></F>
                <F label="Charset"><Sel opts={["UTF-8", "ISO-8859-1"]} /></F>
                <F label="Encodage"><Sel opts={["8bit", "base64", "quoted-printable"]} /></F>
              </div>
              <F label="En-tête [Header 1] · rotation 1"><Textarea rows={9} className="font-mono text-xs" defaultValue={defaultHeader} /></F>
              <p className="text-xs text-muted-foreground">Macros : <code>{"{n,X}"}</code> chiffres, <code>{"{A,X}"}</code> lettres, <code>{"{an,X}"}</code> alphanum., <code>[domain]</code>, <code>[smtp_date]</code></p>
              <F label="Corps [Html 1]"><Textarea rows={6} className="font-mono text-xs" defaultValue={'<html><body>\n<p>Bonjour [first_name],</p>\n<a href="[unsub]">Se désinscrire</a>\n</body></html>'} /></F>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Délivrabilité">
            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground">Serveurs de distribution</Label>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <List items={avail} />
                <div className="flex flex-col gap-1">
                  <Button size="icon" variant="outline" onClick={() => move("rr")}><ChevronsRight className="h-4 w-4" /></Button>
                  <Button size="icon" variant="outline" onClick={() => move("r")}><ChevronRight className="h-4 w-4" /></Button>
                  <Button size="icon" variant="outline" onClick={() => move("l")}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button size="icon" variant="outline" onClick={() => move("ll")}><ChevronsLeft className="h-4 w-4" /></Button>
                </div>
                <List items={chosen} />
              </div>
              <div className="flex flex-wrap gap-1">{["IPv4", "IPv6", "SMTP", "Route", "Custom", "Tous"].map((f) => <Button key={f} size="sm" variant="secondary" className="h-7 text-xs">{f}</Button>)}</div>
              <Label className="text-xs text-muted-foreground">Interfaces (VMTA)</Label>
              <div className="space-y-1">{vmtas.map((v) => <label key={v} className="flex items-center gap-2 rounded-md border px-2 py-1.5 font-mono text-xs"><input type="checkbox" defaultChecked /> {v}</label>)}</div>
              <F label="Script d'envoi"><Sel opts={["Queue (x/temps)", "X-Delay", "Rafale"]} /></F>
              <div className="grid grid-cols-2 gap-3">
                <F label="Changer d'IP après (emails)"><Input defaultValue="1" /></F>
                <F label="Vitesse (par minute)"><Input defaultValue="100" /></F>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
