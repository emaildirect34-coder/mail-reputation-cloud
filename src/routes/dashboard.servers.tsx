import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { InfrastructurePage } from '@/components/dash/infrastructure';
export const Route = createFileRoute('/dashboard/servers')({
  validateSearch: (search: Record<string, unknown>): { server?: string } => {
    const server = z.string().uuid().safeParse(search['server']);
    return server.success ? { server: server.data } : {};
  },
  head: () => ({ meta: [
    { title: 'Serveurs réels — Email Direct' },
    { name: 'description', content: 'Inventaire réel multi-comptes Linode, Vultr, Hetzner et DigitalOcean.' },
    { property: 'og:title', content: 'Serveurs réels — Email Direct' },
    { property: 'og:description', content: 'Inventaire réel multi-comptes Linode, Vultr, Hetzner et DigitalOcean.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: ServersPage,
});

function ServersPage() {
  const { server } = Route.useSearch();
  return <InfrastructurePage key={server} view="servers" initialServerId={server ?? ''} />;
}
