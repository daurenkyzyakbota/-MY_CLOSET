import { ClosetProvider } from '@/components/closet-provider.jsx';
import MyClosetShell from '@/components/mycloset-shell.jsx';
import { CloudSyncProvider } from '@/components/cloud-sync-provider.jsx';

export default function ClosetLayout({ children }) {
  return <ClosetProvider><CloudSyncProvider><MyClosetShell>{children}</MyClosetShell></CloudSyncProvider></ClosetProvider>;
}
