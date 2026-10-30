BEGIN;

ALTER TABLE public.mycloset_posts ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE public.mycloset_posts ADD COLUMN IF NOT EXISTS client_fingerprint text;
CREATE UNIQUE INDEX IF NOT EXISTS mycloset_posts_idempotency_idx
  ON public.mycloset_posts(user_id,client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.mycloset_write_quotas (
  user_id text NOT NULL REFERENCES public.mycloset_profiles(user_id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('messages','comments','friend_requests','posts','reports')),
  bucket_start timestamptz NOT NULL,
  used integer NOT NULL CHECK (used>0),
  expires_at timestamptz NOT NULL CHECK (expires_at>bucket_start),
  PRIMARY KEY (user_id,category,bucket_start)
);
CREATE INDEX IF NOT EXISTS mycloset_write_quotas_expiration_idx
  ON public.mycloset_write_quotas(expires_at);

COMMENT ON TABLE public.mycloset_write_quotas IS 'Transactional per-user write allowances. Successful idempotent retries and read actions do not consume allowance; expired rows are cleaned in fixed batches.';

COMMIT;
