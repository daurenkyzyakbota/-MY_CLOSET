import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MyClosetClient } from './mycloset-client.jsx';

export default async function HomePage() {
  const shell = await readFile(path.join(process.cwd(), 'public', 'shell.html'), 'utf8');
  return <MyClosetClient shell={shell} />;
}