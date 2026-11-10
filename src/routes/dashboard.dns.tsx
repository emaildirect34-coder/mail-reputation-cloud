import { createFileRoute } from "@tanstack/react-router";
import { Domains } from "./dashboard.domains";

export const Route = createFileRoute("/dashboard/dns")({
  head: () => ({ meta: [{ title: "DNS & Automatisation — Email Direct" }] }),
  component: Domains,
});
