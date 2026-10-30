'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }) {
  return (
    <div className="empty-state">
      <p className="eyebrow">MYCLOSET</p>
      <h1>Не удалось открыть раздел</h1>
      <p>Попробуйте ещё раз. Сохранённые данные остаются в браузере.</p>
      <div className="empty-actions">
        <button className="button button-primary" onClick={reset}>
          Повторить
        </button>
        <Link className="button button-secondary" href="/">
          На главную
        </Link>
      </div>
    </div>
  );
}
