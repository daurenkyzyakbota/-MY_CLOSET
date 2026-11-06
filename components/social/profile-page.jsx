'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Icon, PageHeader } from '@/components/ui/ui.jsx';
import {
  PersonActions,
  ProfileAvatar,
  ShareDialog,
  SocialAccessNote,
  SocialNotice,
  socialCountWord,
  useSocialCollection,
} from './social-common.jsx';
import PostCard from './post-card.jsx';

export function ProfileHeader({ profile, onEdit, onChanged }) {
  const social = useSocial();
  const [sharing, setSharing] = useState(false);
  const self = profile.relationship === 'self' || social.user?.id === profile.id;
  return (
    <section className="social-profile-hero social-surface">
      <div className="social-profile-cover" aria-hidden="true">
        <span>MY STYLE, MY STORY</span>
      </div>
      <div className="social-profile-content">
        <div className="social-profile-top">
          <ProfileAvatar profile={profile} large />
          <div className="social-profile-controls">
            <AppButton className="btn btn-secondary" onClick={() => setSharing(true)}>
              Поделиться профилем
            </AppButton>
            {self &&
              (onEdit ? (
                <AppButton className="btn btn-primary" onClick={onEdit}>
                  <Icon name="edit" />
                  Редактировать
                </AppButton>
              ) : (
                <Link className="btn btn-primary" href="/community?tab=profile">
                  Мой профиль
                </Link>
              ))}
          </div>
        </div>
        <div className="social-profile-heading">
          <h2>{profile.name}</h2>
          <span className="social-handle">@{profile.username}</span>
          {profile.private && <span className="tag">Закрытый профиль</span>}
        </div>
        {profile.bio && <p className="social-profile-bio">{profile.bio}</p>}
        <div className="social-profile-meta">
          {profile.city && (
            <span>
              <Icon name="pin" />
              {profile.city}
            </span>
          )}
          {profile.styles && (
            <span>
              <Icon name="sparkle" />
              {profile.styles}
            </span>
          )}
        </div>
        <div className="social-profile-stats">
          <span>
            <strong>{profile.postCount || 0}</strong>{' '}
            {socialCountWord(profile.postCount, 'публикация', 'публикации', 'публикаций')}
          </span>
          <span>
            <strong>{profile.friendCount || 0}</strong>{' '}
            {socialCountWord(profile.friendCount, 'друг', 'друга', 'друзей')}
          </span>
        </div>
        {!self && <PersonActions person={profile} includeMenu onChanged={onChanged} />}
      </div>
      {sharing && (
        <ShareDialog
          path={`/people/${encodeURIComponent(profile.username)}`}
          title="Поделиться профилем"
          onClose={() => setSharing(false)}
        />
      )}
    </section>
  );
}

function ProfilePosts({ username }) {
  const social = useSocial();
  const posts = useSocialCollection('posts.list', { scope: 'profile', username }, 'posts', {
    enabled: social.ready && social.configured !== false,
  });
  function updated(post) {
    posts.setData((current) => ({
      ...current,
      posts: (current?.posts || []).map((value) => (value.id === post.id ? post : value)),
    }));
  }
  return (
    <section className="social-profile-posts">
      <div className="social-section-heading">
        <h2>Опубликованные образы</h2>
        <AppButton className="btn btn-ghost" onClick={posts.reload} disabled={posts.loading}>
          <Icon name="refresh" />
          Обновить
        </AppButton>
      </div>
      <SocialNotice error onRetry={posts.reload}>
        {posts.error}
      </SocialNotice>
      {posts.loading && (
        <p className="social-loading" role="status">
          Загружаем образы…
        </p>
      )}
      {!posts.loading && posts.data?.posts?.length === 0 && (
        <div className="social-empty-inline">
          <Icon name="outfits" size={30} />
          <p>Доступных публикаций пока нет.</p>
        </div>
      )}
      <div className="social-post-list">
        {(posts.data?.posts || []).map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onUpdated={updated}
            onDeleted={(id) =>
              posts.setData((current) => ({
                ...current,
                posts: (current?.posts || []).filter((value) => value.id !== id),
              }))
            }
          />
        ))}
      </div>
      {posts.data?.nextCursor && (
        <div className="social-load-more">
          <AppButton
            className="btn btn-secondary"
            onClick={posts.loadMore}
            disabled={posts.moreLoading}
          >
            {posts.moreLoading ? 'Загружаем…' : 'Ещё образы'}
          </AppButton>
        </div>
      )}
    </section>
  );
}

export default function ProfilePage({ username }) {
  const social = useSocial();
  const result = useSocialCollection('profile.get', { username }, 'people', {
    enabled: social.ready && social.configured !== false,
  });
  const profile = result.data?.profile;
  return (
    <>
      <PageHeader
        eyebrow="ЛЮДИ И ИХ СТИЛЬ"
        title="Профиль участника"
        description="История стиля в деталях и любимых сочетаниях."
      >
        <Link href="/community?tab=people" className="btn btn-secondary">
          <Icon name="chevron-left" />К участникам
        </Link>
      </PageHeader>
      <SocialNotice error onRetry={social.refresh}>
        {social.error}
      </SocialNotice>
      {social.configured === false ? (
        <SocialAccessNote />
      ) : (
        <>
          <SocialNotice error onRetry={result.reload}>
            {result.error}
          </SocialNotice>
          {result.loading && (
            <p className="social-loading" role="status">
              Открываем профиль…
            </p>
          )}
          {profile && (
            <div key={`${profile.id}:${social.user?.id || 'guest'}`}>
              <ProfileHeader profile={profile} onChanged={result.reload} />
              {profile.canViewPosts === false ? (
                <div className="social-private-note social-surface">
                  <Icon name="user" size={34} />
                  <h2>Образы доступны друзьям</h2>
                  <p>
                    Отправьте заявку. После её принятия вы увидите публикации, которыми автор
                    делится с друзьями.
                  </p>
                </div>
              ) : (
                <ProfilePosts
                  key={`${profile.username}:${profile.relationship}`}
                  username={profile.username}
                />
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
