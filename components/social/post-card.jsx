'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { ConfirmDialog, Field, Icon, ItemArt, Modal } from '@/components/ui/ui.jsx';
import {
  ProfileAvatar,
  ReportDialog,
  RichText,
  ShareDialog,
  SocialNotice,
  socialCountWord,
  socialDate,
  useSocialCollection,
} from './social-common.jsx';
import InspirationDialog from './inspiration-dialog.jsx';

const visibilityLabels = { private: 'Только мне', friends: 'Для друзей', public: 'Для всех' };

// Short "how long ago" label for the feed, like "5 мин" or "3 ч"; older posts show the date.
function socialAgo(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн`;
  return socialDate(value);
}

function ItemPicture({ item, alt = item.name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.photo]);
  return item.photo && !failed ? (
    <img src={item.photo} alt={alt} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <ItemArt item={{ ...item, photo: '' }} />
  );
}

function PublishedItem({ item }) {
  return (
    <div className="social-published-item">
      <div className="social-item-art">
        <ItemPicture item={item} />
      </div>
      <span>{item.name}</span>
    </div>
  );
}

// Swipeable gallery: the whole outfit first, then every item on its own slide.
// Double-click (double-tap on phones) likes the post, as in photo feeds.
function PostGallery({ post, items, onDoubleLike }) {
  const trackRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [burst, setBurst] = useState(0);
  const slides = items.length > 1 ? [{ id: 'all', collage: true }, ...items] : items;
  const count = slides.length;

  function scrollTo(next) {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(count - 1, next));
    track.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' });
  }

  function syncIndex() {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    setIndex(Math.round(track.scrollLeft / track.clientWidth));
  }

  function doubleLike() {
    if (!onDoubleLike) return;
    setBurst((value) => value + 1);
    onDoubleLike();
  }

  return (
    <div className="community-gallery">
      <div
        ref={trackRef}
        className="community-gallery-track"
        role="group"
        aria-roledescription="галерея"
        aria-label={`Вещи образа «${post.title}»`}
        tabIndex={count > 1 ? 0 : undefined}
        onScroll={syncIndex}
        onDoubleClick={doubleLike}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            scrollTo(index + 1);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            scrollTo(index - 1);
          }
        }}
      >
        {slides.map((slide, position) => (
          <figure
            className="community-gallery-slide"
            key={slide.id}
            aria-label={`${position + 1} из ${count}`}
          >
            {slide.collage ? (
              <div
                className={`community-gallery-collage is-${Math.min(items.length, 4)}`}
              >
                {items.slice(0, 4).map((item) => (
                  <div className="community-gallery-art" key={item.id}>
                    <ItemPicture item={item} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="community-gallery-art is-single">
                <ItemPicture item={slide} />
              </div>
            )}
            <figcaption>
              {slide.collage
                ? `Весь образ · ${items.length} ${socialCountWord(items.length, 'вещь', 'вещи', 'вещей')}`
                : slide.name}
            </figcaption>
          </figure>
        ))}
      </div>
      {count > 1 && (
        <>
          <span className="community-gallery-counter" aria-hidden="true">
            {index + 1}/{count}
          </span>
          {index > 0 && (
            <button
              type="button"
              className="community-gallery-nav is-prev"
              aria-label="Предыдущая вещь"
              onClick={() => scrollTo(index - 1)}
            >
              <Icon name="chevron-left" size={18} />
            </button>
          )}
          {index < count - 1 && (
            <button
              type="button"
              className="community-gallery-nav is-next"
              aria-label="Следующая вещь"
              onClick={() => scrollTo(index + 1)}
            >
              <Icon name="chevron-right" size={18} />
            </button>
          )}
          <div className="community-gallery-dots" aria-hidden="true">
            {slides.map((slide, position) => (
              <span key={slide.id} className={position === index ? 'is-active' : ''} />
            ))}
          </div>
        </>
      )}
      {burst > 0 && (
        <span key={burst} className="community-like-burst" aria-hidden="true">
          <Icon name="heart" size={96} fill="currentColor" />
        </span>
      )}
    </div>
  );
}

// «А или Б»: the author asks which of two outfits to wear. Results appear once you vote.
function PostPoll({ post, items, canVote, busy, loginHref, onVote }) {
  const { poll } = post;
  const byId = new Map(items.map((item) => [item.id, item]));
  const showResults = poll.total !== null;
  const total = poll.total || 0;
  return (
    <section className="post-poll" aria-label={`Опрос: ${post.title}`}>
      <p className="post-poll-question">Помогите выбрать: какой вариант лучше?</p>
      <div className="post-poll-options">
        {poll.options.map((option, index) => {
          const optionItems = option.itemIds.map((itemId) => byId.get(itemId)).filter(Boolean);
          const percent = showResults && total ? Math.round((option.votes / total) * 100) : 0;
          const chosen = poll.myVote === index;
          const leader = showResults && total > 0 && option.votes * 2 > total;
          const letter = index ? 'Б' : 'А';
          return (
            <button
              type="button"
              key={index}
              className={`post-poll-option${chosen ? ' is-chosen' : ''}${leader ? ' is-leader' : ''}`}
              disabled={!canVote || busy}
              aria-pressed={chosen}
              aria-label={`Вариант ${letter} «${option.label}»: ${optionItems.map((item) => item.name).join(', ')}${
                showResults ? `. ${percent}%` : ''
              }`}
              onClick={() => onVote(index)}
            >
              <span className={`post-poll-collage is-${Math.min(optionItems.length, 4)}`}>
                {optionItems.slice(0, 4).map((item) => (
                  <span className="post-poll-art" key={item.id}>
                    <ItemPicture item={item} alt="" />
                  </span>
                ))}
              </span>
              <span className="post-poll-letter" aria-hidden="true">
                {letter}
              </span>
              <span className="post-poll-label">
                <strong>{option.label}</strong>
                <small>
                  {optionItems.length} {socialCountWord(optionItems.length, 'вещь', 'вещи', 'вещей')}
                </small>
              </span>
              {showResults ? (
                <span className="post-poll-result">
                  <span className="post-poll-bar">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                  <span>
                    {percent}%{chosen ? ' · ваш выбор' : ''}
                  </span>
                </span>
              ) : (
                <span className="post-poll-vote">{canVote ? `Выбрать ${letter}` : `Вариант ${letter}`}</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="post-poll-footnote">
        {showResults ? (
          `${total} ${socialCountWord(total, 'голос', 'голоса', 'голосов')}${
            canVote ? ' · можно передумать' : ''
          }`
        ) : canVote ? (
          'Результаты появятся после вашего голоса'
        ) : (
          <>
            <Link href={loginHref}>Войдите</Link>, чтобы проголосовать
          </>
        )}
      </p>
    </section>
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
  const [replyTo, setReplyTo] = useState(null);
  const textRef = useRef(null);
  const canWrite = !!social.user && !!social.profile;
  // Comments arrive as top-level threads with `replies`; update both levels at once.
  function updateAll(change) {
    comments.setData((current) => ({
      ...current,
      comments: (current?.comments || [])
        .map((root) => change(root))
        .filter(Boolean)
        .map((root) => ({ ...root, replies: (root.replies || []).map(change).filter(Boolean) })),
    }));
  }
  function startReply(comment) {
    setReplyTo(comment);
    setText((value) => (value.startsWith('@') ? value : `@${comment.author.username} ${value}`));
    textRef.current?.focus();
  }
  async function like(comment) {
    if (!canWrite) return;
    const liked = !comment.liked;
    updateAll((value) =>
      value.id === comment.id
        ? { ...value, liked, likesCount: Math.max(0, value.likesCount + (liked ? 1 : -1)) }
        : value,
    );
    try {
      const result = await social.request('comments.like', { commentId: comment.id, liked });
      updateAll((value) =>
        value.id === comment.id ? { ...value, ...result.comment, replies: value.replies } : value,
      );
    } catch (cause) {
      updateAll((value) => (value.id === comment.id ? comment : value));
      if (cause.name !== 'AbortError') setError(cause.message);
    }
  }
  async function save(event) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await social.request('comments.save', {
        postId: post.id,
        text: text.trim(),
        ...(replyTo ? { parentId: replyTo.id } : {}),
      });
      setText('');
      setReplyTo(null);
      const created = { ...result.comment, replies: [] };
      comments.setData((current) => ({
        ...current,
        comments: created.parentId
          ? (current?.comments || []).map((root) =>
              root.id === created.parentId
                ? { ...root, replies: [...(root.replies || []), created] }
                : root,
            )
          : [created, ...(current?.comments || [])],
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
      updateAll((value) =>
        value.id === result.comment.id
          ? { ...value, ...result.comment, replies: value.replies }
          : value,
      );
      setEditing(null);
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    await social.request('comments.delete', { commentId: deleting.id });
    updateAll((value) => (value.id === deleting.id ? null : value));
    onCountChange(-1 - (deleting.replies?.length || 0));
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
          <div className="social-comment-thread" key={comment.id}>
            <CommentItem
              comment={comment}
              busy={busy}
              canWrite={canWrite}
              onLike={like}
              onReply={startReply}
              onEdit={(value) => {
                setEditing({ ...value });
                setError('');
              }}
              onDelete={setDeleting}
            />
            {comment.replies?.length > 0 && (
              <div className="social-comment-replies">
                {comment.replies.map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    busy={busy}
                    canWrite={canWrite}
                    onLike={like}
                    onReply={() => startReply({ ...reply, id: comment.id })}
                    onEdit={(value) => {
                      setEditing({ ...value });
                      setError('');
                    }}
                    onDelete={setDeleting}
                  />
                ))}
              </div>
            )}
          </div>
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
          {replyTo && (
            <p className="social-comment-replying">
              Ответ для <strong>@{replyTo.author.username}</strong>
              <AppButton
                className="btn btn-ghost"
                onClick={() => {
                  setReplyTo(null);
                  setText((value) => value.replace(/^@\S+\s/, ''));
                }}
                aria-label="Отменить ответ"
              >
                <Icon name="close" size={14} />
              </AppButton>
            </p>
          )}
          <Field label={replyTo ? 'Ваш ответ' : 'Ваш комментарий'}>
            <textarea
              ref={textRef}
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
            {busy ? 'Отправляем…' : replyTo ? 'Ответить' : 'Отправить комментарий'}
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

function CommentItem({ comment, busy, canWrite, onLike, onReply, onEdit, onDelete }) {
  return (
    <article className="social-comment">
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
      <p>
        <RichText text={comment.text} />
      </p>
      <div className="social-comment-footer">
        <time dateTime={comment.createdAt}>{socialDate(comment.createdAt)}</time>
        <div>
          <AppButton
            className={`btn btn-ghost social-comment-like${comment.liked ? ' is-liked' : ''}`}
            disabled={!canWrite}
            aria-pressed={!!comment.liked}
            aria-label={comment.liked ? 'Убрать отметку «нравится»' : 'Нравится'}
            onClick={() => onLike(comment)}
          >
            <Icon name="heart" size={16} fill={comment.liked ? 'currentColor' : 'none'} />
            {comment.likesCount > 0 && <span>{comment.likesCount}</span>}
          </AppButton>
          {canWrite && (
            <AppButton className="btn btn-ghost" disabled={busy} onClick={() => onReply(comment)}>
              Ответить
            </AppButton>
          )}
          {comment.owned && (
            <AppButton className="btn btn-ghost" disabled={busy} onClick={() => onEdit(comment)}>
              Изменить
            </AppButton>
          )}
          {comment.canDelete && (
            <AppButton className="btn btn-ghost" disabled={busy} onClick={() => onDelete(comment)}>
              Удалить
            </AppButton>
          )}
        </div>
      </div>
    </article>
  );
}

export default function PostCard({
  post: initialPost,
  onUpdated,
  onDeleted,
  expanded = false,
  community = false,
  onTagSelect,
}) {
  const social = useSocial();
  const [post, setPost] = useState(initialPost);
  const [comments, setComments] = useState(expanded);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const menuId = useId();
  const menuButtonId = useId();
  const commentsId = useId();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [report, setReport] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [inspiration, setInspiration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setPost(initialPost), [initialPost]);
  const active = !!social.user && !!social.profile && !social.profile.banned;
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
  function chooseAction(showDialog) {
    setMenuAnchor(null);
    showDialog(true);
  }
  const items = post.snapshot?.items || [];
  const moderator = !owned && !!post.canModerate;
  const likes = post.likesCount || 0;
  const commentCount = post.commentsCount || 0;
  const loginHref = social.user ? '/community?tab=profile' : '/account';

  const menu = (
    <Menu
      anchorEl={menuAnchor}
      open={Boolean(menuAnchor)}
      onClose={() => setMenuAnchor(null)}
      slotProps={{
        list: {
          id: menuId,
          className: 'community-post-more-list',
          'aria-labelledby': menuButtonId,
        },
      }}
    >
      {owned
        ? [
            <MenuItem key="edit" disabled={busy} onClick={() => chooseAction(setEditing)}>
              <Icon name="edit" size={18} /> Изменить
            </MenuItem>,
            <MenuItem key="delete" disabled={busy} onClick={() => chooseAction(setDeleting)}>
              <Icon name="trash" size={18} /> Удалить
            </MenuItem>,
          ]
        : [
            <MenuItem key="report" onClick={() => chooseAction(setReport)}>
              <Icon name="warning" size={18} /> Пожаловаться
            </MenuItem>,
            moderator && (
              <MenuItem
                key="moderate"
                className="community-post-moderate"
                disabled={busy}
                onClick={() => chooseAction(setDeleting)}
              >
                <Icon name="shield" size={18} /> Удалить как администратор
              </MenuItem>
            ),
          ].filter(Boolean)}
    </Menu>
  );

  const header = (
    <header className="social-post-header">
      <Link
        className="social-person-identity"
        href={`/people/${encodeURIComponent(post.author.username)}`}
      >
        <ProfileAvatar profile={post.author} />
        <span>
          <strong>{post.author.name}</strong>
          <span className="social-handle">
            @{post.author.username}
            {community && (
              <>
                {' · '}
                <time dateTime={post.createdAt} title={socialDate(post.createdAt)}>
                  {socialAgo(post.createdAt)}
                </time>
              </>
            )}
          </span>
        </span>
      </Link>
      {community && (owned || active) ? (
        <div className="community-post-meta">
          <span className="social-post-visibility">{visibilityLabels[post.visibility] || 'Образ'}</span>
          <AppButton
            id={menuButtonId}
            className="btn btn-ghost community-post-more"
            aria-label={`Действия с публикацией: ${post.title}`}
            aria-haspopup="menu"
            aria-controls={menuAnchor ? menuId : undefined}
            aria-expanded={Boolean(menuAnchor)}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <Icon name="more" />
          </AppButton>
          {menu}
        </div>
      ) : (
        <span className="social-post-visibility">{visibilityLabels[post.visibility] || 'Образ'}</span>
      )}
    </header>
  );

  const tags = !!post.tags?.length && (
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
  );

  const poll = post.poll && (
    <PostPoll
      post={post}
      items={items}
      canVote={active && !owned}
      busy={busy}
      loginHref={loginHref}
      onVote={(option) => option !== post.poll.myVote && toggle('posts.vote', { option })}
    />
  );

  const likeLabel = `${post.liked ? 'Убрать лайк' : 'Поставить лайк'}: ${post.title}. Лайков: ${likes}`;
  const commentsSection = (
    <div id={commentsId} hidden={!comments}>
      {comments && (
        <Comments
          key={`${post.id}:${social.user?.id || 'guest'}`}
          post={post}
          onCountChange={(delta) =>
            updated({ ...post, commentsCount: Math.max(0, commentCount + delta) })
          }
        />
      )}
    </div>
  );

  return (
    <article
      className={`social-post-card social-surface${community ? ' community-post-card' : ''}`}
      data-post-id={post.id}
    >
      {header}
      {community ? (
        <>
          {poll}
          {!post.poll && items.length > 0 && (
            <PostGallery
              post={post}
              items={items}
              onDoubleLike={
                active && !busy ? () => !post.liked && toggle('posts.like', { liked: true }) : null
              }
            />
          )}
          <div className="community-post-bar">
            <div className="community-post-bar-main">
              {active ? (
                <AppButton
                  className={`community-post-icon${post.liked ? ' is-liked' : ''}`}
                  disabled={busy}
                  aria-pressed={!!post.liked}
                  aria-label={likeLabel}
                  title={post.liked ? 'Убрать лайк' : 'Нравится'}
                  onClick={() => toggle('posts.like', { liked: !post.liked })}
                >
                  <Icon name="heart" size={26} fill={post.liked ? 'currentColor' : 'none'} />
                </AppButton>
              ) : (
                <Link
                  className="community-post-icon"
                  href={loginHref}
                  aria-label={`Войти, чтобы поставить лайк. Лайков: ${likes}`}
                >
                  <Icon name="heart" size={26} />
                </Link>
              )}
              <AppButton
                className="community-post-icon"
                aria-label={`Комментарии: ${commentCount}`}
                aria-expanded={comments}
                aria-controls={commentsId}
                title="Комментарии"
                onClick={() => setComments((value) => !value)}
              >
                <Icon name="message" size={25} />
              </AppButton>
              <AppButton
                className="community-post-icon"
                onClick={() => setSharing(true)}
                aria-label={`Поделиться образом: ${post.title}`}
                title="Поделиться"
              >
                <Icon name="send" size={24} />
              </AppButton>
            </div>
            {active && (
              <AppButton
                className={`community-post-icon${post.saved ? ' is-saved' : ''}`}
                disabled={busy}
                aria-pressed={!!post.saved}
                aria-label={post.saved ? 'Убрать из сохранённого' : 'Сохранить образ'}
                title={post.saved ? 'Сохранено' : 'Сохранить'}
                onClick={() => toggle('posts.saveToCollection', { saved: !post.saved })}
              >
                <Icon name="bookmark" size={25} fill={post.saved ? 'currentColor' : 'none'} />
              </AppButton>
            )}
          </div>
          <p className="community-post-likes">
            {likes > 0
              ? `${likes} ${socialCountWord(likes, 'отметка', 'отметки', 'отметок')} «Нравится»`
              : 'Пока без лайков — будьте первым'}
          </p>
          <div className="community-post-caption">
            <h2>
              <Link href={`/community?post=${encodeURIComponent(post.id)}`}>{post.title}</Link>
            </h2>
            {post.description && (
              <p className="social-post-description">
                <Link href={`/people/${encodeURIComponent(post.author.username)}`}>
                  {post.author.username}
                </Link>{' '}
                <RichText text={post.description} />
              </p>
            )}
          </div>
          {tags}
          <button
            type="button"
            className="community-post-comments-link"
            aria-expanded={comments}
            aria-controls={commentsId}
            onClick={() => setComments((value) => !value)}
          >
            {comments
              ? 'Скрыть комментарии'
              : commentCount > 0
                ? `Посмотреть ${commentCount === 1 ? '' : 'все '}${commentCount} ${socialCountWord(commentCount, 'комментарий', 'комментария', 'комментариев')}`
                : 'Добавить комментарий…'}
          </button>
          <SocialNotice error>{error}</SocialNotice>
          {commentsSection}
          <AppButton className="btn btn-ghost inspiration-start" onClick={() => setInspiration(true)}>
            <Icon name="outfits" />
            Повторить образ
          </AppButton>
        </>
      ) : (
        <>
          <div className="social-post-title">
            <h2>
              <Link href={`/community?post=${encodeURIComponent(post.id)}`}>{post.title}</Link>
            </h2>
            <time dateTime={post.createdAt}>{socialDate(post.createdAt)}</time>
          </div>
          {poll}
          {!post.poll && items.length > 0 && (
            <div className="social-published-items" aria-label="Состав опубликованного образа">
              {items.map((item) => (
                <PublishedItem item={item} key={item.id} />
              ))}
            </div>
          )}
          {post.description && (
            <p className="social-post-description">
              <RichText text={post.description} />
            </p>
          )}
          {tags}
          <div className="social-post-actions">
            {active ? (
              <AppButton
                className={`btn btn-ghost${post.liked ? ' is-selected' : ''}`}
                disabled={busy}
                aria-pressed={!!post.liked}
                aria-label={likeLabel}
                onClick={() => toggle('posts.like', { liked: !post.liked })}
              >
                <Icon name="heart" fill={post.liked ? 'currentColor' : 'none'} />
                {likes}
              </AppButton>
            ) : (
              <Link
                className="btn btn-ghost"
                href={loginHref}
                aria-label={`Войти, чтобы поставить лайк. Лайков: ${likes}`}
              >
                <Icon name="heart" />
                {likes}
              </Link>
            )}
            <AppButton
              className="btn btn-ghost"
              aria-label={`Комментарии: ${commentCount}`}
              aria-expanded={comments}
              aria-controls={commentsId}
              onClick={() => setComments((value) => !value)}
            >
              <Icon name="message" size={18} />
              {`Комментарии · ${commentCount}`}
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
              className="btn btn-ghost community-post-share"
              onClick={() => setSharing(true)}
              aria-label={`Поделиться образом: ${post.title}`}
            >
              <Icon name="share" size={18} />
              <span>Поделиться</span>
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
                <>
                  <AppButton className="btn btn-ghost" onClick={() => setReport(true)}>
                    Пожаловаться
                  </AppButton>
                  {moderator && (
                    <AppButton
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => setDeleting(true)}
                      aria-label={`Удалить как администратор: ${post.title}`}
                    >
                      <Icon name="shield" />
                      Удалить как админ
                    </AppButton>
                  )}
                </>
              )
            )}
            <AppButton className="btn btn-ghost inspiration-start" onClick={() => setInspiration(true)}>
              <Icon name="outfits" />
              Повторить образ
            </AppButton>
          </div>
          <SocialNotice error>{error}</SocialNotice>
          {commentsSection}
        </>
      )}
      {editing && <PostEditor post={post} onClose={() => setEditing(false)} onSaved={updated} />}
      {deleting && (
        <ConfirmDialog
          title={moderator ? 'Удалить публикацию как администратор?' : 'Удалить публикацию?'}
          description={
            moderator
              ? `Образ @${post.author.username} исчезнет из сообщества вместе с лайками и комментариями, а жалобы на него будут закрыты. Отменить это нельзя.`
              : 'Образ, его комментарии и лайки исчезнут из сообщества. Личный образ и вещи в вашем гардеробе останутся.'
          }
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
