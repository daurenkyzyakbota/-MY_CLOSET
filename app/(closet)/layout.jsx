import { ClosetProvider } from '@/components/closet-provider.jsx';
import MyClosetShell from '@/components/mycloset-shell.jsx';

export default function ClosetLayout({ children }) {
  return <ClosetProvider><MyClosetShell>{children}</MyClosetShell></ClosetProvider>;
}
