'use client';

import { AppButton } from '@/components/ui/app-button.jsx';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { useSocial } from '@/components/providers/social-provider.jsx';
import ItemForm from '@/components/forms/item-form.jsx';
import ThemePicker from '@/components/ui/theme-picker.jsx';
import QuickSearch from '@/components/layout/quick-search.jsx';
import { Icon, Loading, Modal } from '@/components/ui/ui.jsx';

const navigation = [
  { href: '/', key: 'home', label: 'Обзор', icon: 'home' },
  { href: '/wardrobe', key: 'wardrobe', label: 'Мой гардероб', icon: 'wardrobe' },
  { href: '/stylist', key: 'stylist', label: 'Стилист', icon: 'sparkle' },
  { href: '/outfits', key: 'outfits', label: 'Мои образы', icon: 'outfits' },
  { href: '/shopping-list', key: 'shopping', label: 'Покупки', icon: 'shopping' },
  { href: '/favorites', key: 'favorites', label: 'Избранное', icon: 'heart' },
  { href: '/calendar', key: 'calendar', label: 'Календарь', icon: 'calendar' },
  { href: '/collections', key: 'collections', label: 'Коллекции и поездки', icon: 'briefcase' },
  { href: '/insights', key: 'insights', label: 'История и статистика', icon: 'chart' },
  { href: '/community', key: 'community', label: 'Сообщество', icon: 'users' },
  { href: '/messages', key: 'messages', label: 'Сообщения', icon: 'message' },
  { href: '/notifications', key: 'notifications', label: 'Уведомления', icon: 'bell' },
];
const secondary = [
  { href: '/account', key: 'account', label: 'Аккаунт', icon: 'user' },
  { href: '/devices', key: 'devices', label: 'На ваших устройствах', icon: 'phone' },
  { href: '/settings', key: 'settings', label: 'Настройки', icon: 'settings' },
];
const mobile = [
  { href: '/', key: 'home', label: 'Главная', icon: 'home' },
  { href: '/wardrobe', key: 'wardrobe', label: 'Гардероб', icon: 'wardrobe' },
  { href: '/outfits', key: 'outfits', label: 'Образы', icon: 'outfits' },
  { href: '/stylist', key: 'stylist', label: 'Стилист', icon: 'sparkle' },
  { href: '/calendar', key: 'calendar', label: 'Календарь', icon: 'calendar' },
];
const moreItems = [
  {
    href: '/community',
    key: 'community',
    label: 'Сообщество',
    icon: 'users',
    description: 'Лента, профили и друзья',
  },
  {
    href: '/messages',
    key: 'messages',
    label: 'Сообщения',
    icon: 'message',
    description: 'Личная переписка и образы',
  },
  {
    href: '/notifications',
    key: 'notifications',
    label: 'Уведомления',
    icon: 'bell',
    description: 'Заявки, комментарии и новые сообщения',
  },
  {
    href: '/account',
    key: 'account',
    label: 'Аккаунт',
    icon: 'user',
    description: 'Вход и облачный гардероб',
  },
  {
    href: '/collections',
    key: 'collections',
    label: 'Коллекции и поездки',
    icon: 'briefcase',
    description: 'Капсулы и список вещей в чемодан',
  },
  {
    href: '/insights',
    key: 'insights',
    label: 'История и статистика',
    icon: 'chart',
    description: 'Что вы носите и что давно ждёт выхода',
  },
  {
    href: '/shopping-list',
    key: 'shopping',
    label: 'Покупки',
    icon: 'shopping',
    description: 'Желания и продуманный бюджет',
  },
  {
    href: '/favorites',
    key: 'favorites',
    label: 'Избранное',
    icon: 'heart',
    description: 'Любимые вещи и образы',
  },
  {
    href: '/devices',
    key: 'devices',
    label: 'На ваших устройствах',
    icon: 'phone',
    description: 'Ссылка, QR-код и установка',
  },
  {
    href: '/settings',
    key: 'settings',
    label: 'Настройки',
    icon: 'settings',
    description: 'Профиль и резервные копии',
  },
];

export default function MyClosetShell({ children }) {
  const { ready: closetReady, ownerId, storageMode, error } = useCloset();
  const cloud = useCloudSync();
  const social = useSocial();
  const ready = closetReady && !cloud.sessionLoading && ownerId === (cloud.user?.id || '');
  const pathname = usePathname();
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [online, setOnline] = useState(null);
  useEffect(() => {
    if (!ready) setSearching(false);
  }, [ready, ownerId]);
  useEffect(() => {
    const shortcut = (event) => {
      if (
        !ready ||
        event.isComposing ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'k'
      )
        return;
      if (document.querySelector('[role="dialog"]') && !searching) return;
      event.preventDefault();
      setSearching(true);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [ready, searching]);
  const active = (href) =>
    href === '/'
      ? pathname === '/'
      : pathname === href ||
        pathname.startsWith(`${href}/`) ||
        (href === '/settings' && pathname === '/profile') ||
        (href === '/community' && pathname.startsWith('/people/'));
  const current = [...navigation, ...secondary].find((item) => active(item.href));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    setMore(false);
  }, [pathname]);
  function navLink(item) {
    return (
      <Link
        key={item.key}
        href={item.href}
        data-nav={item.key}
        className={`nav-item${active(item.href) ? ' is-active' : ''}`}
        aria-current={active(item.href) ? 'page' : undefined}
      >
        <Icon name={item.icon} />
        <span>{item.label}</span>
        {social.counts[item.key] > 0 && (
          <span className="social-nav-count">{Math.min(social.counts[item.key], 99)}</span>
        )}
        {item.key === 'home' && <span className="nav-dot" />}
      </Link>
    );
  }
  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <div className="app-shell">
        <aside className="sidebar" aria-label="Основная навигация">
          <Link className="brand" href="/" data-nav="home" aria-label="MyCloset — главная">
            <span className="brand-mark">
              <Icon name="hanger" />
            </span>
            <span>
              My<span className="brand-accent">Closet</span>
              <small>ВАШ ЛИЧНЫЙ СТИЛЬ</small>
            </span>
          </Link>
          <div className="nav-caption">МОЁ ПРОСТРАНСТВО</div>
          <nav className="desktop-nav">{navigation.map(navLink)}</nav>
          <div className="sidebar-style-note">
            <Icon name="sparkle" />
            <strong>Место для вашего стиля</strong>
            <p>Любимые вещи. Новые сочетания. Немного вдохновения каждый день.</p>
          </div>
          <div className="sidebar-bottom">
            {secondary.map(navLink)}
            <div className="local-note">
              <span className="status-dot" />
              <span>Сохраняется на этом устройстве</span>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="app-header">
            <div className="header-breadcrumb">
              <span>MyCloset</span>
              <span aria-hidden="true">/</span>
              <strong id="current-page">{current?.label || 'MyCloset'}</strong>
            </div>
            <div className="header-actions">
              <AppButton
                className="icon-btn header-quick-search"
                disabled={!ready}
                aria-label="Поиск по сайту, Ctrl+K"
                aria-keyshortcuts="Control+K Meta+K"
                onClick={() => setSearching(true)}
              >
                <Icon name="search" />
              </AppButton>
              <span
                className={`connection-status header-connection${online === false ? ' is-offline' : ''}`}
                data-platform-status
              >
                {online === null ? '' : online ? 'В сети' : 'Без интернета'}
              </span>
              <Link
                className="icon-btn header-device"
                href="/devices"
                data-nav="devices"
                aria-label="Открыть MyCloset на телефоне"
              >
                <Icon name="phone" />
              </Link>
              <ThemePicker compact />
              <Link
                className="icon-btn social-header-link"
                href="/notifications"
                aria-label={`Уведомления${social.counts.notifications ? `: ${social.counts.notifications} непрочитанных` : ''}`}
              >
                <Icon name="bell" />
                {social.counts.notifications > 0 && <span className="social-header-dot" />}
              </Link>
              <div id="add-item-root">
                <AppButton
                  id="add-item"
                  className="btn btn-primary"
                  type="button"
                  disabled={!ready}
                  onClick={() => setAdding(true)}
                >
                  <Icon name="plus" />
                  <span>Добавить вещь</span>
                </AppButton>
              </div>
              <Link
                className="header-profile icon-btn"
                href={
                  social.profile
                    ? `/people/${social.profile.username}`
                    : social.user
                      ? '/community?tab=profile'
                      : '/settings'
                }
                data-nav={social.user ? 'community' : 'settings'}
                aria-label={social.user ? 'Открыть мой профиль' : 'Открыть настройки профиля'}
              >
                <Icon name={social.user ? 'user' : 'settings'} />
              </Link>
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            {ready && storageMode === 'memory' && (
              <div className="notice error-notice" role="status">
                <Icon name="image" />
                <div>
                  <strong>Сейчас данные хранятся только до закрытия страницы.</strong>
                  <br />
                  {error} Сохраните резервную копию в настройках.
                </div>
              </div>
            )}
            {ready ? children : <Loading />}
          </main>
          <footer className="app-footer">
            <span>
              MyCloset <span aria-hidden="true">·</span> Ваш личный гардероб
            </span>
            <span>Больше любимых сочетаний каждый день.</span>
          </footer>
        </div>
      </div>
      <nav className="mobile-nav" aria-label="Основная навигация на телефоне">
        {mobile.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            data-nav={item.key}
            className={active(item.href) ? 'is-active' : ''}
            aria-current={active(item.href) ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
        <AppButton
          type="button"
          data-action="open-more"
          className={moreItems.some((item) => active(item.href)) ? 'is-active' : ''}
          onClick={() => setMore(true)}
          aria-label="Открыть все разделы"
        >
          <Icon name="more" />
          <span>Ещё</span>
        </AppButton>
      </nav>
      {more && (
        <Modal title="Ещё для вашего стиля" onClose={() => setMore(false)}>
          <nav className="more-menu">
            <AppButton
              className="more-menu-link"
              disabled={!ready}
              onClick={() => {
                setMore(false);
                setSearching(true);
              }}
            >
              <Icon name="search" />
              <span>
                <strong>Найти в MyCloset</strong>
                <small>Вещи, образы и покупки</small>
              </span>
              <Icon name="arrow-right" />
            </AppButton>
            {moreItems.map((item) => (
              <Link
                className="more-menu-link"
                key={item.key}
                href={item.href}
                data-nav={item.key}
                onClick={() => setMore(false)}
              >
                <Icon name={item.icon} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <Icon name="arrow-right" />
              </Link>
            ))}
          </nav>
        </Modal>
      )}
      {adding && <ItemForm onClose={() => setAdding(false)} />}
      {searching && ready && (
        <QuickSearch key={ownerId || 'guest'} onClose={() => setSearching(false)} />
      )}
    </>
  );
}
