'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { ConfirmDialog, Field, Icon, ItemArt, Modal } from '@/components/ui/ui.jsx';
import {
  ProfileAvatar,
  ReportDialog,
  ShareDialog,
  SocialNotice,
  socialDate,
  useSocialCollection,
} from './social-common.jsx';
import InspirationDialog from './inspiration-dialog.jsx';

const visibilityLabels = { private: 'Только мне', friends: 'Для друзей', public: 'Для всех' };

function PublishedItem({ item }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.photo]);
  return (
    <div className="social-published-item">
      <div className="social-item-art">
        {item.photo && !failed ? (
          <img src={item.photo} alt={item.name} loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <ItemArt item={{ ...item, photo: '' }} />
        )}
      </div>
      <span>{item.name}</span>
    </div>
  );
}

function PostEditor({ post, onClose, onSaved }) {
  const { request } = useSocial();
  const [draft, setDraft] = useState({
    title: post.title,
    description: post.description || '',
    visibility: post.visibility,
    tags: (post.tags || []).join(', '),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const tags = [
        ...new Set(
          draft.tags
            .split(/[,#\n]+/)
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      const result = await request('posts.save', {
        postId: post.id,
        title: draft.title.trim(),
        description: draft.description.trim(),
        visibility: draft.visibility,
        tags,
      });
      onSaved(result.post);
      onClose();
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Изменить публикацию"
      description="Изменения видимости применяются и к сохранённым ссылкам на этот образ."
      onClose={busy ? () => {} : onClose}
    >
      <form id="social-post-edit-form" onSubmit={submit}>
        <fieldset className="form-fieldset" disabled={busy}>
          <Field label="Название *">
            <input
              name="title"
              required
              maxLength={100}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              autoFocus
            />
          </Field>
          <Field label="Описание">
            <textarea
              name="description"
              maxLength={2000}
              rows={4}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>
          <Field label="Теги" hint="До 10 тегов через запятую, каждый до 30 символов.">
            <input
              name="tags"
              maxLength={350}
              value={draft.tags}
              onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
            />
          </Field>
          <Field label="Кто увидит образ">
            <select
              name="visibility"
              value={draft.visibility}
              onChange={(event) => setDraft({ ...draft, visibility: event.target.value })}
            >
              {Object.entries(visibilityLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
        <SocialNotice error>{error}</SocialNotice>
        <div className="form-actions">
          <AppButton className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Отмена
          </AppButton>
          <AppButton type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить публикацию'}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}

function Comments({ post, onCountChange }) {
  const social = useSocial();
  const comments = useSocialCollection('comments.list', { postId: post.id }, 'comments');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canWrite = !!social.user && !!social.profile;
  async function save(event) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await social.request('comments.save', { postId: post.id, text: text.trim() });
      setText('');
      comments.setData((current) => ({
        ...current,
        comments: [result.comment, ...(current?.comments || [])],
      }));
      onCountChange(1);
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  async function edit(event) {
    event.preventDefault();
    if (busy || !editing?.text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await social.request('comments.save', {
        postId: post.id,
        commentId: editing.id,
        text: editing.text.trim(),
      });
      comments.setData((current) => ({
        ...current,
        comments: (current?.comments || []).map((value) =>
          value.id === result.comment.id ? result.comment : value,
        ),
      }));
      setEditing(null);
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    await social.request('comments.delete', { commentId: deleting.id });
    comments.setData((current) => ({
      ...current,
      comments: (current?.comments || []).filter((value) => value.id !== deleting.id),
    }));
    onCountChange(-1);
  }
  return (
    <section className="social-comments" aria-label={`Комментарии к образу «${post.title}»`}>
      <h3>Комментарии</h3>
      <SocialNotice error onRetry={comments.reload}>
        {comments.error || error}
      </SocialNotice>
      {comments.loading && (
        <p className="footnote" role="status">
          Загружаем комментарии…
        </p>
      )}
      {!comments.loading && comments.data?.comments?.length === 0 && (
        <p className="footnote">Здесь можно первым обсудить этот образ.</p>
      )}
      <div className="social-comment-list">
        {(comments.data?.comments || []).map((comment) => (
          <article className="social-comment" key={comment.id}>
            <Link
              href={`/people/${encodeURIComponent(comment.author.username)}`}
              className="social-comment-author"
            >
              <ProfileAvatar profile={comment.author} />
              <span>
                <strong>{comment.author.name}</strong>
                <span className="social-handle">@{comment.author.username}</span>
              </span>
            </Link>
            <p>{comment.text}</p>
            <div className="social-comment-footer">
              <time dateTime={comment.createdAt}>{socialDate(comment.createdAt)}</time>
              <div>
                {comment.owned && (
                  <AppButton
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => {
                      setEditing({ ...comment });
                      setError('');
                    }}
                  >
                    Изменить
                  </AppButton>
                )}
                {comment.canDelete && (
                  <AppButton
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => setDeleting(comment)}
                  >
                    Удалить
                  </AppButton>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {comments.data?.nextCursor && (
        <AppButton
          className="btn btn-secondary"
          disabled={comments.moreLoading}
          onClick={comments.loadMore}
        >
          {comments.moreLoading ? 'Загружаем…' : 'Ещё комментарии'}
        </AppButton>
      )}
      {canWrite ? (
        <form className="social-comment-form" onSubmit={save}>
          <Field label="Ваш комментарий">
            <textarea
              name="comment"
              required
              maxLength={1000}
              rows={2}
              placeholder="Что вам понравилось в этом сочетании?"
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
            />
          </Field>
          <AppButton className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>
            {busy ? 'Отправляем…' : 'Отправить комментарий'}
          </AppButton>
        </form>
      ) : (
        <p className="footnote">
          <Link href={social.user ? '/community?tab=profile' : '/account'}>
            {social.user ? 'Создайте профиль' : 'Войдите'}
          </Link>
          , чтобы оставить комментарий.
        </p>
      )}
      {editing && (
        <Modal title="Изменить комментарий" onClose={busy ? () => {} : () => setEditing(null)}>
          <form onSubmit={edit}>
            <Field label="Комментарий">
              <textarea
                name="text"
                rows={4}
                required
                maxLength={1000}
                value={editing.text}
                onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                disabled={busy}
                autoFocus
              />
            </Field>
            <SocialNotice error>{error}</SocialNotice>
            <div className="form-actions">
              <AppButton
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Отмена
              </AppButton>
              <AppButton
                type="submit"
                className="btn btn-primary"
                disabled={busy || !editing.text.trim()}
              >
                Сохранить комментарий
              </AppButton>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Удалить комментарий?"
          description="Комментарий исчезнет из обсуждения."
          onClose={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </section>
  );
}

export default function PostCard({
  post: initialPost,
  onUpdated,
  onDeleted,
  expanded = false,
  onTagSelect,
}) {
  const social = useSocial();
  const [post, setPost] = useState(initialPost);
  const [comments, setComments] = useState(expanded);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [report, setReport] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [inspiration, setInspiration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setPost(initialPost), [initialPost]);
  const active = !!social.user && !!social.profile;
  const owned = post.owned || social.user?.id === post.author?.id;
  function updated(value) {
    setPost(value);
    onUpdated?.(value);
  }
  async function toggle(action, input) {
    if (busy || !active) return;
    setBusy(true);
    setError('');
    try {
      const result = await social.request(action, { postId: post.id, ...input });
      updated(result.post);
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    await social.request('posts.delete', { postId: post.id });
    onDeleted?.(post.id);
  }
  const items = post.snapshot?.items || [];
  return (
    <article className="social-post-card social-surface" data-post-id={post.id}>
      <header className="social-post-header">
        <Link
          className="social-person-identity"
          href={`/people/${encodeURIComponent(post.author.username)}`}
        >
          <ProfileAvatar profile={post.author} />
          <span>
            <strong>{post.author.name}</strong>
            <span className="social-handle">@{post.author.username}</span>
          </span>
        </Link>
        <span className="social-post-visibility">
          {visibilityLabels[post.visibility] || 'Образ'}
        </span>
      </header>
      <div className="social-post-title">
        <h2>
          <Link href={`/community?post=${encodeURIComponent(post.id)}`}>{post.title}</Link>
        </h2>
        <time dateTime={post.createdAt}>{socialDate(post.createdAt)}</time>
      </div>
      {post.description && <p className="social-post-description">{post.description}</p>}
      {items.length > 0 && (
        <div className="social-published-items" aria-label="Состав опубликованного образа">
          {items.map((item) => (
            <PublishedItem item={item} key={item.id} />
          ))}
        </div>
      )}
      {!!post.tags?.length && (
        <div className="social-post-tags">
          {post.tags.map((tag) =>
            onTagSelect ? (
              <AppButton
                key={tag}
                className="social-tag-button"
                onClick={() => onTagSelect(tag)}
                aria-label={`Показать образы с тегом ${tag}`}
              >
                #{tag}
              </AppButton>
            ) : (
              <Link
                key={tag}
                href={`/community?tab=feed&tag=${encodeURIComponent(tag)}`}
                className="social-tag-link"
                aria-label={`Показать образы с тегом ${tag}`}
              >
                #{tag}
              </Link>
            ),
          )}
        </div>
      )}
      <div className="social-post-actions">
        <AppButton className="btn btn-ghost inspiration-start" onClick={() => setInspiration(true)}>
          <Icon name="outfits" />
          Собрать из моих вещей
        </AppButton>
        {active ? (
          <AppButton
            className={`btn btn-ghost${post.liked ? ' is-selected' : ''}`}
            disabled={busy}
            aria-pressed={!!post.liked}
            aria-label={`${post.liked ? 'Убрать лайк' : 'Поставить лайк'}: ${post.title}`}
            onClick={() => toggle('posts.like', { liked: !post.liked })}
          >
            <Icon name="heart" />
            {post.likesCount || 0}
          </AppButton>
        ) : (
          <Link
            className="btn btn-ghost"
            href={social.user ? '/community?tab=profile' : '/account'}
            aria-label="Войти, чтобы поставить лайк"
          >
            <Icon name="heart" />
            {post.likesCount || 0}
          </Link>
        )}
        <AppButton
          className="btn btn-ghost"
          aria-expanded={comments}
          onClick={() => setComments((value) => !value)}
        >
          Комментарии · {post.commentsCount || 0}
        </AppButton>
        {active && (
          <AppButton
            className={`btn btn-ghost${post.saved ? ' is-selected' : ''}`}
            disabled={busy}
            aria-pressed={!!post.saved}
            onClick={() => toggle('posts.saveToCollection', { saved: !post.saved })}
          >
            {post.saved ? 'Сохранено ✓' : 'Сохранить'}
          </AppButton>
        )}
        <AppButton
          className="btn btn-ghost"
          onClick={() => setSharing(true)}
          aria-label={`Поделиться образом: ${post.title}`}
        >
          Поделиться
        </AppButton>
        {owned ? (
          <>
            <AppButton className="btn btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
              <Icon name="edit" />
              Изменить
            </AppButton>
            <AppButton
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => setDeleting(true)}
              aria-label={`Удалить публикацию: ${post.title}`}
            >
              <Icon name="trash" />
              Удалить
            </AppButton>
          </>
        ) : (
          active && (
            <AppButton className="btn btn-ghost" onClick={() => setReport(true)}>
              Пожаловаться
            </AppButton>
          )
        )}
      </div>
      <SocialNotice error>{error}</SocialNotice>
      {comments && (
        <Comments
          key={`${post.id}:${social.user?.id || 'guest'}`}
          post={post}
          onCountChange={(delta) =>
            updated({ ...post, commentsCount: Math.max(0, (post.commentsCount || 0) + delta) })
          }
        />
      )}
      {editing && <PostEditor post={post} onClose={() => setEditing(false)} onSaved={updated} />}
      {deleting && (
        <ConfirmDialog
          title="Удалить публикацию?"
          description="Образ, его комментарии и лайки исчезнут из сообщества. Личный образ и вещи в вашем гардеробе останутся."
          onClose={() => setDeleting(false)}
          onConfirm={remove}
        />
      )}
      {report && (
        <ReportDialog targetType="post" targetId={post.id} onClose={() => setReport(false)} />
      )}
      {sharing && (
        <ShareDialog
          path={`/community?post=${encodeURIComponent(post.id)}`}
          title="Поделиться образом"
          onClose={() => setSharing(false)}
        />
      )}
      {inspiration && <InspirationDialog post={post} onClose={() => setInspiration(false)} />}
    </article>
  );
}
