import { createFileRoute } from '@tanstack/react-router';
import { InfrastructurePage } from '@/components/dash/infrastructure';
export const Route = createFileRoute('/dashboard/warmup')({
  head: () => ({ meta: [
    { title: 'Plans de warmup — Email Direct' },
    { name: 'description', content: 'Plans de chauffe par IP et FAI, avec quotas enregistrés.' },
    { property: 'og:title', content: 'Plans de warmup — Email Direct' },
    { property: 'og:description', content: 'Plans de chauffe par IP et FAI, avec quotas enregistrés.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <InfrastructurePage view="warmup" />,
});
