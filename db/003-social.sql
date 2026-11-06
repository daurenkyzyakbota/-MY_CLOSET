BEGIN;

-- Preserve the original text key and lossless JSON snapshot while making new
-- writes participate in Managed Auth's atomic identity-deletion cascade.
ALTER TABLE public.mycloset_wardrobes ADD COLUMN IF NOT EXISTS auth_user_id uuid;
UPDATE public.mycloset_wardrobes w SET auth_user_id=u.id
FROM neon_auth."user" u WHERE w.user_id=u.id::text AND w.auth_user_id IS NULL;
CREATE INDEX IF NOT EXISTS mycloset_wardrobes_auth_user_idx ON public.mycloset_wardrobes(auth_user_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mycloset_wardrobes_auth_identity_fk' AND conrelid='public.mycloset_wardrobes'::regclass) THEN
    ALTER TABLE public.mycloset_wardrobes ADD CONSTRAINT mycloset_wardrobes_auth_identity_fk
      FOREIGN KEY (auth_user_id) REFERENCES neon_auth."user"(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mycloset_profiles (
  user_id text PRIMARY KEY,
  auth_user_id uuid UNIQUE,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,30}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 500),
  city text NOT NULL DEFAULT '' CHECK (char_length(city) <= 120),
  styles text NOT NULL DEFAULT '' CHECK (char_length(styles) <= 200),
  avatar text NOT NULL DEFAULT '' CHECK (octet_length(avatar) <= 400000),
  private boolean NOT NULL DEFAULT false,
  allow_messages text NOT NULL DEFAULT 'friends' CHECK (allow_messages IN ('friends','everyone')),
  notifications jsonb NOT NULL DEFAULT '{"likes":true,"comments":true,"friends":true,"messages":true}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Identity deletion also removes social data if a client loses its connection
-- before the application's explicit cleanup finishes. Managed Auth itself is unchanged.
ALTER TABLE public.mycloset_profiles ADD COLUMN IF NOT EXISTS auth_user_id uuid;
UPDATE public.mycloset_profiles p SET auth_user_id=u.id
FROM neon_auth."user" u WHERE p.user_id=u.id::text AND p.auth_user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mycloset_profiles_auth_user_idx ON public.mycloset_profiles(auth_user_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mycloset_profiles_auth_identity_fk' AND conrelid='public.mycloset_profiles'::regclass) THEN
    ALTER TABLE public.mycloset_profiles ADD CONSTRAINT mycloset_profiles_auth_identity_fk
      FOREIGN KEY (auth_user_id) REFERENCES neon_auth."user"(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mycloset_account_deletions (
  auth_user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (user_id=auth_user_id::text),
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.mycloset_finish_account_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM neon_auth."user" WHERE id=OLD.auth_user_id) THEN
    DELETE FROM public.mycloset_wardrobes WHERE user_id=OLD.user_id;
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.mycloset_finish_account_deletion() FROM PUBLIC;
DROP TRIGGER IF EXISTS mycloset_finish_account_deletion ON public.mycloset_account_deletions;
CREATE TRIGGER mycloset_finish_account_deletion
  AFTER DELETE ON public.mycloset_account_deletions
  FOR EACH ROW EXECUTE FUNCTION public.mycloset_finish_account_deletion();

CREATE TABLE IF NOT EXISTS public.mycloset_relationships (
  user_a text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  user_b text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  requester_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a,user_b),
  CHECK (user_a < user_b),
  CHECK (requester_id = user_a OR requester_id = user_b)
);
CREATE INDEX IF NOT EXISTS mycloset_relationships_b_idx ON public.mycloset_relationships(user_b,status);

CREATE TABLE IF NOT EXISTS public.mycloset_blocks (
  blocker_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  target_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id,target_id),
  CHECK (blocker_id <> target_id)
);
CREATE INDEX IF NOT EXISTS mycloset_blocks_target_idx ON public.mycloset_blocks(target_id);

CREATE TABLE IF NOT EXISTS public.mycloset_posts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','friends','public')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mycloset_posts_feed_idx ON public.mycloset_posts(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS mycloset_posts_author_idx ON public.mycloset_posts(user_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS public.mycloset_likes (
  post_id text NOT NULL REFERENCES public.mycloset_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.mycloset_saved_posts (
  post_id text NOT NULL REFERENCES public.mycloset_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id,user_id)
);
CREATE INDEX IF NOT EXISTS mycloset_saved_posts_owner_idx ON public.mycloset_saved_posts(user_id,post_id);

CREATE TABLE IF NOT EXISTS public.mycloset_comments (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES public.mycloset_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mycloset_comments_post_idx ON public.mycloset_comments(post_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS public.mycloset_conversations (
  id text PRIMARY KEY,
  user_a text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  user_b text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  read_a_at timestamptz NOT NULL DEFAULT '-infinity',
  read_b_at timestamptz NOT NULL DEFAULT '-infinity',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_a,user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS mycloset_conversations_b_idx ON public.mycloset_conversations(user_b);
CREATE TABLE IF NOT EXISTS public.mycloset_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES public.mycloset_conversations(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  client_id text,
  text text NOT NULL DEFAULT '' CHECK (char_length(text) <= 2000),
  post_id text REFERENCES public.mycloset_posts(id) ON DELETE SET NULL,
  had_post boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (text <> '' OR had_post)
);
ALTER TABLE public.mycloset_messages ADD COLUMN IF NOT EXISTS client_id text;
CREATE UNIQUE INDEX IF NOT EXISTS mycloset_messages_idempotency_idx ON public.mycloset_messages(sender_id,client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mycloset_messages_conversation_idx ON public.mycloset_messages(conversation_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS public.mycloset_notifications (
  id text PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('friend_request','friend_accepted','message','like','comment')),
  post_id text REFERENCES public.mycloset_posts(id) ON DELETE CASCADE,
  conversation_id text REFERENCES public.mycloset_conversations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS mycloset_notifications_owner_idx ON public.mycloset_notifications(recipient_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS mycloset_notifications_unread_idx ON public.mycloset_notifications(recipient_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.mycloset_reports (
  id text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post','profile')),
  target_id text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mycloset_reports_queue_idx ON public.mycloset_reports(status,created_at);

COMMIT;
