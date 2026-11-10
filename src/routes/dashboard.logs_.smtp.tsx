import { createFileRoute } from '@tanstack/react-router';
import { DeliveryDashboard } from '@/components/dash/delivery-dashboard';

export const Route = createFileRoute('/dashboard/logs_/smtp')({
  head: () => ({ meta: [{ title: 'Délivrabilité SMTP — Email Direct' }] }),
  component: DeliveryDashboard,
});
