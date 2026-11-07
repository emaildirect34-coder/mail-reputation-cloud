import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ACCESS_AREAS, type Access } from "./access";

async function assertSuper(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superadmin" });
  if (!data) throw new Error("Accès réservé au Superadmin");
}

export const getMyAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Access> => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const r = (roles ?? []).map((x) => x.role);
    if (r.includes("superadmin")) return { role: "superadmin", paths: [] };
    if (!r.includes("worker")) return { role: null, paths: [] };
    const { data: tasks } = await supabase.from("worker_tasks").select("allowed_paths").eq("user_id", userId).eq("status", "active");
    return { role: "worker", paths: [...new Set((tasks ?? []).flatMap((t) => t.allowed_paths))] };
  });

export const listMyTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("worker_tasks").select("*").eq("user_id", context.userId).order("created_at", { ascending: false });
    return data ?? [];
  });

export const listTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const { data: tasks } = await supabaseAdmin.from("worker_tasks").select("*").order("created_at", { ascending: false });
    return users.users
      .map((u) => ({
        id: u.id,
        email: u.email ?? "",
        confirmed: !!u.last_sign_in_at,
        role: (roles ?? []).find((r) => r.user_id === u.id)?.role ?? null,
        tasks: (tasks ?? []).filter((t) => t.user_id === u.id),
      }))
      .filter((u) => u.role);
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { email: string; role: "superadmin" | "worker"; redirectTo: string }) => {
    const email = String(i.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email invalide");
    if (i.role !== "superadmin" && i.role !== "worker") throw new Error("Rôle invalide");
    return { email, role: i.role, redirectTo: String(i.redirectTo) };
  })
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, { redirectTo: data.redirectTo });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("user_roles").upsert({ user_id: inv.user.id, role: data.role }, { onConflict: "user_id,role" });
    return { id: inv.user.id };
  });

export const assignTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { userId: string; title: string; description?: string; paths: string[] }) => {
    const allowed = new Set(ACCESS_AREAS.map((a) => a.path));
    const paths = (i.paths ?? []).filter((p) => allowed.has(p));
    if (!i.title?.trim()) throw new Error("Titre requis");
    if (!paths.length) throw new Error("Choisissez au moins une fonctionnalité");
    return { userId: String(i.userId), title: i.title.trim().slice(0, 200), description: (i.description ?? "").slice(0, 2000), paths };
  })
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const { error } = await context.supabase.from("worker_tasks").insert({
      user_id: data.userId, title: data.title, description: data.description, allowed_paths: data.paths, assigned_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; status: "active" | "done" | "deleted" }) => i)
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const q = data.status === "deleted"
      ? context.supabase.from("worker_tasks").delete().eq("id", data.id)
      : context.supabase.from("worker_tasks").update({ status: data.status }).eq("id", data.id);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { userId: string }) => i)
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    if (data.userId === context.userId) throw new Error("Vous ne pouvez pas vous retirer vous-même");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("worker_tasks").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
