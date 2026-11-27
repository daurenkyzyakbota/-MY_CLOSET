'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Icon, ItemArt, Modal } from '@/components/ui/ui.jsx';
import {
  PersonActions,
  PersonCard,
  ProfileAvatar,
  ShareDialog,
  SocialAccessNote,
  SocialNotice,
  socialCountWord,
  useSocialCollection,
} from './social-common.jsx';
import PostCard from './post-card.jsx';
import ProfileEditor from './profile-editor.jsx';
import { StoryAvatar } from './stories.jsx';

function profilePath(username) {
  return '/people/' + encodeURIComponent(username);
}

export function ProfileHeader({ profile, onEdit, onChanged, pageHeading = false }) {
  const social = useSocial();
  const [sharing, setSharing] = useState(false);
  const [list, setList] = useState(null);
  const self = profile.relationship === 'self' || social.user?.id === profile.id;
  const NameHeading = pageHeading ? 'h1' : 'h2';

  return (
    <section className="closet-profile-hero social-surface">
      <div className="closet-profile-overview">
        <div className="closet-profile-avatar">
          {profile.canViewPosts ? (
            <StoryAvatar profile={profile} large />
          ) : (
            <ProfileAvatar profile={profile} large />
          )}
        </div>
        <div className="closet-profile-identity">
          <div className="closet-profile-name">
            <NameHeading>{profile.name}</NameHeading>
            {(self || profile.private) && (
              <span className="closet-profile-visibility">
                <Icon name={profile.private ? 'lock' : 'users'} size={16} />
                {profile.private ? 'Закрытый профиль' : 'Открытый профиль'}
              </span>
            )}
          </div>
          <p className="social-handle closet-profile-handle">@{profile.username}</p>
          <dl className="closet-profile-stats">
            <div>
              <dt>{socialCountWord(profile.postCount, 'публикация', 'публикации', 'публикаций')}</dt>
              <dd>{profile.postCount || 0}</dd>
            </div>
            <div>
              <dt>
                <button
                  type="button"
                  className="closet-profile-stat-link"
                  disabled={!profile.canViewPosts}
                  onClick={() => setList('followers')}
                >
                  {socialCountWord(profile.followerCount, 'подписчик', 'подписчика', 'подписчиков')}
                </button>
              </dt>
              <dd>{profile.followerCount || 0}</dd>
            </div>
            <div>
              <dt>
                <button
                  type="button"
                  className="closet-profile-stat-link"
                  disabled={!profile.canViewPosts}
                  onClick={() => setList('following')}
                >
                  {socialCountWord(profile.followingCount, 'подписка', 'подписки', 'подписок')}
                </button>
              </dt>
              <dd>{profile.followingCount || 0}</dd>
            </div>
          </dl>
          {!self && profile.followsMe && (
            <p className="closet-profile-follows-me">Подписан(а) на вас</p>
          )}
        </div>
      </div>
      {(profile.bio || profile.city || profile.styles) && (
        <div className="closet-profile-about">
          {profile.bio && <p className="social-profile-bio">{profile.bio}</p>}
          {(profile.city || profile.styles) && (
            <ul className="closet-profile-meta">
              {profile.city && <li><Icon name="pin" size={18} /> {profile.city}</li>}
              {profile.styles && <li><Icon name="sparkle" size={18} /> {profile.styles}</li>}
            </ul>
          )}
        </div>
      )}
      <div className="closet-profile-actions">
        {self && (
          onEdit ? (
            <AppButton className="btn btn-primary" onClick={onEdit}>
              <Icon name="edit" /> Редактировать профиль
            </AppButton>
          ) : (
            <Link className="btn btn-primary" href="/community?tab=profile">
              <Icon name="edit" /> Редактировать профиль
            </Link>
          )
        )}
        {!self && <PersonActions person={profile} includeMenu onChanged={onChanged} />}
        <AppButton className="btn btn-secondary" onClick={() => setSharing(true)}>
          <Icon name="share" /> Поделиться
        </AppButton>
        {self && (
          <Link className="btn btn-ghost" href="/account">
            <Icon name="settings" /> Аккаунт
          </Link>
        )}
      </div>
      {list && (
        <FollowListDialog
          username={profile.username}
          type={list}
          onClose={() => setList(null)}
        />
      )}
      {sharing && (
        <ShareDialog
          path={profilePath(profile.username)}
          title="Поделиться профилем"
          onClose={() => setSharing(false)}
        />
      )}
    </section>
  );
}

// Followers or following of one profile, like the lists behind the counters on Instagram.
function FollowListDialog({ username, type, onClose }) {
  const people = useSocialCollection('follows.list', { username, type }, 'people');
  return (
    <Modal title={type === 'followers' ? 'Подписчики' : 'Подписки'} onClose={onClose}>
      <SocialNotice error onRetry={people.reload}>
        {people.error}
      </SocialNotice>
      {people.loading && (
        <p className="social-loading" role="status">
          Загружаем…
        </p>
      )}
      {people.data?.people?.length === 0 && !people.loading && (
        <p className="footnote">
          {type === 'followers' ? 'Пока ни одного подписчика.' : 'Пока ни на кого не подписан(а).'}
        </p>
      )}
      <div className="follow-list">
        {(people.data?.people || []).map((person) => (
          <PersonCard key={person.id} person={person} onChanged={people.reload} />
        ))}
      </div>
    </Modal>
  );
}

function ProfilePostPreview({ post }) {
  const item = post.snapshot?.items?.find((value) => value.photo) || post.snapshot?.items?.[0];
  const [failed, setFailed] = useState(false);

  return (
    <Link className="closet-profile-tile" href={'/community?post=' + encodeURIComponent(post.id)}>
      <div className="closet-profile-tile-media">
        <div className="closet-profile-tile-art" aria-hidden="true">
          {item?.photo && !failed ? (
            <img src={item.photo} alt="" loading="lazy" onError={() => setFailed(true)} />
          ) : item ? (
            <ItemArt item={{ ...item, photo: '' }} />
          ) : (
            <Icon name="outfits" size={44} />
          )}
        </div>
        {post.owned && post.visibility !== 'public' && (
          <span className="closet-profile-tile-visibility">
            <Icon name={post.visibility === 'private' ? 'lock' : 'users'} size={15} />
            {post.visibility === 'private' ? 'Только мне' : 'Друзьям'}
          </span>
        )}
        {post.poll ? (
          <span className="closet-profile-tile-count is-poll" aria-hidden="true">
            А/Б
          </span>
        ) : (post.snapshot?.items?.length || 0) > 1 && (
          <span className="closet-profile-tile-count" aria-hidden="true">
            <Icon name="copy" size={14} />
            {post.snapshot.items.length}
          </span>
        )}
        <span className="closet-profile-tile-overlay">
          <span>
            <Icon name="heart" size={18} fill="currentColor" />
            {post.likesCount || 0}
          </span>
          <span>
            <Icon name="message" size={18} fill="currentColor" />
            {post.commentsCount || 0}
          </span>
        </span>
      </div>
      <div className="closet-profile-tile-caption">
        <strong>{post.title}</strong>
        <Icon name="arrow" size={18} />
      </div>
    </Link>
  );
}

function ProfilePosts({ username, self }) {
  const social = useSocial();
  const posts = useSocialCollection('posts.list', { scope: 'profile', username }, 'posts', {
    enabled: social.ready && social.configured !== false,
  });
  const [view, setView] = useState('grid');
  const [kind, setKind] = useState('all');
  const loaded = posts.data?.posts || [];
  const polls = loaded.filter((post) => post.poll);
  const publications = kind === 'polls' ? polls : loaded;

  function updated(post) {
    posts.setData((current) => ({
      ...current,
      posts: (current?.posts || []).map((value) => (value.id === post.id ? post : value)),
    }));
  }

  function deleted(id) {
    posts.setData((current) => ({
      ...current,
      posts: (current?.posts || []).filter((value) => value.id !== id),
    }));
  }

  return (
    <section className="closet-profile-posts" aria-labelledby="profile-publications">
      <div className="closet-profile-posts-heading">
        <h2 id="profile-publications">Публикации</h2>
        <div className="closet-profile-post-tools">
          {publications.length > 0 && (
            <div className="closet-profile-views" role="group" aria-label="Вид публикаций">
              <AppButton className="btn btn-ghost" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
                <Icon name="image" size={18} /> Сетка
              </AppButton>
              <AppButton className="btn btn-ghost" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                <Icon name="menu" size={18} /> Список
              </AppButton>
            </div>
          )}
          <AppButton
            className="icon-button"
            aria-label="Обновить публикации"
            title="Обновить публикации"
            onClick={posts.reload}
            disabled={posts.loading}
          >
            <Icon name="refresh" />
          </AppButton>
        </div>
      </div>
      {polls.length > 0 && (
        <div className="closet-profile-kinds" role="group" aria-label="Какие публикации показать">
          <AppButton className="btn btn-ghost" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            <Icon name="outfits" size={18} /> Все образы
          </AppButton>
          <AppButton className="btn btn-ghost" aria-pressed={kind === 'polls'} onClick={() => setKind('polls')}>
            <span className="closet-profile-poll-mark" aria-hidden="true">А/Б</span> Опросы · {polls.length}
          </AppButton>
        </div>
      )}
      <SocialNotice error onRetry={posts.reload}>{posts.error}</SocialNotice>
      {posts.loading && <p className="social-loading" role="status">Загружаем образы…</p>}
      {!posts.loading && posts.data?.posts?.length === 0 && (
        <div className="closet-profile-empty social-empty-inline">
          <Icon name="outfits" size={30} />
          <p>{self ? 'Здесь появятся ваши опубликованные образы.' : 'Доступных публикаций пока нет.'}</p>
          {self && <Link href="/outfits" className="btn btn-primary">Открыть мои образы</Link>}
        </div>
      )}
      {publications.length > 0 && (
        view === 'grid' ? (
          <div className="closet-profile-grid">
            {publications.map((post) => (
              <ProfilePostPreview key={post.id + ':' + post.updatedAt} post={post} />
            ))}
          </div>
        ) : (
          <div className="social-post-list">
            {publications.map((post) => (
              <PostCard key={post.id} post={post} onUpdated={updated} onDeleted={deleted} />
            ))}
          </div>
        )
      )}
      {posts.data?.nextCursor && (
        <div className="social-load-more">
          <AppButton className="btn btn-secondary" onClick={posts.loadMore} disabled={posts.moreLoading}>
            {posts.moreLoading ? 'Загружаем…' : 'Ещё образы'}
          </AppButton>
        </div>
      )}
    </section>
  );
}

function ProfileView({ profile, onChanged }) {
  const social = useSocial();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const self = profile.relationship === 'self' || social.user?.id === profile.id;

  function saved(next) {
    setEditing(false);
    if (next.username !== profile.username) {
      router.replace(profilePath(next.username));
    } else {
      onChanged();
    }
  }

  return (
    <>
      <ProfileHeader
        profile={profile}
        pageHeading
        onChanged={onChanged}
        onEdit={self ? () => setEditing(true) : undefined}
      />
      {profile.canViewPosts === false ? (
        <div className="social-private-note social-surface">
          <Icon name="lock" size={30} />
          {profile.blockedByMe ? (
            <>
              <h2>Профиль заблокирован</h2>
              <p>Чтобы снова видеть доступные публикации, разблокируйте пользователя.</p>
            </>
          ) : (
            <>
              <h2>Образы доступны друзьям</h2>
              <p>После принятия заявки вы увидите образы, которыми автор делится с друзьями.</p>
            </>
          )}
        </div>
      ) : (
        <ProfilePosts
          key={profile.username + ':' + profile.relationship}
          username={profile.username}
          self={self}
        />
      )}
      {self && editing && (
        <Modal title="Редактировать профиль" onClose={() => setEditing(false)}>
          <ProfileEditor
            inDialog
            profile={profile}
            onCancel={() => setEditing(false)}
            onSaved={saved}
          />
        </Modal>
      )}
    </>
  );
}

export default function ProfilePage({ username }) {
  const social = useSocial();
  const result = useSocialCollection('profile.get', { username }, 'people', {
    enabled: social.ready && social.configured !== false,
  });
  const profile = result.data?.profile;

  return (
    <div className="closet-profile-page">
      <Link href="/community?tab=people" className="btn btn-ghost closet-profile-back">
        <Icon name="chevron-left" /> К участникам
      </Link>
      {!profile && <h1>Профиль</h1>}
      <SocialNotice error onRetry={social.refresh}>{social.error}</SocialNotice>
      {social.configured === false ? (
        <SocialAccessNote />
      ) : (
        <>
          <SocialNotice error onRetry={result.reload}>{result.error}</SocialNotice>
          {result.loading && <p className="social-loading" role="status">Открываем профиль…</p>}
          {profile && (
            <ProfileView
              key={profile.id + ':' + (social.user?.id || 'guest')}
              profile={profile}
              onChanged={result.reload}
            />
          )}
        </>
      )}
    </div>
  );
}
