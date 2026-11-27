'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { SocialGate } from '@/components/social/social-gate.jsx';
import { socialThumbnail } from '@/lib/media/social-image.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, ItemArt, Modal } from '@/components/ui/ui.jsx';

export default function PublishOutfit({ outfit, onClose }) {
  const { state } = useCloset();
  const social = useSocial();
  const [draft, setDraft] = useState({
    title: outfit.name,
    description: outfit.description || '',
    tags: '',
    visibility: 'private',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [post, setPost] = useState(null);
  const pending = useRef(null);
  const attempt = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);
  const [pollWith, setPollWith] = useState('');
  const itemsOf = (value) =>
    value.itemIds.map((id) => state.items.find((item) => item.id === id)).filter(Boolean);
  const complete = (value) => {
    const found = itemsOf(value);
    return found.length > 0 && found.length === value.itemIds.length && !value.missingItems?.length;
  };
  const items = itemsOf(outfit);
  // «А или Б»: the second outfit must be complete, different and fit the 15-item poll limit.
  const pollChoices = state.outfits.filter(
    (value) =>
      value.id !== outfit.id &&
      complete(value) &&
      value.itemIds.length <= 15 &&
      value.itemIds.join() !== outfit.itemIds.join(),
  );
  const second = pollChoices.find((value) => value.id === pollWith) || null;
  const secondItems = second ? itemsOf(second) : [];
  const allItems = [...items, ...secondItems.filter((item) => !outfit.itemIds.includes(item.id))];
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const ownerId = social.user?.id;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      if (!complete(outfit)) throw new Error('Сначала заполните образ своими вещами.');
      if (second && items.length > 15)
        throw new Error('Для опроса в каждом варианте может быть не больше 15 вещей.');
      const snapshotItems = [];
      for (const item of allItems) {
        const photo = await socialThumbnail(item.photo);
        if (controller.signal.aborted) return;
        snapshotItems.push({
          id: item.id,
          name: item.name,
          category: item.category,
          colors: item.colors,
          photo,
        });
      }
      const tags = [
        ...new Set(
          draft.tags
            .split(/[,#\n]+/)
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      const payload = {
        ...draft,
        title: draft.title.trim(),
        description: draft.description.trim(),
        tags,
        snapshot: {
          name: outfit.name,
          occasion: outfit.occasion || '',
          style: outfit.style || '',
          season: outfit.season || '',
          items: snapshotItems,
          ...(second
            ? {
                poll: {
                  options: [
                    { label: outfit.name.slice(0, 40), itemIds: items.map((item) => item.id) },
                    {
                      label: second.name.slice(0, 40),
                      itemIds: secondItems.map((item) => item.id),
                    },
                  ],
                },
              }
            : {}),
        },
      };
      const signature = JSON.stringify([ownerId, payload]);
      if (!attempt.current || attempt.current.signature !== signature)
        attempt.current = { signature, clientId: crypto.randomUUID() };
      const result = await social.request(
        'posts.save',
        { ...payload, clientId: attempt.current.clientId },
        { signal: controller.signal, expectedUserId: ownerId },
      );
      if (!controller.signal.aborted) {
        setPost(result.post);
        void social.refresh({ quiet: true });
      }
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <Modal
      title={
        post
          ? 'Образ сохранён в профиле'
          : second
            ? 'Спросить друзей: А или Б'
            : 'Поделиться образом'
      }
      description="Вы выбираете, кому виден образ. Остальные вещи и данные гардероба останутся личными."
      onClose={busy ? () => {} : onClose}
    >
      <SocialGate>
        {post ? (
          <div>
            <p>
              Видимость:{' '}
              {draft.visibility === 'private'
                ? 'только мне'
                : draft.visibility === 'friends'
                  ? 'друзьям'
                  : 'всем'}
              .
            </p>
            <Link className="btn btn-primary" href={`/community?post=${post.id}`} onClick={onClose}>
              Открыть публикацию
            </Link>
          </div>
        ) : (
          <form id="publish-outfit-form" onSubmit={submit}>
            <fieldset className="form-fieldset" disabled={busy}>
              {second ? (
                <div className="publish-poll-preview">
                  {[
                    ['А', outfit, items],
                    ['Б', second, secondItems],
                  ].map(([letter, value, list]) => (
                    <div key={letter}>
                      <span className="publish-poll-letter">{letter}</span>
                      <div className="social-publish-preview">
                        {list.slice(0, 4).map((item) => (
                          <div key={item.id}>
                            {item.photo ? (
                              <img src={item.photo} alt={item.name} />
                            ) : (
                              <ItemArt item={item} />
                            )}
                          </div>
                        ))}
                      </div>
                      <strong>{value.name}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="social-publish-preview">
                  {items.slice(0, 6).map((item) => (
                    <div key={item.id}>
                      {item.photo ? (
                        <img src={item.photo} alt={item.name} />
                      ) : (
                        <ItemArt item={item} />
                      )}
                      <span>{item.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {pollChoices.length > 0 ? (
                <Field
                  label="Опрос «А или Б»"
                  hint="Друзья выберут, какой из двух образов вам надеть. Результаты видят те, кто проголосовал."
                >
                  <select
                    name="pollWith"
                    value={pollWith}
                    onChange={(event) => setPollWith(event.target.value)}
                  >
                    <option value="">Без опроса — только этот образ</option>
                    {pollChoices.map((value) => (
                      <option value={value.id} key={value.id}>
                        Сравнить с «{value.name}»
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <p className="footnote">
                  Хотите спросить друзей «А или Б»? Сохраните ещё один полный образ, и его можно
                  будет добавить сюда для сравнения.
                </p>
              )}
              <Field label="Название">
                <input
                  name="title"
                  value={draft.title}
                  maxLength={100}
                  required
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </Field>
              <Field label="Описание">
                <textarea
                  name="description"
                  rows={3}
                  maxLength={2000}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </Field>
              <Field label="Теги через запятую">
                <input
                  name="tags"
                  maxLength={300}
                  placeholder="Минимализм, прогулка, осень"
                  value={draft.tags}
                  onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                />
              </Field>
              <Field label="Кому виден образ">
                <select
                  name="visibility"
                  value={draft.visibility}
                  onChange={(event) => setDraft({ ...draft, visibility: event.target.value })}
                >
                  <option value="private">Только мне</option>
                  <option value="friends">Моим друзьям</option>
                  <option value="public">Всем</option>
                </select>
              </Field>
              <p className="footnote">
                Сохраняется отдельная публикация с уменьшенными фотографиями. Изменение вещи в
                гардеробе не меняет опубликованный образ.
              </p>
            </fieldset>
            {error && (
              <p role="alert" className="notice notice-error">
                {error}
              </p>
            )}
            <div className="form-actions">
              <AppButton
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={onClose}
              >
                Отмена
              </AppButton>
              <AppButton type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Сохраняем…' : 'Сохранить в профиле'}
              </AppButton>
            </div>
          </form>
        )}
      </SocialGate>
    </Modal>
  );
}
