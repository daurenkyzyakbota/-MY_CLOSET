import { ClosetProvider } from '@/components/providers/closet-provider.jsx';
import MyClosetShell from '@/components/layout/mycloset-shell.jsx';
import { CloudSyncProvider } from '@/components/providers/cloud-sync-provider.jsx';

export default function ClosetLayout({ children }) {
  return (
    <ClosetProvider>
      <CloudSyncProvider>
        <MyClosetShell>{children}</MyClosetShell>
      </CloudSyncProvider>
    </ClosetProvider>
  );
}
