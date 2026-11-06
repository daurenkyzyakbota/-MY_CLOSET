'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { EmptyState, Field, Icon, Loading, PageHeader } from '@/components/ui/ui.jsx';
import { OCCASIONS, STYLE_OPTIONS } from '@/lib/styling/stylist.js';
import PostCard from './post-card.jsx';
import ProfileEditor from './profile-editor.jsx';
import { ProfileHeader } from './profile-page.jsx';
import {
  PersonCard,
  SocialAccessNote,
  SocialNotice,
  useSocialCollection,
} from './social-common.jsx';

const tabs = [
  ['feed', 'Лента образов'],
  ['people', 'Люди'],
  ['friends', 'Друзья'],
  ['saved', 'Сохранённое'],
  ['profile', 'Мой профиль'],
];

const noFeedFilters = { query: '', tag: '', occasion: '', style: '' };
const normalized = (value) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('ru');
const normalizeFeedFilters = (value) => ({
  query: String(value.query || '')
    .trim()
    .slice(0, 100),
  tag: normalized(value.tag).replace(/^#+/, '').trim().slice(0, 40),
  occasion: normalized(value.occasion).slice(0, 100),
  style: normalized(value.style).slice(0, 100),
});
function postMatchesFilters(post, filters) {
  if (
    filters.query &&
    !normalized([post.title, post.description, ...(post.tags || [])].join(' ')).includes(
      normalized(filters.query),
    )
  )
    return false;
  if (
    filters.tag &&
    !(post.tags || []).some((tag) => normalized(tag).replace(/^#/, '') === filters.tag)
  )
    return false;
  if (filters.occasion && normalized(post.snapshot?.occasion) !== filters.occasion) return false;
  return !filters.style || normalized(post.snapshot?.style) === filters.style;
}

export function PostsList({
  scope = 'public',
  username,
  filters = noFeedFilters,
  onTagSelect,
  onReset,
}) {
  const social = useSocial();
  const privateSection = ['friends', 'saved'].includes(scope);
  const enabled =
    social.ready && social.configured !== false && (!privateSection || !!social.profile);
  const posts = useSocialCollection(
    'posts.list',
    {
      scope,
      ...(username ? { username } : {}),
      ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
    },
    'posts',
    { enabled },
  );
  if (privateSection && !social.profile) return <SocialAccessNote />;
  const narrowed = Object.values(filters).some(Boolean);
  const labels = {
    public: [
      'Первые образы ещё впереди',
      'Опубликуйте любимое сочетание из раздела «Мои образы». Ваш личный гардероб остаётся приватным.',
    ],
    friends: [
      'В ленте друзей пока тихо',
      'Найдите друзей в разделе «Люди» и посмотрите их доступные публикации.',
    ],
    saved: [
      'Соберите свою коллекцию вдохновения',
      'Нажмите «Сохранить» на понравившемся образе. Чужие вещи не добавляются в ваш гардероб.',
    ],
    profile: [
      'Публикаций пока нет',
      'Опубликованные образы появятся здесь согласно настройкам видимости.',
    ],
  };
  function updated(value) {
    posts.setData((current) => ({
      ...current,
      posts: (current?.posts || [])
        .map((post) => (post.id === value.id ? value : post))
        .filter(
          (post) =>
            (scope !== 'saved' || post.saved) &&
            (scope !== 'public' || post.visibility === 'public') &&
            postMatchesFilters(post, filters),
        ),
    }));
  }
  function deleted(id) {
    posts.setData((current) => ({
      ...current,
      posts: (current?.posts || []).filter((post) => post.id !== id),
    }));
  }
  return (
    <div className="social-feed-content">
      <div className="social-section-heading">
        <p className="footnote">
          {scope === 'friends'
            ? 'Образы людей, с которыми вы дружите'
            : scope === 'saved'
              ? 'Ваша личная коллекция публикаций'
              : scope === 'profile'
                ? 'Образы этого профиля'
                : 'Открытые образы участников сообщества'}
        </p>
        <AppButton
          className="btn btn-ghost"
          disabled={posts.loading || !enabled}
          onClick={posts.reload}
        >
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
      {posts.data?.posts?.length === 0 && !posts.loading && (
        <EmptyState
          icon={narrowed ? 'search' : 'outfits'}
          title={narrowed ? 'Образы с такими параметрами пока не нашлись' : labels[scope][0]}
          description={
            narrowed
              ? 'Попробуйте другой запрос или сбросьте фильтры. Закрытые и недоступные публикации в поиск не попадают.'
              : labels[scope][1]
          }
        >
          {narrowed && onReset && (
            <AppButton className="btn btn-primary" onClick={onReset}>
              Сбросить фильтры
            </AppButton>
          )}
          {!narrowed && scope === 'public' && (
            <Link className="btn btn-primary" href="/outfits">
              Мои образы
            </Link>
          )}
          {!narrowed && scope === 'friends' && (
            <Link className="btn btn-primary" href="/community?tab=people">
              Найти людей
            </Link>
          )}
        </EmptyState>
      )}
      <div className="social-post-list">
        {(posts.data?.posts || []).map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onUpdated={updated}
            onDeleted={deleted}
            onTagSelect={onTagSelect}
          />
        ))}
      </div>
      {posts.data?.nextCursor && (
        <div className="social-load-more">
          <AppButton
            className="btn btn-secondary"
            disabled={posts.moreLoading}
            onClick={posts.loadMore}
          >
            {posts.moreLoading ? 'Загружаем…' : 'Ещё образы'}
          </AppButton>
        </div>
      )}
    </div>
  );
}

function FeedExplorer({ scope }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const panel = useRef(null);
  const applied = normalizeFeedFilters({
    query: params.get('q'),
    tag: params.get('tag'),
    occasion: params.get('occasion'),
    style: params.get('style'),
  });
  const appliedKey = JSON.stringify(applied);
  const [draft, setDraft] = useState(applied);
  useEffect(() => {
    setDraft(JSON.parse(appliedKey));
  }, [appliedKey]);
  function apply(value) {
    const filters = normalizeFeedFilters(value);
    const next = new URLSearchParams(params.toString());
    for (const [field, key] of [
      ['query', 'q'],
      ['tag', 'tag'],
      ['occasion', 'occasion'],
      ['style', 'style'],
    ]) {
      if (filters[field]) next.set(key, filters[field]);
      else next.delete(key);
    }
    next.delete('post');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  const active = Object.values(applied).filter(Boolean).length;
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <>
      <form
        ref={panel}
        className="community-feed-filters social-surface"
        role="search"
        aria-label="Поиск образов в сообществе"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <div className="community-filter-heading">
          <div>
            <h2>Найдите своё вдохновение</h2>
            <p className="footnote">Поиск по названию, описанию и тегам доступных публикаций.</p>
          </div>
          {active > 0 && (
            <span className="tag" aria-live="polite">
              Фильтров: {active}
            </span>
          )}
        </div>
        <div className="community-filter-grid">
          <Field label="Поиск" className="community-query-field">
            <input
              type="search"
              name="feedQuery"
              maxLength={100}
              value={draft.query}
              onChange={(event) => update('query', event.target.value)}
              placeholder="Например, прогулка или базовый образ"
            />
          </Field>
          <Field label="Тег">
            <input
              name="feedTag"
              maxLength={40}
              value={draft.tag}
              onChange={(event) => update('tag', event.target.value)}
              placeholder="Например, минимализм"
            />
          </Field>
          <Field label="Повод">
            <select
              name="feedOccasion"
              value={draft.occasion}
              onChange={(event) => update('occasion', event.target.value)}
            >
              <option value="">Любой повод</option>
              {draft.occasion && !Object.hasOwn(OCCASIONS, draft.occasion) && (
                <option value={draft.occasion}>{draft.occasion}</option>
              )}
              {Object.entries(OCCASIONS).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Стиль">
            <select
              name="feedStyle"
              value={draft.style}
              onChange={(event) => update('style', event.target.value)}
            >
              <option value="">Любой стиль</option>
              {draft.style &&
                (draft.style === 'any' || !Object.hasOwn(STYLE_OPTIONS, draft.style)) && (
                  <option value={draft.style}>{draft.style}</option>
                )}
              {Object.entries(STYLE_OPTIONS)
                .filter(([key]) => key !== 'any')
                .map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <div className="community-filter-actions">
          <AppButton type="submit" className="btn btn-primary">
            <Icon name="search" />
            Найти образы
          </AppButton>
          <AppButton
            className="btn btn-secondary"
            disabled={!active && !Object.values(draft).some(Boolean)}
            onClick={() => {
              setDraft(noFeedFilters);
              apply(noFeedFilters);
            }}
          >
            Сбросить фильтры
          </AppButton>
          <span className="footnote">Сначала новые публикации</span>
        </div>
      </form>
      <PostsList
        scope={scope}
        filters={applied}
        onTagSelect={(tag) => {
          apply({ ...applied, tag });
          panel.current?.scrollIntoView({ block: 'start' });
          panel.current?.querySelector('input[name="feedTag"]')?.focus({ preventScroll: true });
        }}
        onReset={() => apply(noFeedFilters)}
      />
    </>
  );
}

function PeoplePanel() {
  const social = useSocial();
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const people = useSocialCollection('people.search', { query }, 'people', {
    enabled: social.ready && social.configured !== false,
  });
  function submit(event) {
    event.preventDefault();
    if (typed.trim() === query) people.reload();
    else setQuery(typed.trim());
  }
  return (
    <section className="social-people-panel">
      <form className="social-search-form social-surface" role="search" onSubmit={submit}>
        <Field label="Найти человека" hint="Введите имя или @ник.">
          <input
            name="peopleSearch"
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            maxLength={80}
            placeholder="Например, bota_style"
          />
        </Field>
        <AppButton type="submit" className="btn btn-primary">
          <Icon name="search" />
          Найти
        </AppButton>
      </form>
      <SocialNotice error onRetry={people.reload}>
        {people.error}
      </SocialNotice>
      {people.loading && (
        <p className="social-loading" role="status">
          Ищем участников…
        </p>
      )}
      {people.data?.people?.length === 0 && !people.loading && (
        <EmptyState
          icon="user"
          title={query ? 'Никого не нашли' : 'Знакомства начинаются здесь'}
          description={
            query
              ? 'Проверьте имя или ник и попробуйте снова.'
              : 'Пока нет доступных профилей. Пригласите друзей создать свой профиль.'
          }
        />
      )}
      <div className="social-person-grid">
        {(people.data?.people || []).map((person) => (
          <PersonCard key={person.id} person={person} onChanged={people.reload} />
        ))}
      </div>
      {people.data?.nextCursor && (
        <div className="social-load-more">
          <AppButton
            className="btn btn-secondary"
            onClick={people.loadMore}
            disabled={people.moreLoading}
          >
            {people.moreLoading ? 'Загружаем…' : 'Ещё участники'}
          </AppButton>
        </div>
      )}
    </section>
  );
}

function FriendsPanel() {
  const social = useSocial();
  const friends = useSocialCollection('friends.list', {}, 'friends', {
    enabled: social.ready && !!social.profile && social.configured !== false,
  });
  const [section, setSection] = useState('friends');
  const previousRequests = useRef(social.counts.requests);
  useEffect(() => {
    if (previousRequests.current !== social.counts.requests) {
      previousRequests.current = social.counts.requests;
      friends.reload();
    }
  }, [social.counts.requests, friends.reload]);
  if (!social.profile) return <SocialAccessNote />;
  const options = [
    ['friends', 'Мои друзья'],
    ['incoming', 'Входящие заявки'],
    ['outgoing', 'Отправленные заявки'],
    ['blocked', 'Заблокированные'],
  ];
  const list = friends.data?.[section] || [];
  return (
    <section>
      <div className="social-section-heading">
        <div className="social-segmented" aria-label="Списки друзей">
          {options.map(([key, label]) => (
            <AppButton
              key={key}
              className={`btn btn-ghost${section === key ? ' is-selected' : ''}`}
              aria-pressed={section === key}
              onClick={() => setSection(key)}
            >
              {label}
              <span className="social-count">{friends.data?.[key]?.length || 0}</span>
            </AppButton>
          ))}
        </div>
        <AppButton className="btn btn-ghost" onClick={friends.reload} disabled={friends.loading}>
          <Icon name="refresh" />
          Обновить
        </AppButton>
      </div>
      <SocialNotice error onRetry={friends.reload}>
        {friends.error}
      </SocialNotice>
      {friends.loading && (
        <p className="social-loading" role="status">
          Загружаем список…
        </p>
      )}
      {!friends.loading && friends.data && list.length === 0 && (
        <EmptyState
          icon="user"
          title={
            section === 'friends'
              ? 'Добавьте тех, кто вас вдохновляет'
              : section === 'blocked'
                ? 'Заблокированных пользователей нет'
                : 'Заявок пока нет'
          }
          description={
            section === 'friends'
              ? 'Найдите знакомых по имени или нику. После принятия заявки вы сможете видеть образы для друзей.'
              : section === 'blocked'
                ? 'При блокировке человек не сможет писать вам или отправлять заявки.'
                : 'Новые заявки и изменения появятся после обновления списка.'
          }
        >
          {section === 'friends' && (
            <Link href="/community?tab=people" className="btn btn-primary">
              Найти людей
            </Link>
          )}
        </EmptyState>
      )}
      <div className="social-person-grid">
        {list.map((person) => (
          <PersonCard key={person.id} person={person} onChanged={friends.reload} />
        ))}
      </div>
    </section>
  );
}

function OwnProfile() {
  const social = useSocial();
  const [editing, setEditing] = useState(false);
  if (social.error && !social.profile)
    return (
      <SocialNotice error onRetry={social.refresh}>
        {social.error}
      </SocialNotice>
    );
  if (!social.user || social.requiresHttps || social.configured === false)
    return <SocialAccessNote requireProfile={false} />;
  if (!social.profile || editing)
    return (
      <ProfileEditor
        key={social.profile?.id || social.user.id}
        profile={social.profile}
        onSaved={() => setEditing(false)}
        onCancel={social.profile ? () => setEditing(false) : undefined}
      />
    );
  return (
    <>
      <ProfileHeader profile={social.profile} onEdit={() => setEditing(true)} />
      <PostsList key={social.profile.username} scope="profile" username={social.profile.username} />
    </>
  );
}

function PostDetail({ postId }) {
  const social = useSocial();
  const result = useSocialCollection('posts.get', { postId }, 'posts', {
    enabled: social.ready && social.configured !== false,
  });
  const [deleted, setDeleted] = useState(false);
  if (deleted)
    return (
      <EmptyState
        icon="outfits"
        title="Публикация удалена"
        description="Личный образ остаётся в гардеробе автора."
      >
        <Link href="/community" className="btn btn-primary">
          В сообщество
        </Link>
      </EmptyState>
    );
  return (
    <>
      <div className="social-section-heading">
        <Link href="/community" className="btn btn-secondary">
          <Icon name="chevron-left" />К ленте
        </Link>
      </div>
      <SocialNotice error onRetry={result.reload}>
        {result.error}
      </SocialNotice>
      {result.loading && (
        <p className="social-loading" role="status">
          Открываем образ…
        </p>
      )}
      {result.data?.post && (
        <PostCard
          post={result.data.post}
          expanded
          onUpdated={(post) => result.setData({ post })}
          onDeleted={() => setDeleted(true)}
        />
      )}
    </>
  );
}

function CommunityContent() {
  const params = useSearchParams();
  const router = useRouter();
  const social = useSocial();
  const scope = params.get('scope') === 'friends' ? 'friends' : 'public';
  function setScope(value) {
    const next = new URLSearchParams(params.toString());
    if (value === 'friends') next.set('scope', value);
    else next.delete('scope');
    const query = next.toString();
    router.replace(query ? `/community?${query}` : '/community', { scroll: false });
  }
  const tab = tabs.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'feed';
  const postId = params.get('post');
  return (
    <>
      <PageHeader
        eyebrow="СТИЛЬ ОБЪЕДИНЯЕТ"
        title={postId ? 'Образ сообщества' : 'Сообщество MyCloset'}
        description={
          postId
            ? 'Идеи, детали и обсуждение образа.'
            : 'Знакомьтесь, делитесь сочетаниями и находите вдохновение.'
        }
      >
        <Link href="/messages" className="btn btn-secondary">
          Сообщения{social.counts?.messages > 0 ? ` · ${social.counts.messages}` : ''}
        </Link>
        <Link href="/notifications" className="btn btn-secondary">
          Уведомления{social.counts?.notifications > 0 ? ` · ${social.counts.notifications}` : ''}
        </Link>
      </PageHeader>
      <SocialNotice error onRetry={social.refresh}>
        {social.error}
      </SocialNotice>
      {!social.ready ? (
        <p className="social-loading" role="status">
          Открываем сообщество…
        </p>
      ) : (
        <>
          {!postId && (
            <nav className="social-tabs" aria-label="Разделы сообщества">
              {tabs.map(([key, label]) => (
                <Link
                  key={key}
                  href={`/community?tab=${key}`}
                  aria-current={tab === key ? 'page' : undefined}
                >
                  {label}
                  {key === 'friends' && social.counts?.requests > 0 ? (
                    <span className="social-count">{social.counts.requests}</span>
                  ) : null}
                </Link>
              ))}
            </nav>
          )}
          {social.configured === false ? (
            <SocialAccessNote />
          ) : (
            <div
              key={`${social.user?.id || 'guest'}:${postId || tab}`}
              className="social-tab-content"
            >
              {postId ? (
                <PostDetail postId={postId} />
              ) : tab === 'feed' ? (
                <>
                  <div className="social-feed-intro social-surface">
                    <div>
                      <h2>У каждого свой стиль</h2>
                      <p>
                        Опубликуйте выбранный образ из своего гардероба. Остальные вещи останутся
                        личными.
                      </p>
                    </div>
                    <Link href="/outfits" className="btn btn-primary">
                      <Icon name="plus" />
                      Поделиться образом
                    </Link>
                  </div>
                  <div className="social-segmented social-feed-filter">
                    <AppButton
                      className={`btn btn-ghost${scope === 'public' ? ' is-selected' : ''}`}
                      aria-pressed={scope === 'public'}
                      onClick={() => setScope('public')}
                    >
                      Все участники
                    </AppButton>
                    <AppButton
                      className={`btn btn-ghost${scope === 'friends' ? ' is-selected' : ''}`}
                      aria-pressed={scope === 'friends'}
                      onClick={() => setScope('friends')}
                    >
                      Мои друзья
                    </AppButton>
                  </div>
                  {!social.profile && <SocialAccessNote />}
                  <FeedExplorer key={scope} scope={scope} />
                </>
              ) : tab === 'people' ? (
                <PeoplePanel />
              ) : tab === 'friends' ? (
                <FriendsPanel />
              ) : tab === 'saved' ? (
                <FeedExplorer scope="saved" />
              ) : (
                <OwnProfile />
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function CommunityPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CommunityContent />
    </Suspense>
  );
}
