import Link from 'next/link';
export default function NotFound() { return <main className="standalone-page"><p className="eyebrow">MYCLOSET · 404</p><h1>Эта страница пока не в вашем гардеробе</h1><p>Вернитесь в своё пространство — любимые вещи уже там.</p><Link href="/" className="button button-primary">Открыть MyCloset</Link></main>; }
