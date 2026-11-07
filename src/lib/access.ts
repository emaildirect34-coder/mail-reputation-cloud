// Catalog of dashboard areas a superadmin can grant to a worker task.
export const ACCESS_AREAS: { path: string; label: string }[] = [
  { path: "/dashboard/campaigns", label: "Campagnes" },
  { path: "/dashboard/templates", label: "Offres Sponsors" },
  { path: "/dashboard/api-keys", label: "API & SMTP" },
  { path: "/dashboard/logs", label: "Logs & événements" },
  { path: "/dashboard/servers", label: "Serveurs VPS" },
  { path: "/dashboard/marketplace", label: "Achat serveurs" },
  { path: "/dashboard/ips", label: "IP & Warmup" },
  { path: "/dashboard/warmup", label: "Warmup" },
  { path: "/dashboard/pools", label: "Pools VMTA" },
  { path: "/dashboard/queues", label: "Files KumoMTA" },
  { path: "/dashboard/shaping", label: "Traffic Shaping" },
  { path: "/dashboard/domains", label: "Domaines" },
  { path: "/dashboard/dns", label: "DNS & Automatisation" },
  { path: "/dashboard/lab", label: "Deliverability Lab" },
  { path: "/dashboard/inbox-tester", label: "Testeur Inbox" },
  { path: "/dashboard/reputation", label: "Réputation FAI" },
  { path: "/dashboard/postmaster", label: "Postmaster" },
  { path: "/dashboard/preflight", label: "Pre-Flight" },
  { path: "/dashboard/shield", label: "Protection & Urgence" },
  { path: "/dashboard/suppression", label: "Suppressions" },
  { path: "/dashboard/validation", label: "Conformité" },
  { path: "/dashboard/webhooks", label: "Webhooks" },
  { path: "/dashboard/agent", label: "Agent IA" },
];

export type Access = { role: "superadmin" | "worker" | null; paths: string[] };

/** True when the current access may open the given dashboard path. */
export function canOpen(access: Access, path: string): boolean {
  if (access.role === "superadmin") return true;
  if (path === "/dashboard/my-tasks") return access.role === "worker";
  return access.paths.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "_"));
}
