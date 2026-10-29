// Server routes only: the connection string is never a public environment variable.
import pg from 'pg';

let pool;
function database() {
  if (!pool) {
    const connection = new URL(process.env.DATABASE_URL);
    connection.searchParams.delete('sslmode');
    pool = new pg.Pool({ connectionString: connection.href, ssl: { rejectUnauthorized: true }, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000, query_timeout: 25000 });
    pool.on('error', error => console.error('MyCloset database connection error:', error.code || 'CONNECTION_ERROR'));
  }
  return pool;
}
const metadata = row => row ? { revision: Number(row.revision), hash: row.snapshot_hash, updatedAt: new Date(row.updated_at).toISOString() } : { revision: 0, hash: '', updatedAt: null };
export const cloudStorage = {
  async read(userId, knownRevision) {
    const { rows } = await database().query('SELECT revision,snapshot_hash,updated_at FROM public.mycloset_wardrobes WHERE user_id=$1', [userId]);
    if (!rows.length) return { ...metadata(null), snapshot: null };
    if (knownRevision === Number(rows[0].revision)) return { ...metadata(rows[0]), notModified: true };
    // One complete read gives a consistent snapshot/revision if a writer raced the metadata lookup.
    const full = await database().query('SELECT revision,snapshot_hash,updated_at,snapshot FROM public.mycloset_wardrobes WHERE user_id=$1', [userId]);
    return full.rows.length ? { ...metadata(full.rows[0]), snapshot: full.rows[0].snapshot } : { ...metadata(null), snapshot: null };
  },
  async write(userId, revision, snapshot, hash) {
    const json = JSON.stringify(snapshot);
    const result = revision === 0
      ? await database().query('INSERT INTO public.mycloset_wardrobes (user_id,revision,snapshot,snapshot_hash) VALUES($1,1,$2::json,$3) ON CONFLICT(user_id) DO NOTHING RETURNING revision,snapshot_hash,updated_at', [userId, json, hash])
      : await database().query('UPDATE public.mycloset_wardrobes SET revision=revision+1,snapshot=$3::json,snapshot_hash=$4,updated_at=now() WHERE user_id=$1 AND revision=$2 RETURNING revision,snapshot_hash,updated_at', [userId, revision, json, hash]);
    return result.rows.length ? metadata(result.rows[0]) : null;
  }
};
