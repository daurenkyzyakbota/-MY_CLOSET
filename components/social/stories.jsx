'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { ConfirmDialog, Field, Icon, Modal } from '@/components/ui/ui.jsx';
import { chatPhoto } from '@/lib/media/social-image.js';
import { ProfileAvatar, RichText, SocialNotice, useSocialCollection } from './social-common.jsx';

const STORY_SECONDS = 5;

// Which stories this browser has already shown. Only a convenience: losing it shows rings again.
function seenKey(userId) {
  return `mycloset:seen-stories:${userId || 'guest'}`;
}
function readSeen(userId) {
  try {
    const value = JSON.parse(window.localStorage.getItem(seenKey(userId)) || '[]');
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}
function writeSeen(userId, seen) {
  try {
    window.localStorage.setItem(seenKey(userId), JSON.stringify([...seen].slice(-500)));
  } catch {
    /* Private mode or blocked storage: rings simply stay coloured. */
  }
}

function storyAgo(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч`;
}

export function useStories(username) {
  const social = useSocial();
  const collection = useSocialCollection('stories.list', username ? { username } : {}, 'people', {
    enabled: !!social.profile,
  });
  const [seen, setSeen] = useState(() => new Set());
  useEffect(() => setSeen(readSeen(social.user?.id)), [social.user?.id]);
  const markSeen = useCallback(
    (storyId) =>
      setSeen((current) => {
        if (current.has(storyId)) return current;
        const next = new Set(current).add(storyId);
        writeSeen(social.user?.id, next);
        return next;
      }),
    [social.user?.id],
  );
  const people = collection.data?.people || [];
  const unseen = (group) => group.stories.some((story) => !seen.has(story.id));
  return { ...collection, people, seen, markSeen, unseen };
}

/** Round avatars above the feed, as in Instagram: your own first, then unseen stories. */
export function StoriesBar() {
  const social = useSocial();
  const stories = useStories();
  const [viewing, setViewing] = useState(null);
  const [creating, setCreating] = useState(false);
  if (!social.profile) return null;
  const mine = stories.people.find((group) => group.author.id === social.user?.id) || null;
  const others = stories.people
    .filter((group) => group !== mine)
    .sort((a, b) => Number(stories.unseen(b)) - Number(stories.unseen(a)));
  const ordered = [mine, ...others].filter(Boolean);
  const canCreate = !social.profile.banned;

  return (
    <section className="stories-bar social-surface" aria-label="Истории">
      <div className="stories-track">
        <div className="story-bubble is-own">
          <button
            type="button"
            className={`story-ring${mine ? (stories.unseen(mine) ? '' : ' is-seen') : ' is-empty'}`}
            aria-label={mine ? 'Открыть вашу историю' : 'Добавить историю'}
            onClick={() => (mine ? setViewing(0) : canCreate && setCreating(true))}
          >
            <ProfileAvatar profile={social.profile} />
          </button>
          {canCreate && (
            <button
              type="button"
              className="story-add"
              aria-label="Добавить историю"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={14} />
            </button>
          )}
          <span>Ваша история</span>
        </div>
        {others.map((group) => (
          <div className="story-bubble" key={group.author.id}>
            <button
              type="button"
              className={`story-ring${stories.unseen(group) ? '' : ' is-seen'}`}
              aria-label={`История @${group.author.username}${stories.unseen(group) ? ', новая' : ''}`}
              onClick={() => setViewing(ordered.indexOf(group))}
            >
              <ProfileAvatar profile={group.author} />
            </button>
            <span>{group.author.username}</span>
          </div>
        ))}
        {stories.loading && <span className="story-placeholder" aria-hidden="true" />}
        {!stories.loading && !others.length && (
          <p className="stories-hint">
            Здесь появятся истории тех, на кого вы подписаны. Они исчезают через 24 часа.
          </p>
        )}
      </div>
      {viewing !== null && ordered[viewing] && (
        <StoryViewer
          groups={ordered}
          start={viewing}
          seen={stories.seen}
          onSeen={stories.markSeen}
          onDeleted={stories.reload}
          onClose={() => setViewing(null)}
        />
      )}
      {creating && (
        <StoryComposer
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            stories.reload();
          }}
        />
      )}
    </section>
  );
}

/** A profile avatar with a coloured ring when that person has stories right now. */
export function StoryAvatar({ profile, large = false }) {
  const stories = useStories(profile.username);
  const [open, setOpen] = useState(false);
  const group = stories.people[0];
  if (!group?.stories.length) return <ProfileAvatar profile={profile} large={large} />;
  return (
    <>
      <button
        type="button"
        className={`story-ring story-ring-profile${stories.unseen(group) ? '' : ' is-seen'}`}
        aria-label={`Открыть историю @${profile.username}`}
        onClick={() => setOpen(true)}
      >
        <ProfileAvatar profile={profile} large={large} />
      </button>
      {open && (
        <StoryViewer
          groups={[group]}
          start={0}
          seen={stories.seen}
          onSeen={stories.markSeen}
          onDeleted={stories.reload}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function StoryViewer({ groups, start, seen, onSeen, onDeleted, onClose }) {
  const social = useSocial();
  const [position, setPosition] = useState(() => {
    const first = groups[start].stories.findIndex((story) => !seen.has(story.id));
    return { group: start, story: Math.max(0, first) };
  });
  const [paused, setPaused] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef(null);
  const positionRef = useRef(position);
  positionRef.current = position;
  const group = groups[position.group];
  const story = group?.stories[position.story];

  const next = useCallback(() => {
    const current = positionRef.current;
    if (current.story < groups[current.group].stories.length - 1)
      setPosition({ ...current, story: current.story + 1 });
    else if (current.group < groups.length - 1) setPosition({ group: current.group + 1, story: 0 });
    else onClose();
  }, [groups, onClose]);
  const previous = useCallback(() => {
    const current = positionRef.current;
    if (current.story > 0) setPosition({ ...current, story: current.story - 1 });
    else if (current.group > 0)
      setPosition({
        group: current.group - 1,
        story: groups[current.group - 1].stories.length - 1,
      });
  }, [groups]);

  useEffect(() => {
    if (story) onSeen(story.id);
    setFailed(false);
  }, [story, onSeen]);
  useEffect(() => {
    if (paused || deleting || !story) return;
    const timer = window.setTimeout(next, STORY_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [paused, deleting, story, next]);
  useEffect(() => {
    closeRef.current?.focus();
    function keys(event) {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'ArrowLeft') previous();
    }
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [next, previous, onClose]);

  if (!story) return null;
  const own = group.author.id === social.user?.id;
  return (
    <div
      className="story-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`История @${group.author.username}`}
    >
      <div
        className="story-frame"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        <div className="story-progress" aria-hidden="true">
          {group.stories.map((value, index) => (
            <span key={value.id}>
              <span
                key={index === position.story ? `${value.id}:active` : value.id}
                className={
                  index < position.story ? 'is-done' : index === position.story ? 'is-active' : ''
                }
                style={
                  index === position.story
                    ? {
                        animationDuration: `${STORY_SECONDS}s`,
                        animationPlayState: paused || deleting ? 'paused' : 'running',
                      }
                    : undefined
                }
              />
            </span>
          ))}
        </div>
        <header className="story-header">
          <Link
            href={`/people/${encodeURIComponent(group.author.username)}`}
            className="story-author"
            onClick={onClose}
          >
            <ProfileAvatar profile={group.author} />
            <strong>{group.author.username}</strong>
            <time dateTime={story.createdAt}>{storyAgo(story.createdAt)}</time>
          </Link>
          {own && (
            <button
              type="button"
              className="story-icon"
              aria-label="Удалить историю"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setDeleting(true)}
            >
              <Icon name="trash" size={20} />
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            className="story-icon"
            aria-label="Закрыть истории"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            <Icon name="close" size={22} />
          </button>
        </header>
        {failed ? (
          <p className="story-missing">История больше недоступна.</p>
        ) : (
          <img
            src={story.photo}
            alt={story.caption || `История @${group.author.username}`}
            onError={() => setFailed(true)}
          />
        )}
        {story.caption && (
          <p className="story-caption">
            <RichText text={story.caption} />
          </p>
        )}
        <button
          type="button"
          className="story-tap is-prev"
          aria-label="Предыдущая история"
          onClick={previous}
        />
        <button
          type="button"
          className="story-tap is-next"
          aria-label="Следующая история"
          onClick={next}
        />
      </div>
      {deleting && (
        <ConfirmDialog
          title="Удалить историю?"
          description="Её больше никто не увидит."
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await social.request('stories.delete', { storyId: story.id });
            onDeleted();
            onClose();
          }}
        />
      )}
    </div>
  );
}

function StoryComposer({ onClose, onCreated }) {
  const social = useSocial();
  const [photo, setPhoto] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const input = useRef(null);

  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('photo');
    setError('');
    try {
      setPhoto(await chatPhoto(file));
    } catch (cause) {
      setError(cause.message || 'Не удалось подготовить фото.');
    } finally {
      setBusy('');
    }
  }

  async function publish(event) {
    event.preventDefault();
    if (busy || !photo) return;
    setBusy('send');
    setError('');
    try {
      await social.request('stories.create', { photo, caption: caption.trim() });
      onCreated();
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message || 'Не удалось опубликовать.');
      setBusy('');
    }
  }

  return (
    <Modal
      title="Новая история"
      description="Её увидят подписчики и друзья. Через 24 часа история исчезнет."
      onClose={busy === 'send' ? () => {} : onClose}
    >
      <form className="story-composer" onSubmit={publish}>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={choose}
        />
        <button
          type="button"
          className={`story-composer-photo${photo ? ' has-photo' : ''}`}
          onClick={() => input.current?.click()}
          disabled={!!busy}
        >
          {photo ? (
            <img src={photo} alt="Фото для истории" />
          ) : (
            <span>
              <Icon name="image" size={30} />
              {busy === 'photo' ? 'Готовим фото…' : 'Выбрать фото образа'}
            </span>
          )}
        </button>
        <Field label="Подпись" hint="До 200 символов. Можно добавить #тег или @ник.">
          <input
            name="caption"
            maxLength={200}
            value={caption}
            placeholder="Образ дня ✨"
            onChange={(event) => setCaption(event.target.value)}
          />
        </Field>
        <SocialNotice error>{error}</SocialNotice>
        <div className="form-actions">
          <AppButton className="btn btn-secondary" disabled={busy === 'send'} onClick={onClose}>
            Отмена
          </AppButton>
          <AppButton type="submit" className="btn btn-primary" disabled={!photo || !!busy}>
            {busy === 'send' ? 'Публикуем…' : 'Поделиться историей'}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}
