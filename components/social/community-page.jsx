'use client';

import Link from 'next/link';
import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { EmptyState, Field, Icon, Loading } from '@/components/ui/ui.jsx';
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
  ['feed', 'Лента', 'outfits'],
  ['people', 'Люди', 'search'],
  ['friends', 'Друзья', 'users'],
  ['saved', 'Сохранённое', 'briefcase'],
  ['profile', 'Мой профиль', 'user'],
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
            community={scope !== 'profile'}
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

function FeedExplorer({ scope, onScopeChange }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const form = useRef(null);
  const search = useRef(null);
  const filterPanelId = useId();
  const applied = normalizeFeedFilters({
    query: params.get('q'),
    tag: params.get('tag'),
    occasion: params.get('occasion'),
    style: params.get('style'),
  });
  const appliedKey = JSON.stringify(applied);
  const [draft, setDraft] = useState(applied);
  const [showFilters, setShowFilters] = useState(false);
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

  const occasionLabel = Object.hasOwn(OCCASIONS, applied.occasion)
    ? OCCASIONS[applied.occasion]
    : applied.occasion;
  const styleLabel = Object.hasOwn(STYLE_OPTIONS, applied.style)
    ? STYLE_OPTIONS[applied.style]
    : applied.style;
  const activeFilters = [
    ['query', applied.query],
    ['tag', applied.tag && `#${applied.tag}`],
    ['occasion', occasionLabel],
    ['style', styleLabel],
  ].filter(([, label]) => label);
  const advancedCount = activeFilters.filter(([key]) => key !== 'query').length;
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  function reset() {
    setDraft(noFeedFilters);
    apply(noFeedFilters);
  }

  return (
    <>
      <form
        ref={form}
        className="community-feed-toolbar social-surface"
        role="search"
        aria-label="Поиск образов"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <div className="community-feed-toolbar-top">
          {onScopeChange ? (
            <div
              className="community-feed-switch social-segmented"
              role="group"
              aria-label="Выбрать ленту"
            >
              <AppButton
                className={`btn btn-ghost${scope === 'public' ? ' is-selected' : ''}`}
                aria-pressed={scope === 'public'}
                onClick={() => onScopeChange('public')}
              >
                Все образы
              </AppButton>
              <AppButton
                className={`btn btn-ghost${scope === 'friends' ? ' is-selected' : ''}`}
                aria-pressed={scope === 'friends'}
                onClick={() => onScopeChange('friends')}
              >
                От друзей
              </AppButton>
            </div>
          ) : (
            <h2>Сохранённые образы</h2>
          )}
          <AppButton
            className={`btn btn-ghost community-filter-toggle${showFilters ? ' is-selected' : ''}`}
            aria-expanded={showFilters}
            aria-controls={filterPanelId}
            onClick={() => setShowFilters((value) => !value)}
          >
            <Icon name="settings" size={16} />
            Фильтры{advancedCount > 0 ? ` · ${advancedCount}` : ''}
          </AppButton>
        </div>

        <div className="community-search-row">
          <label className="community-search-field">
            <Icon name="search" size={20} />
            <span className="community-visually-hidden">Поиск по названию, описанию и тегам</span>
            <input
              ref={search}
              type="search"
              name="feedQuery"
              maxLength={100}
              value={draft.query}
              onChange={(event) => update('query', event.target.value)}
              placeholder="Название, описание или тег"
            />
          </label>
          <AppButton type="submit" className="btn btn-primary">Найти</AppButton>
        </div>

        <div id={filterPanelId} hidden={!showFilters}>
          <div className="community-filter-grid">
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
                  <option value={key} key={key}>{label}</option>
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
                    <option value={key} key={key}>{label}</option>
                  ))}
              </select>
            </Field>
          </div>
          <AppButton type="submit" className="btn btn-secondary community-apply-filters">
            Применить фильтры
          </AppButton>
        </div>

        {activeFilters.length > 0 && (
          <div className="community-active-filters" role="group" aria-label="Применённые фильтры">
            {activeFilters.map(([key, label]) => (
              <AppButton
                key={key}
                className="community-filter-chip"
                aria-label={`Убрать фильтр «${label}»`}
                onClick={() => {
                  search.current?.focus();
                  apply({ ...applied, [key]: '' });
                }}
              >
                <span>{label}</span>
                <Icon name="close" size={14} />
              </AppButton>
            ))}
            <AppButton className="btn btn-ghost" onClick={reset}>Сбросить всё</AppButton>
          </div>
        )}
      </form>

      <PostsList
        scope={scope}
        filters={applied}
        onTagSelect={(tag) => {
          apply({ ...applied, tag });
          form.current?.scrollIntoView({ block: 'start' });
          search.current?.focus({ preventScroll: true });
        }}
        onReset={reset}
      />
    </>
  );
}

function DiscoverPeople() {
  return (
    <aside className="community-discover social-surface" aria-labelledby="community-discover-title">
      <span className="community-discover-icon" aria-hidden="true"><Icon name="users" /></span>
      <h2 id="community-discover-title">Найти людей</h2>
      <p>По имени или @нику.</p>
      <form action="/community" role="search" aria-label="Найти участников">
        <input type="hidden" name="tab" value="people" />
        <label className="community-search-field">
          <Icon name="search" size={18} />
          <span className="community-visually-hidden">Имя или ник участника</span>
          <input name="person" type="search" maxLength={80} placeholder="Имя или @ник" />
        </label>
        <AppButton type="submit" className="btn btn-secondary">
          Перейти к людям <Icon name="arrow" size={16} />
        </AppButton>
      </form>
    </aside>
  );
}

function PeoplePanel() {
  const social = useSocial();
  const params = useSearchParams();
  const router = useRouter();
  const query = (params.get('person') || '').trim().slice(0, 80);
  const [typed, setTyped] = useState(query);
  const people = useSocialCollection('people.search', { query }, 'people', {
    enabled: social.ready && social.configured !== false,
  });
  useEffect(() => setTyped(query), [query]);

  function submit(event) {
    event.preventDefault();
    const value = typed.trim();
    if (value === query) {
      people.reload();
      return;
    }
    const next = new URLSearchParams({ tab: 'people' });
    if (value) next.set('person', value);
    router.replace(`/community?${next}`, { scroll: false });
  }

  return (
    <section className="social-people-panel">
      <form
        className="community-people-search social-surface"
        role="search"
        aria-label="Поиск людей"
        onSubmit={submit}
      >
        <h2>Поиск людей</h2>
        <div className="community-search-row">
          <label className="community-search-field">
            <Icon name="search" size={20} />
            <span className="community-visually-hidden">Имя или ник участника</span>
            <input
              name="peopleSearch"
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              maxLength={80}
              placeholder="Имя или @ник"
            />
          </label>
          <AppButton type="submit" className="btn btn-primary">Найти</AppButton>
        </div>
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
          community
          onUpdated={(post) => result.setData({ post })}
          onDeleted={() => setDeleted(true)}
        />
      )}
    </>
  );
}

function CommunityHeader({ social, postId, canPublish }) {
  return (
    <header className={`community-hero${postId ? ' community-hero-detail' : ''}`}>
      <div className="community-hero-copy">
        <h1>{postId ? 'Образ сообщества' : 'Сообщество'}</h1>
        {!postId && <p>Находите образы и людей, чей стиль вам близок.</p>}
        <div className="community-hero-actions">
          {canPublish && (
            <Link href="/outfits" className="btn btn-primary">
              <Icon name="plus" size={18} />
              Опубликовать образ
            </Link>
          )}
          <div className="community-shortcuts">
            <Link
              href="/messages"
              aria-label={`Сообщения${social.counts?.messages > 0 ? `: ${social.counts.messages}` : ''}`}
            >
              <Icon name="message" size={18} />
              <span>Сообщения</span>
              {social.counts?.messages > 0 && <span className="social-count">{social.counts.messages}</span>}
            </Link>
            <Link
              href="/notifications"
              aria-label={`Уведомления${social.counts?.notifications > 0 ? `: ${social.counts.notifications}` : ''}`}
            >
              <Icon name="bell" size={18} />
              <span>Уведомления</span>
              {social.counts?.notifications > 0 && <span className="social-count">{social.counts.notifications}</span>}
            </Link>
          </div>
        </div>
      </div>
      {!postId && (
        <div className="community-hero-art" aria-hidden="true">
          <img src="/assets/style-editorial.webp" alt="" />
        </div>
      )}
    </header>
  );
}

function CommunityContent() {
  const params = useSearchParams();
  const router = useRouter();
  const social = useSocial();
  const scope = params.get('scope') === 'friends' ? 'friends' : 'public';
  const tab = tabs.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'feed';
  const postId = params.get('post');
  const cloudUnavailable = social.ready && social.configured === false;

  function setScope(value) {
    if (value === scope) return;
    const next = new URLSearchParams(params.toString());
    if (value === 'friends') next.set('scope', value);
    else next.delete('scope');
    const query = next.toString();
    router.replace(query ? `/community?${query}` : '/community', { scroll: false });
  }

  return (
    <div className="community-experience">
      <CommunityHeader
        social={social}
        postId={postId}
        canPublish={!postId && social.ready && !cloudUnavailable}
      />
      <SocialNotice error onRetry={social.refresh}>{social.error}</SocialNotice>
      {social.profile?.banned && (
        <SocialNotice error>
          Ваш аккаунт заблокирован администратором. Смотреть ленту и читать сообщения можно,
          а публиковать, комментировать, ставить лайки и писать — нельзя.
        </SocialNotice>
      )}
      {!social.ready ? (
        <p className="social-loading" role="status">Открываем сообщество…</p>
      ) : (
        <>
          {!postId && (
            <nav className="social-tabs community-nav" aria-label="Разделы сообщества">
              {tabs.map(([key, label, icon]) => (
                <Link
                  key={key}
                  href={key === 'feed' ? '/community' : `/community?tab=${key}`}
                  aria-current={tab === key ? 'page' : undefined}
                >
                  <Icon name={icon} size={17} />
                  <span>{label}</span>
                  {key === 'friends' && social.counts?.requests > 0 && (
                    <span className="social-count">{social.counts.requests}</span>
                  )}
                </Link>
              ))}
            </nav>
          )}
          {cloudUnavailable ? (
            <SocialAccessNote />
          ) : (
            <div
              key={`${social.user?.id || 'guest'}:${postId || tab}`}
              className="social-tab-content"
            >
              {postId ? (
                <PostDetail postId={postId} />
              ) : tab === 'feed' ? (
                <div className="community-feed-layout">
                  <div className="community-feed-main">
                    <FeedExplorer scope={scope} onScopeChange={setScope} />
                  </div>
                  <div className="community-feed-side">
                    <DiscoverPeople />
                    {scope === 'public' && !social.profile && <SocialAccessNote />}
                  </div>
                </div>
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
    </div>
  );
}

export default function CommunityPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CommunityContent />
    </Suspense>
  );
}
