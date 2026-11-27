import AdminPage from '@/components/pages/admin-page.jsx';

export const metadata = { title: 'Пользователи · Админ-панель' };

export default function Page() {
  return <AdminPage section="users" />;
}
