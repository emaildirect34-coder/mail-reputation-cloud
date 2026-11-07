import { createFileRoute } from '@tanstack/react-router';
import { InfrastructurePage } from '@/components/dash/infrastructure';
export const Route = createFileRoute('/dashboard/ips')({
  head: () => ({ meta: [
    { title: 'Adresses IP réelles — Email Direct' },
    { name: 'description', content: 'IPs publiques et plages IPv6 synchronisées depuis vos serveurs.' },
    { property: 'og:title', content: 'Adresses IP réelles — Email Direct' },
    { property: 'og:description', content: 'IPs publiques et plages IPv6 synchronisées depuis vos serveurs.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <InfrastructurePage view="ips" />,
});
