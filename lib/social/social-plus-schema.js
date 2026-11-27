// Applies migration 008 (follows, polls, comment replies/likes, richer messages)
// automatically the first time the community is used, like roles-schema.js does
// for 007. Keep in sync with db/008-social-plus.sql (a test compares them).
export const SOCIAL_PLUS_MIGRATION = `-- Instagram-style community: one-way follows, «А или Б» polls, comment replies
-- and likes, richer direct messages (photo, reply, reactions), 24-hour stories
-- and @mentions.
CREATE TABLE IF NOT EXISTS public.mycloset_follows (
  follower_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  followee_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending','accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id,followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS mycloset_follows_followee_idx ON public.mycloset_follows(followee_id,status);

CREATE TABLE IF NOT EXISTS public.mycloset_poll_votes (
  post_id text NOT NULL REFERENCES public.mycloset_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  option smallint NOT NULL CHECK (option IN (0,1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id,user_id)
);

ALTER TABLE public.mycloset_comments ADD COLUMN IF NOT EXISTS parent_id text REFERENCES public.mycloset_comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS mycloset_comments_parent_idx ON public.mycloset_comments(parent_id);
CREATE TABLE IF NOT EXISTS public.mycloset_comment_likes (
  comment_id text NOT NULL REFERENCES public.mycloset_comments(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id,user_id)
);

ALTER TABLE public.mycloset_messages ADD COLUMN IF NOT EXISTS reply_to_id text REFERENCES public.mycloset_messages(id) ON DELETE SET NULL;
ALTER TABLE public.mycloset_messages ADD COLUMN IF NOT EXISTS photo text NOT NULL DEFAULT '' CHECK (octet_length(photo) <= 1500000);
-- A message may now be only a photo: replace the old «text or post» rule.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.mycloset_messages'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%had_post%' AND conname<>'mycloset_messages_content_check' LOOP
    EXECUTE format('ALTER TABLE public.mycloset_messages DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mycloset_messages_content_check' AND conrelid='public.mycloset_messages'::regclass) THEN
    ALTER TABLE public.mycloset_messages ADD CONSTRAINT mycloset_messages_content_check CHECK (text <> '' OR had_post OR photo <> '');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.mycloset_message_reactions (
  message_id text NOT NULL REFERENCES public.mycloset_messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('❤️','👍','😂','😮','😢','🔥')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id,user_id)
);

-- Stories: a photo with a caption that disappears after 24 hours.
CREATE TABLE IF NOT EXISTS public.mycloset_stories (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  photo text NOT NULL CHECK (photo <> '' AND octet_length(photo) <= 1500000),
  caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mycloset_stories_user_idx ON public.mycloset_stories(user_id,created_at DESC);

ALTER TABLE public.mycloset_notifications DROP CONSTRAINT IF EXISTS mycloset_notifications_kind_check;
ALTER TABLE public.mycloset_notifications ADD CONSTRAINT mycloset_notifications_kind_check CHECK (kind IN ('friend_request','friend_accepted','message','like','comment','follow','follow_request','reply','mention'));
ALTER TABLE public.mycloset_write_quotas DROP CONSTRAINT IF EXISTS mycloset_write_quotas_category_check;
ALTER TABLE public.mycloset_write_quotas ADD CONSTRAINT mycloset_write_quotas_category_check CHECK (category IN ('messages','comments','friend_requests','posts','reports','follows','stories'));`;

const CHECK = `SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
    AND table_name IN ('mycloset_follows','mycloset_poll_votes','mycloset_comment_likes','mycloset_message_reactions','mycloset_stories'))::int AS tables,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
    AND ((table_name='mycloset_comments' AND column_name='parent_id')
      OR (table_name='mycloset_messages' AND column_name IN ('reply_to_id','photo'))))::int AS columns`;

export async function ensureSocialPlusSchema(pool) {
  const { rows } = await pool.query(CHECK);
  if (rows[0]?.tables === 5 && rows[0]?.columns === 3) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('mycloset:migration:008',0))",
    );
    await client.query(SOCIAL_PLUS_MIGRATION);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
