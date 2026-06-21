import { SupabaseClient } from '@/components/settings/SupabaseClient';

export const dynamic = 'force-dynamic';

export default function SupabaseSettingsPage(): React.ReactElement {
  return <SupabaseClient />;
}
