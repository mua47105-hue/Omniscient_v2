import { ProvidersManager } from '@/components/settings/ProvidersManager';
import { ModuleConfigSection } from '@/components/settings/ModuleConfigSection';

export const dynamic = 'force-dynamic';

export default function ProvidersPage() {
  return (
    <div className="space-y-6">
      <ProvidersManager />
      <ModuleConfigSection />
    </div>
  );
}
