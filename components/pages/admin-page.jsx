'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { SocialGate } from '@/components/social/social-gate.jsx';
import { SocialNotice, socialDate } from '@/components/social/social-common.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { ConfirmDialog, EmptyState, Icon, Loading, PageHeader } from '@/components/ui/ui.jsx';

const STAT_CARDS = [
  ['users', 'Пользователей', 'users'],
  ['openReports', 'Открытых жалоб', 'warning'],
  ['posts', 'Публикаций', 'outfits'],
  ['banned', 'Заблокировано', 'lock'],
];

function personLink(person) {
  return person?.username ? (
    <Link href={`/people/${encodeURIComponent(person.username)}`}>@{person.username}</Link>
  ) : (
    <span className="admin-muted">удалён</span>
  );
}

function useAdminList(action, input, field) {
  const { request } = useSocial();
  const requestRef = useRef(request);
  requestRef.current = request;
  const key = JSON.stringify(input);
  const [state, setState] = useState({ items: [], ready: false, error: '' });
  const load = useCallback(
    async (signal) => {
      try {
        const result = await requestRef.current(action, JSON.parse(key), { signal });
        if (!signal?.aborted) setState({ items: result[field], ready: true, error: '' });
      } catch (cause) {
        if (cause.name !== 'AbortError' && !signal?.aborted)
          setState((value) => ({ ...value, ready: true, error: cause.message }));
      }
    },
    [action, key, field],
  );
  useEffect(() => {
    const controller = new AbortController();
    setState((value) => ({ ...value, ready: false }));
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return { ...state, reload: () => load() };
}

function Stats({ stats }) {
  return (
    <div className="stats-grid bootstrap-layout admin-stats">
      <div className="row bootstrap-stats-row">
        {STAT_CARDS.map(([key, label, icon]) => (
          <div className="col-6 col-sm-3 bootstrap-grid-col d-flex" key={key}>
            <div className="stat-card">
              <span className="stat-icon">
                <Icon name={icon} />
              </span>
              <strong>{stats ? stats[key] : '…'}</strong>
              <span>{label}</span>
            </div>
          </div>
        ))}
      </div>
      {stats && (
        <p className="footnote">
          За неделю новых профилей: {stats.newUsers}. Комментариев всего: {stats.comments}.
          Администраторов: {stats.admins}.
        </p>
      )}
    </div>
  );
}

function ReportsTab({ onChanged, compact = false }) {
  const { request } = useSocial();
  const [status, setStatus] = useState('open');
  const list = useAdminList('admin.reports.list', { status }, 'reports');
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState('');

  async function resolve(report, decision) {
    await request('admin.reports.resolve', { reportId: report.id, decision });
    setNotice(
      decision === 'dismiss'
        ? 'Жалоба отклонена.'
        : report.targetType === 'post'
          ? 'Публикация удалена.'
          : 'Пользователь заблокирован.',
    );
    await Promise.all([list.reload(), onChanged()]);
  }

  const reports = compact ? list.items.slice(0, 3) : list.items;
  return (
    <section aria-label="Жалобы">
      {!compact && (
      <div className="life-tabs" role="group" aria-label="Статус жалоб">
        {[
          ['open', 'Новые'],
          ['reviewed', 'Рассмотренные'],
        ].map(([value, label]) => (
          <AppButton
            key={value}
            className={`wardrobe-chip${status === value ? ' is-active' : ''}`}
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setNotice('');
            }}
          >
            {label}
          </AppButton>
        ))}
      </div>
      )}
      <SocialNotice>{notice}</SocialNotice>
      <SocialNotice error onRetry={list.reload}>
        {list.error}
      </SocialNotice>
      {!list.ready ? (
        <Loading />
      ) : list.items.length === 0 ? (
        <EmptyState
          icon="check"
          title={status === 'open' ? 'Новых жалоб нет' : 'Рассмотренных жалоб пока нет'}
          description={
            status === 'open'
              ? 'Когда кто-то пожалуется на публикацию или профиль, жалоба появится здесь.'
              : 'Здесь будет история ваших решений.'
          }
        />
      ) : (
        <ul className="admin-list">
          {reports.map((report) => (
            <li className="admin-card" key={report.id}>
              <div className="admin-card-head">
                <span className="tag">
                  {report.targetType === 'post' ? 'Публикация' : 'Профиль'}
                </span>
                {report.sameTargetCount > 1 && (
                  <span className="tag admin-tag-warn">
                    Жалоб на это: {report.sameTargetCount}
                  </span>
                )}
                <span className="admin-muted">{socialDate(report.createdAt)}</span>
              </div>
              {report.targetType === 'post' ? (
                report.target.postTitle ? (
                  <div className="admin-target">
                    <strong>«{report.target.postTitle}»</strong>
                    {report.target.postDescription && <p>{report.target.postDescription}</p>}
                    <span className="admin-muted">Автор: {personLink(report.target)}</span>
                  </div>
                ) : (
                  <p className="admin-muted">Публикация уже удалена.</p>
                )
              ) : (
                <div className="admin-target">
                  <strong>{report.target.name || 'Профиль удалён'}</strong>{' '}
                  {report.target.exists && personLink(report.target)}
                  {report.target.banned && <span className="tag">заблокирован</span>}
                </div>
              )}
              <p className="admin-reason">
                <span className="admin-muted">Причина от {personLink(report.reporter)}:</span>{' '}
                {report.reason}
              </p>
              {report.status === 'open' ? (
                <div className="admin-actions">
                  <AppButton
                    className="btn btn-secondary"
                    onClick={() => setConfirm({ report, decision: 'dismiss' })}
                  >
                    <Icon name="close" />
                    Отклонить жалобу
                  </AppButton>
                  {report.target.exists && report.target.role !== 'admin' && (
                    <AppButton
                      className="btn btn-danger"
                      onClick={() => setConfirm({ report, decision: 'remove' })}
                    >
                      <Icon name={report.targetType === 'post' ? 'trash' : 'lock'} />
                      {report.targetType === 'post' ? 'Удалить публикацию' : 'Заблокировать'}
                    </AppButton>
                  )}
                </div>
              ) : (
                <p className="admin-muted">
                  Решение: {report.decision === 'remove' ? 'приняты меры' : 'отклонена'}
                  {report.resolvedAt ? `, ${socialDate(report.resolvedAt)}` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm.decision === 'dismiss'
              ? 'Отклонить жалобу?'
              : confirm.report.targetType === 'post'
                ? 'Удалить публикацию?'
                : 'Заблокировать пользователя?'
          }
          description={
            confirm.decision === 'dismiss'
              ? 'Нарушения нет: жалоба и другие жалобы на то же самое переместятся в рассмотренные.'
              : confirm.report.targetType === 'post'
                ? 'Публикация будет удалена вместе с лайками и комментариями. Отменить это нельзя.'
                : 'Пользователь не сможет публиковать, комментировать и писать сообщения, а его образы пропадут из ленты. Разблокировать можно на вкладке «Пользователи».'
          }
          onConfirm={() => resolve(confirm.report, confirm.decision)}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}

function UsersTab({ onChanged }) {
  const { request } = useSocial();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const list = useAdminList('admin.users.list', { query, filter }, 'users');
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState('');

  async function apply({ user, kind }) {
    if (kind === 'ban' || kind === 'unban') {
      await request('admin.users.ban', { userId: user.id, banned: kind === 'ban' });
      setNotice(kind === 'ban' ? `@${user.username} заблокирован.` : `@${user.username} разблокирован.`);
    } else {
      await request('admin.users.setRole', {
        userId: user.id,
        role: kind === 'promote' ? 'admin' : 'user',
      });
      setNotice(
        kind === 'promote'
          ? `@${user.username} теперь администратор.`
          : `@${user.username} теперь обычный пользователь.`,
      );
    }
    await Promise.all([list.reload(), onChanged()]);
  }

  const dialogs = {
    promote: ['Сделать администратором?', 'Он получит доступ к этой панели: сможет удалять публикации, блокировать людей и назначать роли.'],
    demote: ['Снять роль администратора?', 'Он станет обычным пользователем и потеряет доступ к этой панели.'],
    ban: ['Заблокировать пользователя?', 'Он не сможет публиковать, комментировать и писать сообщения, а его образы пропадут из ленты.'],
    unban: ['Разблокировать пользователя?', 'Он снова сможет публиковать и общаться.'],
  };

  return (
    <section aria-label="Пользователи">
      <form
        className="community-search-row admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
          setNotice('');
        }}
      >
        <label className="community-search-field">
          <Icon name="search" size={20} />
          <span className="community-visually-hidden">Поиск по нику или имени</span>
          <input
            type="search"
            name="adminUserQuery"
            maxLength={80}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ник или имя"
          />
        </label>
        <AppButton type="submit" className="btn btn-primary">
          Найти
        </AppButton>
      </form>
      <div className="life-tabs" role="group" aria-label="Фильтр пользователей">
        {[
          ['all', 'Все'],
          ['reported', 'С жалобами'],
          ['banned', 'Заблокированные'],
          ['admins', 'Администраторы'],
        ].map(([value, label]) => (
          <AppButton
            key={value}
            className={`wardrobe-chip${filter === value ? ' is-active' : ''}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </AppButton>
        ))}
      </div>
      <SocialNotice>{notice}</SocialNotice>
      <SocialNotice error onRetry={list.reload}>
        {list.error}
      </SocialNotice>
      {!list.ready ? (
        <Loading />
      ) : list.items.length === 0 ? (
        <EmptyState icon="users" title="Никого не нашли" description="Попробуйте другой ник или фильтр." />
      ) : (
        <ul className="admin-list">
          {list.items.map((user) => (
            <li className="admin-card admin-user" key={user.id}>
              <div className="admin-user-main">
                <strong>{user.name}</strong> {personLink(user)}
                <div className="admin-card-head">
                  <span className={`tag${user.role === 'admin' ? ' admin-tag-role' : ''}`}>
                    {user.role === 'admin' ? 'Админ' : 'Пользователь'}
                  </span>
                  {user.banned && <span className="tag admin-tag-warn">Заблокирован</span>}
                  {user.self && <span className="tag">Это вы</span>}
                </div>
                <span className="admin-muted">
                  С {socialDate(user.createdAt)} · публикаций: {user.posts} · жалоб: {user.reports}
                </span>
              </div>
              {!user.self && (
                <div className="admin-actions">
                  {user.role === 'admin' ? (
                    <AppButton
                      className="btn btn-secondary"
                      onClick={() => setConfirm({ user, kind: 'demote' })}
                    >
                      Снять админа
                    </AppButton>
                  ) : (
                    <>
                      {!user.banned && (
                        <AppButton
                          className="btn btn-secondary"
                          onClick={() => setConfirm({ user, kind: 'promote' })}
                        >
                          Сделать админом
                        </AppButton>
                      )}
                      <AppButton
                        className={`btn ${user.banned ? 'btn-secondary' : 'btn-danger'}`}
                        onClick={() => setConfirm({ user, kind: user.banned ? 'unban' : 'ban' })}
                      >
                        <Icon name="lock" />
                        {user.banned ? 'Разблокировать' : 'Заблокировать'}
                      </AppButton>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <ConfirmDialog
          title={dialogs[confirm.kind][0]}
          description={`@${confirm.user.username}. ${dialogs[confirm.kind][1]}`}
          onConfirm={() => apply(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}

function AdminContent({ section }) {
  const { profile, request } = useSocial();
  const requestRef = useRef(request);
  requestRef.current = request;
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const loadStats = useCallback(async (signal) => {
    try {
      const result = await requestRef.current('admin.overview', {}, { signal });
      if (!signal?.aborted) {
        setStats(result.stats);
        setError('');
      }
    } catch (cause) {
      if (cause.name !== 'AbortError' && !signal?.aborted) setError(cause.message);
    }
  }, []);
  useEffect(() => {
    if (!profile?.isAdmin) return;
    const controller = new AbortController();
    void loadStats(controller.signal);
    return () => controller.abort();
  }, [profile?.isAdmin, loadStats]);

  if (!profile?.isAdmin)
    return (
      <EmptyState
        icon="lock"
        title="Только для администраторов"
        description="У вашего аккаунта роль «пользователь». Если вы должны быть администратором, попросите другого админа выдать вам роль."
      >
        <Link className="btn btn-primary" href="/community">
          В сообщество
        </Link>
      </EmptyState>
    );

  return (
    <>
      <SocialNotice error onRetry={() => loadStats()}>
        {error}
      </SocialNotice>
      {section === 'reports' ? (
        <ReportsTab onChanged={() => loadStats()} />
      ) : section === 'users' ? (
        <UsersTab onChanged={() => loadStats()} />
      ) : (
        <>
          <Stats stats={stats} />
          <div className="admin-overview">
            <section className="admin-overview-main">
              <div className="admin-section-head">
                <h2>Требуют внимания</h2>
                <Link href="/admin/reports">Все жалобы →</Link>
              </div>
              <ReportsTab compact onChanged={() => loadStats()} />
            </section>
            <NewUsers />
          </div>
        </>
      )}
    </>
  );
}

function NewUsers() {
  const list = useAdminList('admin.users.list', { filter: 'new' }, 'users');
  return (
    <section className="admin-card admin-new-users" aria-label="Новые пользователи">
      <div className="admin-section-head">
        <h2>Новые пользователи</h2>
        <Link href="/admin/users">Все →</Link>
      </div>
      {!list.ready ? (
        <Loading />
      ) : list.items.length === 0 ? (
        <p className="admin-muted">Пока никого.</p>
      ) : (
        <ul>
          {list.items.slice(0, 6).map((user) => (
            <li key={user.id}>
              <span className="admin-avatar" aria-hidden="true">
                {(user.name || user.username || '?').slice(0, 1).toUpperCase()}
              </span>
              <span>
                {personLink(user)}
                <small className="admin-muted">
                  публикаций: {user.posts}
                  {user.reports > 0 ? ` · жалоб: ${user.reports}` : ''}
                </small>
              </span>
              <small className="admin-muted">{socialDate(user.createdAt)}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SECTIONS = {
  overview: ['Главное', 'Что происходит в сообществе сегодня.'],
  reports: ['Жалобы', 'Разберите жалобы на публикации и профили.'],
  users: ['Пользователи', 'Поиск, роли и блокировки.'],
};

export default function AdminPage({ section = 'overview' }) {
  const { user } = useSocial();
  const [title, description] = SECTIONS[section] || SECTIONS.overview;
  return (
    <div className="admin-page">
      <PageHeader eyebrow="АДМИН-ПАНЕЛЬ" title={title} description={description} />
      <SocialGate>
        <AdminContent key={user?.id || 'guest'} section={section} />
      </SocialGate>
    </div>
  );
}
