import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader, Panel, Pill } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACCESS_AREAS } from "@/lib/access";
import { assignTask, inviteMember, listTeam, removeMember, setTaskStatus } from "@/lib/team.functions";

export const Route = createFileRoute("/dashboard/team")({
  head: () => ({
    meta: [
      { title: "Équipe & tâches — Email Direct" },
      { name: "description", content: "Invitez des Superadmins et des Workers, et attribuez-leur des tâches." },
      { property: "og:title", content: "Équipe & tâches — Email Direct" },
      { property: "og:description", content: "Gestion des accès de l'équipe Email Direct." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Team,
});

type Member = Awaited<ReturnType<typeof listTeam>>[number];

function Team() {
  const list = useServerFn(listTeam);
  const invite = useServerFn(inviteMember);
  const assign = useServerFn(assignTask);
  const setStatus = useServerFn(setTaskStatus);
  const remove = useServerFn(removeMember);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<"worker" | "superadmin">("worker");
  const [target, setTarget] = useState("");
  const [paths, setPaths] = useState<string[]>([]);

  const load = useCallback(() => list().then(setMembers).catch((e) => toast.error(e.message)), [list]);
  useEffect(() => { load(); }, [load]);

  async function onInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email"));
    setBusy(true);
    try {
      await invite({ data: { email, role, redirectTo: window.location.origin + "/set-password" } });
      toast.success(`Invitation envoyée à ${email}`);
      form.reset();
      load();
    } catch (err) { toast.error((err as Error).message); }
    setBusy(false);
  }

  async function onAssign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    try {
      await assign({ data: { userId: target, title: String(f.get("title")), description: String(f.get("description") ?? ""), paths } });
      toast.success("Tâche attribuée");
      form.reset(); setPaths([]);
      load();
    } catch (err) { toast.error((err as Error).message); }
    setBusy(false);
  }

  const workers = members.filter((m) => m.role === "worker");

  return (
    <div className="space-y-4">
      <PageHeader title="Équipe & tâches" desc="Invitez des membres par email et attribuez des tâches aux Workers." />

      <Panel title="Inviter un membre">
        <form onSubmit={onInvite} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required placeholder="nom@exemple.com" /></div>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(["worker", "superadmin"] as const).map((r) => (
              <Button key={r} type="button" size="sm" variant={role === r ? "default" : "ghost"} onClick={() => setRole(r)}>{r === "worker" ? "Worker" : "Superadmin"}</Button>
            ))}
          </div>
          <Button type="submit" disabled={busy}>Envoyer l'invitation</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Le membre reçoit un email et crée lui-même son mot de passe.</p>
      </Panel>

      <Panel title="Attribuer une tâche à un Worker">
        {workers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Invitez d'abord un Worker.</p>
        ) : (
          <form onSubmit={onAssign} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="worker">Worker</Label>
                <select id="worker" required value={target} onChange={(e) => setTarget(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Choisir…</option>
                  {workers.map((w) => <option key={w.id} value={w.id}>{w.email}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="title">Titre de la tâche</Label><Input id="title" name="title" required placeholder="Ex. Surveiller le warmup des IP" /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="description">Consignes</Label><Textarea id="description" name="description" rows={2} /></div>
            <div>
              <Label>Fonctionnalités visibles pour cette tâche</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {ACCESS_AREAS.map((a) => {
                  const on = paths.includes(a.path);
                  return (
                    <label key={a.path} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${on ? "border-primary bg-primary/10" : "border-border"}`}>
                      <input type="checkbox" checked={on} onChange={() => setPaths((p) => on ? p.filter((x) => x !== a.path) : [...p, a.path])} />
                      {a.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <Button type="submit" disabled={busy || !target}>Attribuer la tâche</Button>
          </form>
        )}
      </Panel>

      <Panel title={`Membres (${members.length})`}>
        <div className="space-y-3">
          {members.map((m) => (
            <div key={m.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-semibold">{m.email}</p>
                <Pill tone={m.role === "superadmin" ? "ok" : "neutral"}>{m.role === "superadmin" ? "Superadmin" : "Worker"}</Pill>
                {!m.confirmed && <Pill tone="warn">Invitation en attente</Pill>}
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (!confirm(`Retirer ${m.email} ?`)) return;
                  try { await remove({ data: { userId: m.id } }); load(); } catch (e) { toast.error((e as Error).message); }
                }}>Retirer</Button>
              </div>
              {m.tasks.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.tasks.map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 font-medium">{t.title}</span>
                      <span className="text-xs text-muted-foreground">{t.allowed_paths.length} fonctionnalité(s)</span>
                      <Pill tone={t.status === "active" ? "ok" : "neutral"}>{t.status === "active" ? "Active" : "Terminée"}</Pill>
                      <Button size="sm" variant="ghost" onClick={async () => { await setStatus({ data: { id: t.id, status: t.status === "active" ? "done" : "active" } }); load(); }}>
                        {t.status === "active" ? "Terminer" : "Réactiver"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={async () => { await setStatus({ data: { id: t.id, status: "deleted" } }); load(); }}>Supprimer</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
