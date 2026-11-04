import { LayoutDashboard, Send, Layers, FileText } from "lucide-react";

export const campaignTabs = [
  { label: "Nouvelle campagne", icon: Send, to: "/dashboard/campaigns" },
  { label: "Offres Sponsors", icon: FileText, to: "/dashboard/templates" },
  { label: "Vue d'ensemble", icon: LayoutDashboard, to: "/dashboard" },
  { label: "Files", icon: Layers, to: "/dashboard/queues" },
];
