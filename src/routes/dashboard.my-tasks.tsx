import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PageHeader, Panel, Pill } from "@/components/dash/kit";
import { ACCESS_AREAS } from "@/lib/access";
import { listMyTasks } from "@/lib/team.functions";

export const Route = createFileRoute("/dashboard/my-tasks")({
  head: () => ({
    meta: [
      { title: "Mes tâches — Email Direct" },
      { name: "description", content: "Les tâches qui vous sont attribuées et leurs fonctionnalités." },
      { property: "og:title", content: "Mes tâches — Email Direct" },
      { property: "og:description", content: "Vos tâches Email Direct." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyTasks,
});

function MyTasks() {
  const fn = useServerFn(listMyTasks);
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof listMyTasks>>>([]);
  useEffect(() => { fn().then(setTasks); }, [fn]);
  return (
    <div className="space-y-4">
      <PageHeader title="Mes tâches" desc="Vous voyez uniquement les fonctionnalités liées à vos tâches." />
      {tasks.length === 0 && <Panel><p className="text-sm text-muted-foreground">Aucune tâche ne vous est encore attribuée.</p></Panel>}
      {tasks.map((t) => (
        <Panel key={t.id} title={t.title} action={<Pill tone={t.status === "active" ? "good" : "neutral"}>{t.status === "active" ? "Active" : "Terminée"}</Pill>}>
          {t.description && <p className="mb-3 text-sm text-muted-foreground">{t.description}</p>}
          {t.status === "active" && (
            <div className="flex flex-wrap gap-2">
              {t.allowed_paths.map((p) => (
                <Link key={p} to={p} className="rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                  {ACCESS_AREAS.find((a) => a.path === p)?.label ?? p}
                </Link>
              ))}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}
