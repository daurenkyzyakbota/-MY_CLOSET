'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { SocialGate } from '@/components/social/social-gate.jsx';
import { useNarrowSocialScreen, useSocialPoll } from '@/components/social/use-social-poll.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { EmptyState, Field, Icon, Loading, PageHeader } from '@/components/ui/ui.jsx';
import MessageSearch from '@/components/social/message-search.jsx';

const displayDate = (value, full = false) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(full ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
};

function PeerAvatar({ peer }) {
  return (
    <span className="social-chat-avatar" aria-hidden="true">
      <span>{(peer?.name || peer?.username || '?').slice(0, 1).toLocaleUpperCase('ru')}</span>
      {peer?.avatar && (
        <img
          src={peer.avatar}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      )}
    </span>
  );
}

function mergeMessages(previous, incoming) {
  const entries = new Map(previous.map((message) => [message.id, message]));
  incoming.forEach((message) => entries.set(message.id, message));
  return [...entries.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function MessagesContent() {
  const { user, request, refresh } = useSocial();
  const search = useSearchParams();
  const router = useRouter();
  const peerParameter = search.get('user') || '';
  const conversationParameter = search.get('conversation') || '';
  const postParameter = search.get('post') || '';
  const narrow = useNarrowSocialScreen();
  const requestRef = useRef(request);
  const refreshRef = useRef(refresh);
  requestRef.current = request;
  refreshRef.current = refresh;

  const [conversations, setConversations] = useState([]);
  const [listReady, setListReady] = useState(false);
  const [listError, setListError] = useState('');
  const [opening, setOpening] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [showList, setShowList] = useState(true);
  const [messages, setMessages] = useState([]);
  const [messagesReady, setMessagesReady] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [before, setBefore] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentInput, setAttachmentInput] = useState('');
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [sending, setSending] = useState('');
  const [sendError, setSendError] = useState('');
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const drafts = useRef(new Map());
  const listFlight = useRef(null);
  const listSequence = useRef(0);
  const messageFlight = useRef(null);
  const sendFlight = useRef(false);
  const sendAttempts = useRef(new Map());
  const logRef = useRef(null);
  const scrollToBottom = useRef(true);
  const restoreScroll = useRef(null);
  const readThrough = useRef(new Map());
  const current = conversations.find((conversation) => conversation.id === activeId) || null;
  const chatVisible = !!activeId && (!narrow || !showList);
  const canSend = !!current?.canMessage;

  const loadConversations = useCallback(async (signal) => {
    if (listFlight.current && !listFlight.current.signal?.aborted) return;
    const flight = { signal };
    listFlight.current = flight;
    const sequence = ++listSequence.current;
    try {
      const result = await requestRef.current('conversations.list', {}, { signal });
      if (signal?.aborted || sequence !== listSequence.current) return;
      setConversations(result.conversations);
      setListReady(true);
      setListError('');
    } catch (cause) {
      if (cause.name !== 'AbortError' && !signal?.aborted && sequence === listSequence.current) {
        setListError(cause.message || 'Не удалось открыть диалоги.');
        setListReady(true);
      }
    } finally {
      if (listFlight.current === flight) listFlight.current = null;
    }
  }, []);

  const loadMessages = useCallback(async (conversationId, signal, initial = false) => {
    if (
      !conversationId ||
      (messageFlight.current?.conversationId === conversationId &&
        !messageFlight.current.signal?.aborted)
    )
      return;
    const flight = { conversationId, signal };
    messageFlight.current = flight;
    const log = logRef.current;
    const nearBottom = !log || log.scrollHeight - log.clientHeight - log.scrollTop < 100;
    try {
      const result = await requestRef.current('messages.list', { conversationId }, { signal });
      if (signal?.aborted || activeRef.current !== conversationId) return;
      scrollToBottom.current = initial || nearBottom;
      setMessages((previous) =>
        initial ? result.messages : mergeMessages(previous, result.messages),
      );
      if (initial) setBefore(result.nextCursor || null);
      setMessagesReady(true);
      setMessageError('');
    } catch (cause) {
      if (cause.name !== 'AbortError' && !signal?.aborted && activeRef.current === conversationId) {
        setMessageError(cause.message || 'Не удалось открыть переписку.');
        if ([401, 403, 404].includes(cause.status)) setMessages([]);
        setMessagesReady(true);
      }
    } finally {
      if (messageFlight.current === flight) messageFlight.current = null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadConversations(controller.signal);
    return () => controller.abort();
  }, [loadConversations]);

  useEffect(() => {
    if (!peerParameter) {
      setOpening(false);
      if (conversationParameter) {
        setActiveId(conversationParameter);
        setShowList(false);
      }
      return;
    }
    const controller = new AbortController();
    setOpening(true);
    setListError('');
    requestRef
      .current('conversations.open', { userId: peerParameter }, { signal: controller.signal })
      .then(({ conversation }) => {
        if (controller.signal.aborted) return;
        listSequence.current++;
        setOpening(false);
        setConversations((previous) => [
          conversation,
          ...previous.filter((entry) => entry.id !== conversation.id),
        ]);
        setActiveId(conversation.id);
        setShowList(false);
        setListReady(true);
        const next = new URLSearchParams({ conversation: conversation.id });
        if (postParameter) next.set('post', postParameter);
        router.replace('/messages?' + next);
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError' && !controller.signal.aborted)
          setListError(cause.message || 'Не удалось начать переписку.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setOpening(false);
      });
    return () => controller.abort();
  }, [peerParameter, conversationParameter, postParameter, router]);

  useEffect(() => {
    const controller = new AbortController();
    setMessages([]);
    setMessagesReady(false);
    setMessageError('');
    setSendError('');
    setBefore(null);
    setLoadingOlder(false);
    setDraft(drafts.current.get(activeId) || '');
    setAttachment(null);
    setAttachmentError('');
    setAttachmentInput('');
    setAttachmentOpen(false);
    setAttaching(false);
    scrollToBottom.current = true;
    if (activeId) void loadMessages(activeId, controller.signal, true);
    return () => controller.abort();
  }, [activeId, loadMessages]);

  useEffect(() => {
    if (!postParameter) {
      setAttachment(null);
      return;
    }
    if (!activeId) return;
    const controller = new AbortController();
    setAttachmentError('');
    requestRef
      .current('posts.get', { postId: postParameter }, { signal: controller.signal })
      .then(({ post }) => {
        if (!controller.signal.aborted) setAttachment({ id: post.id, title: post.title });
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError' && !controller.signal.aborted)
          setAttachmentError(cause.message || 'Образ недоступен для отправки.');
      });
    return () => controller.abort();
  }, [postParameter, activeId]);

  useSocialPoll(async (signal) => {
    await loadConversations(signal);
    await refreshRef.current({ signal, quiet: true });
  });
  useSocialPoll((signal) => loadMessages(activeId, signal, !messagesReady), chatVisible);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (restoreScroll.current) {
      const previous = restoreScroll.current;
      log.scrollTop = log.scrollHeight - previous.height + previous.top;
      restoreScroll.current = null;
    } else if (scrollToBottom.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [messages, chatVisible]);

  useEffect(() => {
    if (!chatVisible || !messagesReady || !messages.length || messageError) return;
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    const last = messages[messages.length - 1];
    if (readThrough.current.get(activeId) === last.id) return;
    if (!messages.some((message) => message.senderId !== user.id)) return;
    const controller = new AbortController();
    requestRef
      .current(
        'messages.read',
        { conversationId: activeId, lastMessageId: last.id },
        { signal: controller.signal },
      )
      .then(() => {
        if (controller.signal.aborted) return;
        readThrough.current.set(activeId, last.id);
        setConversations((previous) =>
          previous.map((conversation) =>
            conversation.id === activeId ? { ...conversation, unreadCount: 0 } : conversation,
          ),
        );
        void refreshRef.current({ quiet: true });
      })
      .catch(() => {
        /* The next visible poll retries read-through. */
      });
    return () => controller.abort();
  }, [activeId, chatVisible, messages, messagesReady, messageError, user.id]);

  async function olderMessages() {
    if (!before || loadingOlder || !activeId) return;
    const conversationId = activeId;
    setLoadingOlder(true);
    setMessageError('');
    try {
      const result = await requestRef.current('messages.list', { conversationId, before });
      if (activeRef.current !== conversationId) return;
      const log = logRef.current;
      if (log) restoreScroll.current = { height: log.scrollHeight, top: log.scrollTop };
      scrollToBottom.current = false;
      setMessages((previous) => mergeMessages(previous, result.messages));
      setBefore(result.nextCursor || null);
    } catch (cause) {
      if (activeRef.current === conversationId && cause.name !== 'AbortError')
        setMessageError(cause.message || 'Не удалось загрузить ранние сообщения.');
    } finally {
      if (activeRef.current === conversationId) setLoadingOlder(false);
    }
  }

  function selectConversation(conversation) {
    setActiveId(conversation.id);
    setShowList(false);
    router.replace('/messages?' + new URLSearchParams({ conversation: conversation.id }));
  }

  function changeDraft(value) {
    setDraft(value);
    drafts.current.set(activeId, value);
  }

  async function attachPost() {
    if (attaching || !attachmentInput.trim()) return;
    const conversationId = activeId;
    setAttachmentError('');
    setAttaching(true);
    try {
      const value = new URL(attachmentInput.trim(), window.location.origin);
      if (
        value.origin !== window.location.origin ||
        value.pathname !== '/community' ||
        !value.searchParams.get('post')
      )
        throw new Error('Вставьте ссылку на опубликованный образ MyCloset.');
      const { post } = await requestRef.current('posts.get', {
        postId: value.searchParams.get('post'),
      });
      if (activeRef.current !== conversationId) return;
      setAttachment({ id: post.id, title: post.title });
      setAttachmentOpen(false);
      setAttachmentInput('');
    } catch (cause) {
      if (activeRef.current === conversationId && cause.name !== 'AbortError')
        setAttachmentError(cause.message || 'Не удалось прикрепить образ.');
    } finally {
      if (activeRef.current === conversationId) setAttaching(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (sendFlight.current || attaching || !canSend || (!draft.trim() && !attachment)) return;
    const conversationId = activeId;
    const text = draft.trim();
    const postId = attachment?.id;
    const fingerprint = JSON.stringify({ conversationId, text, postId: postId || '' });
    const previousAttempt = sendAttempts.current.get(conversationId);
    const attempt =
      previousAttempt?.fingerprint === fingerprint
        ? previousAttempt
        : { fingerprint, clientId: window.crypto.randomUUID() };
    sendAttempts.current.set(conversationId, attempt);
    sendFlight.current = true;
    setSending(conversationId);
    setSendError('');
    try {
      const { message } = await requestRef.current('messages.send', {
        conversationId,
        text,
        clientId: attempt.clientId,
        ...(postId ? { postId } : {}),
      });
      drafts.current.delete(conversationId);
      sendAttempts.current.delete(conversationId);
      if (activeRef.current === conversationId) {
        scrollToBottom.current = true;
        setMessages((previous) => mergeMessages(previous, [message]));
        setDraft('');
        setAttachment(null);
        setAttachmentError('');
      }
      await loadConversations();
      await refreshRef.current({ quiet: true });
    } catch (cause) {
      if (activeRef.current === conversationId && cause.name !== 'AbortError')
        setSendError(
          cause.message ||
            'Не удалось подтвердить отправку. Текст сохранён, повторная отправка защищена от дубликатов.',
        );
    } finally {
      sendFlight.current = false;
      setSending('');
    }
  }

  return (
    <>
      <div className="social-messaging-toplinks">
        <Link href="/community?tab=friends">Найти друзей</Link>
        <Link href="/notifications">Уведомления</Link>
      </div>
      {listError && (
        <div className="notice notice-error social-messaging-notice" role="alert">
          <span>{listError}</span>
          <AppButton className="btn btn-ghost" onClick={() => loadConversations()}>
            Повторить
          </AppButton>
        </div>
      )}
      <div
        className={`social-messages-layout${activeId ? ' has-active-chat' : ''}${showList ? ' show-conversations' : ''}`}
      >
        <section className="social-conversations" aria-label="Ваши диалоги">
          <div className="social-conversations-heading">
            <h2>Диалоги</h2>
            <AppButton
              className="icon-button"
              aria-label="Обновить диалоги"
              onClick={() => loadConversations()}
            >
              <Icon name="refresh" />
            </AppButton>
          </div>
          {!listReady && (
            <p className="social-messaging-status" role="status">
              Загружаем диалоги…
            </p>
          )}
          {opening && (
            <p className="social-messaging-status" role="status">
              Открываем переписку…
            </p>
          )}
          {listReady && !conversations.length && (
            <div className="social-messaging-empty-note">
              <Icon name="user" size={30} />
              <h3>Начните разговор</h3>
              <p>Откройте профиль друга и нажмите «Написать». Здесь появится ваша переписка.</p>
              <Link href="/community?tab=people">Найти людей</Link>
            </div>
          )}
          <ul className="social-conversation-list">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <AppButton
                  className={`social-conversation-button${conversation.id === activeId ? ' is-active' : ''}`}
                  aria-current={conversation.id === activeId ? 'true' : undefined}
                  onClick={() => selectConversation(conversation)}
                >
                  <PeerAvatar peer={conversation.peer} />
                  <span className="social-conversation-copy">
                    <strong>{conversation.peer?.name || 'Пользователь'}</strong>
                    <span>
                      {conversation.lastMessage?.text ||
                        (conversation.lastMessage ? 'Образ' : 'Начните разговор')}
                    </span>
                    {conversation.lastMessage && (
                      <time dateTime={conversation.lastMessage.createdAt}>
                        {displayDate(conversation.lastMessage.createdAt)}
                      </time>
                    )}
                  </span>
                  {conversation.unreadCount > 0 && (
                    <span
                      className="social-unread-badge"
                      aria-label={`${conversation.unreadCount} непрочитанных`}
                    >
                      {Math.min(conversation.unreadCount, 99)}
                      {conversation.unreadCount > 99 ? '+' : ''}
                    </span>
                  )}
                </AppButton>
              </li>
            ))}
          </ul>
        </section>

        <section className="social-chat" aria-label="Переписка">
          {!activeId ? (
            <EmptyState
              icon="user"
              title="Стиль объединяет"
              description="Выберите диалог или напишите человеку из его профиля."
            />
          ) : (
            <>
              <header className="social-chat-heading">
                <AppButton
                  className="icon-button social-chat-back"
                  aria-label="Вернуться к диалогам"
                  onClick={() => setShowList(true)}
                >
                  <Icon name="chevron-left" />
                </AppButton>
                <PeerAvatar peer={current?.peer} />
                <div className="social-chat-peer">
                  {current?.peer?.username ? (
                    <Link href={'/people/' + encodeURIComponent(current.peer.username)}>
                      {current.peer.name}
                    </Link>
                  ) : (
                    <strong>{opening ? 'Открываем диалог…' : 'Переписка'}</strong>
                  )}
                  {current?.peer?.username && <span>@{current.peer.username}</span>}
                </div>
                <AppButton
                  className="icon-button"
                  aria-label="Обновить переписку"
                  onClick={() => loadMessages(activeId, undefined, !messagesReady)}
                >
                  <Icon name="refresh" />
                </AppButton>
                <MessageSearch
                  key={activeId}
                  conversationId={activeId}
                  peerName={current?.peer?.name}
                />
              </header>
              <div
                className="social-chat-scroll"
                ref={logRef}
                tabIndex={0}
                aria-label="История сообщений"
              >
                {before && (
                  <AppButton
                    className="btn btn-secondary social-chat-older"
                    disabled={loadingOlder}
                    onClick={olderMessages}
                  >
                    {loadingOlder ? 'Загружаем…' : 'Ранние сообщения'}
                  </AppButton>
                )}
                {!messagesReady && (
                  <p className="social-messaging-status" role="status">
                    Загружаем переписку…
                  </p>
                )}
                {messagesReady && !messages.length && !messageError && (
                  <p className="social-chat-first-message">
                    Начните с приветствия или поделитесь образом.
                  </p>
                )}
                <ol className="social-chat-log" aria-live="polite" aria-relevant="additions">
                  {messages.map((message) => (
                    <li
                      key={message.id}
                      className={`social-chat-message${message.senderId === user.id ? ' is-own' : ''}`}
                    >
                      <span className="sr-only">
                        {message.senderId === user.id ? 'Вы' : current?.peer?.name || 'Собеседник'}
                        :{' '}
                      </span>
                      {message.text && <p>{message.text}</p>}
                      {message.post &&
                        (message.post.unavailable ? (
                          <span className="social-shared-post is-unavailable">
                            Образ больше недоступен
                          </span>
                        ) : (
                          <Link
                            className="social-shared-post"
                            href={'/community?' + new URLSearchParams({ post: message.post.id })}
                          >
                            <Icon name="outfits" />
                            <span>{message.post.title || 'Посмотреть образ'}</span>
                            <Icon name="arrow-right" />
                          </Link>
                        ))}
                      <time
                        dateTime={message.createdAt}
                        title={displayDate(message.createdAt, true)}
                      >
                        {displayDate(message.createdAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              </div>
              {messageError && (
                <p className="notice notice-error social-chat-error" role="alert">
                  {messageError}
                </p>
              )}
              {current && !canSend && (
                <p className="notice social-chat-policy" role="status">
                  Сейчас отправка сообщений недоступна. Возможно, переписка разрешена только друзьям
                  или профиль ограничил общение.
                </p>
              )}
              <form
                id="social-message-form"
                className="social-message-composer"
                onSubmit={sendMessage}
              >
                {attachment && (
                  <div className="social-message-attachment">
                    <Icon name="outfits" />
                    <span>{attachment.title || 'Прикреплённый образ'}</span>
                    <AppButton
                      className="icon-button"
                      aria-label="Убрать прикреплённый образ"
                      disabled={sending === activeId}
                      onClick={() => setAttachment(null)}
                    >
                      <Icon name="close" />
                    </AppButton>
                  </div>
                )}
                <Field
                  label="Сообщение"
                  hint="Отправка доступна по настройкам собеседника. До 2000 символов."
                >
                  <textarea
                    name="message"
                    rows={3}
                    maxLength={2000}
                    placeholder="Напишите что-нибудь…"
                    value={draft}
                    disabled={!canSend || sending === activeId}
                    onChange={(event) => changeDraft(event.target.value)}
                  />
                </Field>
                {attachmentOpen && (
                  <div className="social-attach-form">
                    <Field label="Ссылка на образ MyCloset">
                      <input
                        name="postLink"
                        type="text"
                        maxLength={2048}
                        placeholder="Вставьте ссылку на публикацию"
                        value={attachmentInput}
                        onChange={(event) => setAttachmentInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void attachPost();
                          }
                        }}
                        disabled={!canSend || sending === activeId || attaching}
                      />
                    </Field>
                    <AppButton
                      className="btn btn-secondary"
                      disabled={
                        !attachmentInput.trim() || !canSend || sending === activeId || attaching
                      }
                      onClick={attachPost}
                    >
                      {attaching ? 'Прикрепляем…' : 'Прикрепить'}
                    </AppButton>
                  </div>
                )}
                {attachmentError && (
                  <p className="form-error" role="alert">
                    {attachmentError}
                  </p>
                )}
                {sendError && (
                  <p className="form-error" role="alert">
                    {sendError}
                  </p>
                )}
                <div className="social-message-compose-actions">
                  <AppButton
                    className="btn btn-ghost"
                    disabled={!canSend || sending === activeId}
                    onClick={() => setAttachmentOpen((value) => !value)}
                  >
                    <Icon name="outfits" />
                    {attachmentOpen ? 'Скрыть ссылку' : 'Прикрепить образ'}
                  </AppButton>
                  <span className="social-message-length">{draft.length}/2000</span>
                  <AppButton
                    type="submit"
                    className="btn btn-primary"
                    disabled={!canSend || !!sending || attaching || (!draft.trim() && !attachment)}
                  >
                    {sending === activeId ? 'Отправляем…' : 'Отправить'}
                    <Icon name="arrow-right" />
                  </AppButton>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function MessagesGate() {
  const { user } = useSocial();
  return (
    <SocialGate>
      <MessagesContent key={user?.id || 'guest'} />
    </SocialGate>
  );
}

export default function MessagesPage() {
  return (
    <div className="social-messaging-page">
      <PageHeader
        eyebrow="ЛЮДИ И ВДОХНОВЕНИЕ"
        title="Сообщения"
        description="Обсуждайте находки и делитесь образами с друзьями."
      />
      <Suspense fallback={<Loading />}>
        <MessagesGate />
      </Suspense>
    </div>
  );
}
