import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function guard(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superadmin" });
  if (data) return;
  const { data: tasks } = await ctx.supabase.from("worker_tasks").select("allowed_paths").eq("status", "active");
  if (!(tasks ?? []).some((t: any) => (t.allowed_paths ?? []).includes("/dashboard/gmail-postmaster"))) throw new Error("Accès non autorisé");
}

export const getPostmasterDomains = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await guard(context);
    const { listDomains, serviceEmail } = await import("./postmaster.server");
    try {
      return { serviceEmail: serviceEmail(), domains: await listDomains(), error: null as string | null };
    } catch (e) {
      return { serviceEmail: serviceEmail(), domains: [], error: (e as Error).message };
    }
  });

export const getPostmasterStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { domain: string; days: number }) => {
    const domain = String(i.domain).trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error("Domaine invalide");
    const days = [7, 14, 30, 90, 120].includes(Number(i.days)) ? Number(i.days) : 30;
    return { domain, days };
  })
  .handler(async ({ data, context }) => {
    await guard(context);
    const { trafficStats, compliance } = await import("./postmaster.server");
    const [st, co] = await Promise.allSettled([trafficStats(data.domain, data.days), compliance(data.domain)]);
    return {
      stats: st.status === "fulfilled" ? st.value : [],
      compliance: co.status === "fulfilled" ? co.value : null,
      error: st.status === "rejected" ? (st.reason as Error).message : null as string | null,
    };
  });
