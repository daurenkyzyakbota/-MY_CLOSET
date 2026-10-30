'use client';

import Link from 'next/link';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { EmptyState, Loading } from '@/components/ui/ui.jsx';

export function SocialGate({ children, requireProfile = true }) {
  const social = useSocial();
  if (!social.ready || social.configured === null) return <Loading />;
  if (social.requiresHttps)
    return (
      <EmptyState
        icon="user"
        title="Для входа нужна защищённая ссылка"
        description="На компьютере откройте localhost. Для аккаунта с телефона потребуется HTTPS."
      />
    );
  if (!social.configured)
    return (
      <EmptyState
        icon="user"
        title="Сообщество пока не подключено"
        description="Личный гардероб работает. Для профилей и общения нужна настройка аккаунтов и базы."
      />
    );
  if (social.error && !social.profile)
    return (
      <EmptyState icon="user" title="Не удалось открыть профиль" description={social.error}>
        <AppButton className="btn btn-primary" onClick={() => void social.refresh({ quiet: true })}>
          Повторить
        </AppButton>
      </EmptyState>
    );
  if (!social.user)
    return (
      <EmptyState
        icon="user"
        title="Ваш стиль заслуживает своего профиля"
        description="Войдите, чтобы сохранять публикации, находить друзей и общаться."
      >
        <Link className="btn btn-primary" href="/account">
          Войти или зарегистрироваться
        </Link>
      </EmptyState>
    );
  if (requireProfile && !social.profile)
    return (
      <EmptyState
        icon="user"
        title="Представьтесь сообществу"
        description="Выберите уникальный ник, добавьте имя и настройте свой профиль."
      >
        <Link className="btn btn-primary" href="/community?tab=profile">
          Создать профиль
        </Link>
      </EmptyState>
    );
  return children;
}

export default SocialGate;
