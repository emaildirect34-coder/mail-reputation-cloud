import { createFileRoute } from '@tanstack/react-router';
import { InfrastructurePage } from '@/components/dash/infrastructure';
export const Route = createFileRoute('/dashboard/servers')({
  head: () => ({ meta: [
    { title: 'Serveurs réels — Email Direct' },
    { name: 'description', content: 'Inventaire réel multi-comptes Linode, Vultr, Hetzner et DigitalOcean.' },
    { property: 'og:title', content: 'Serveurs réels — Email Direct' },
    { property: 'og:description', content: 'Inventaire réel multi-comptes Linode, Vultr, Hetzner et DigitalOcean.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <InfrastructurePage view="servers" />,
});
