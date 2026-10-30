import { ClosetProvider } from '@/components/providers/closet-provider.jsx';
import MyClosetShell from '@/components/layout/mycloset-shell.jsx';
import { CloudSyncProvider } from '@/components/providers/cloud-sync-provider.jsx';
import { SocialProvider } from '@/components/providers/social-provider.jsx';

export default function ClosetLayout({ children }) {
  return (
    <ClosetProvider>
      <CloudSyncProvider>
        <SocialProvider>
          <MyClosetShell>{children}</MyClosetShell>
        </SocialProvider>
      </CloudSyncProvider>
    </ClosetProvider>
  );
}
