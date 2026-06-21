import { NotificationCenterClient } from '@/components/notifications/NotificationCenterClient';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Notification Center — OMNISCIENT',
  description:
    'Unified activity feed for every alert in the OMNISCIENT system — triggered price alerts, new signals, and Telegram deliveries, in one searchable, filterable timeline.',
};

export default function NotificationsPage() {
  return <NotificationCenterClient />;
}
