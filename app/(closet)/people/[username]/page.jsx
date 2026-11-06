import ProfilePage from '@/components/social/profile-page.jsx';

export const metadata = { title: 'Профиль участника' };

export default async function Page({ params }) {
  const { username } = await params;
  return <ProfilePage username={username} />;
}
