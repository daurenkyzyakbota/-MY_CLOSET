'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Icon, Modal } from '@/components/ui/ui.jsx';

function SearchDialog({ conversationId, peerName, onClose }) {
  const social = useSocial();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [view, setView] = useState({
    term: '',
    messages: [],
    cursor: null,
    busy: false,
    error: '',
  });
  const [moreBusy, setMoreBusy] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const flight = useRef(null);
  const current = useRef('');
  useEffect(() => () => flight.current?.abort(), []);
  const key = `${social.user?.id || ''}|${conversationId}|${term}|${retryNonce}`;
  current.current = key;
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    flight.current?.abort();
    flight.current = controller;
    setMoreBusy(false);
    const owner = key;
    if (term.length < 2) {
      setView({ term, messages: [], cursor: null, busy: false, error: '' });
      return () => controller.abort();
    }
    setView({ term, messages: [], cursor: null, busy: true, error: '' });
    void social
      .request('messages.search', { conversationId, query: term }, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted && current.current === owner)
          setView({
            term,
            messages: result.messages,
            cursor: result.nextCursor,
            busy: false,
            error: '',
          });
      })
      .catch((cause) => {
        if (!controller.signal.aborted && cause.name !== 'AbortError' && current.current === owner)
          setView({ term, messages: [], cursor: null, busy: false, error: cause.message });
      });
    return () => controller.abort();
  }, [key, term, conversationId, social.request]);
  async function more() {
    if (moreBusy || !view.cursor || view.term !== term) return;
    const owner = key;
    const controller = new AbortController();
    flight.current?.abort();
    flight.current = controller;
    setMoreBusy(true);
    try {
      const result = await social.request(
        'messages.search',
        { conversationId, query: term, cursor: view.cursor },
        { signal: controller.signal },
      );
      if (!controller.signal.aborted && current.current === owner)
        setView((value) => ({
          ...value,
          messages: [
            ...new Map(
              [...value.messages, ...result.messages].map((message) => [message.id, message]),
            ).values(),
          ],
          cursor: result.nextCursor,
          error: '',
        }));
    } catch (cause) {
      if (!controller.signal.aborted && cause.name !== 'AbortError' && current.current === owner)
        setView((value) => ({ ...value, error: cause.message }));
    } finally {
      if (current.current === owner) setMoreBusy(false);
    }
  }
  const visible =
    view.term === term ? view : { messages: [], cursor: null, busy: term.length >= 2, error: '' };
  return (
    <Modal
      title="Поиск в переписке"
      description={peerName ? `Диалог с ${peerName}` : 'Найдите текст в истории этого диалога.'}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim() === term) setRetryNonce((value) => value + 1);
          setTerm(query.trim());
        }}
      >
        <Field label="Текст сообщения">
          <input
            type="search"
            name="messageQuery"
            autoFocus
            maxLength={100}
            placeholder="Например, платье или встреча…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
      </form>
      <div className="message-search-results" aria-live="polite">
        {term.length < 2 && (
          <p className="footnote">
            Введите хотя бы две буквы. Поиск работает только в этом диалоге.
          </p>
        )}
        {visible.busy && (
          <p role="status" className="footnote">
            Ищем сообщения…
          </p>
        )}
        {visible.error && (
          <div>
            <p role="alert" className="notice notice-error">
              {visible.error}
            </p>
            <AppButton
              className="btn btn-secondary"
              onClick={() => setRetryNonce((value) => value + 1)}
            >
              Повторить поиск
            </AppButton>
          </div>
        )}
        {!visible.busy && !visible.error && term.length >= 2 && !visible.messages.length && (
          <p className="footnote">Сообщений с таким текстом не найдено.</p>
        )}
        {visible.messages.map((message) => (
          <article className="message-search-result" key={message.id}>
            <div>
              <strong>
                {message.senderId === social.user?.id ? 'Вы' : peerName || 'Собеседник'}
              </strong>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
            <p>{message.text}</p>
            {message.post &&
              (message.post.unavailable ? (
                <span className="footnote">Образ больше недоступен</span>
              ) : (
                <Link
                  href={'/community?post=' + encodeURIComponent(message.post.id)}
                  onClick={onClose}
                >
                  {message.post.title || 'Открыть образ'}
                </Link>
              ))}
          </article>
        ))}
        {visible.cursor && (
          <AppButton className="btn btn-secondary" disabled={moreBusy} onClick={more}>
            {moreBusy ? 'Загружаем…' : 'Ещё результаты'}
          </AppButton>
        )}
      </div>
    </Modal>
  );
}

export default function MessageSearch({ conversationId, peerName }) {
  const { user } = useSocial();
  const [open, setOpen] = useState(false);
  return (
    <>
      <AppButton
        className="icon-button"
        aria-label="Поиск в переписке"
        disabled={!conversationId}
        onClick={() => setOpen(true)}
      >
        <Icon name="search" />
      </AppButton>
      {open && user && (
        <SearchDialog
          key={user.id + '|' + conversationId}
          conversationId={conversationId}
          peerName={peerName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
