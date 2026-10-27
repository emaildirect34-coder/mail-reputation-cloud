import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Stat, Panel, Pill, Bar } from "@/components/dash/kit";

export const Route = createFileRoute("/dashboard/servers")({
  head: () => ({ meta: [{ title: "Serveurs — Email Direct" }] }),
  component: Servers,
});

const servers = [
  { name: "mta-paris-01", region: "Paris (fr-par)", ips: 4, cpu: 32, ram: 48, queue: 120, status: "En ligne" },
  { name: "mta-frankfurt-01", region: "Francfort (eu-central)", ips: 8, cpu: 61, ram: 55, queue: 2340, status: "En ligne" },
  { name: "mta-newark-02", region: "Newark (us-east)", ips: 2, cpu: 0, ram: 0, queue: 0, status: "Installation" },
];

function Servers() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="Serveurs KumoMTA"
        desc="Vos nœuds d'envoi, créés et configurés automatiquement."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Nouveau serveur</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Créer un serveur d'envoi</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2"><Label>Nom</Label><Input placeholder="mta-paris-02" /></div>
                <div className="space-y-2">
                  <Label>Région</Label>
                  <Select defaultValue="fr"><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fr">Paris</SelectItem>
                      <SelectItem value="de">Francfort</SelectItem>
                      <SelectItem value="us">Newark</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Nombre d'IPs</Label><Input type="number" defaultValue={4} min={1} /></div>
                  <div className="space-y-2">
                    <Label>Type d'IP</Label>
                    <Select defaultValue="dedicated"><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dedicated">Dédiée</SelectItem>
                        <SelectItem value="shared">Partagée</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter><Button onClick={() => setOpen(false)}>Créer (démo)</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Serveurs" value="3" />
        <Stat label="IPs totales" value="14" />
        <Stat label="File d'attente" value="2 460" sub="messages" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {servers.map((s) => (
          <Panel key={s.name} title={s.name} action={<Pill tone={s.status === "En ligne" ? "ok" : "warn"}>{s.status}</Pill>}>
            <p className="text-sm text-muted-foreground">{s.region} · {s.ips} IPs</p>
            <div className="mt-4 space-y-3 text-sm">
              <div><div className="mb-1 flex justify-between"><span>CPU</span><span>{s.cpu}%</span></div><Bar value={s.cpu} /></div>
              <div><div className="mb-1 flex justify-between"><span>RAM</span><span>{s.ram}%</span></div><Bar value={s.ram} /></div>
              <div className="flex justify-between"><span>File d'attente</span><span className="font-medium">{s.queue}</span></div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline">Redémarrer</Button>
              <Button size="sm" variant="outline">Détails</Button>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
