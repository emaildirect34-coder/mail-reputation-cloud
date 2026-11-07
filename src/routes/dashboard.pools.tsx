import { createFileRoute } from '@tanstack/react-router';
import { InfrastructurePage } from '@/components/dash/infrastructure';
export const Route = createFileRoute('/dashboard/pools')({
  head: () => ({ meta: [
    { title: 'Pools VMTA — Email Direct' },
    { name: 'description', content: 'Création de pools VMTA et affectation persistante des IPs.' },
    { property: 'og:title', content: 'Pools VMTA — Email Direct' },
    { property: 'og:description', content: 'Création de pools VMTA et affectation persistante des IPs.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <InfrastructurePage view="pools" />,
});
