BEGIN;

CREATE TABLE IF NOT EXISTS public.mycloset_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  messages boolean NOT NULL DEFAULT false,
  outfits boolean NOT NULL DEFAULT false,
  time_zone text NOT NULL DEFAULT 'UTC' CHECK (char_length(time_zone) BETWEEN 1 AND 80),
  reminder_hour integer NOT NULL DEFAULT 20 CHECK (reminder_hour BETWEEN 0 AND 23),
  messages_enabled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mycloset_push_subscriptions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  session_id uuid,
  endpoint text NOT NULL UNIQUE CHECK (octet_length(endpoint) <= 2048),
  p256dh text NOT NULL CHECK (char_length(p256dh) BETWEEN 80 AND 100),
  auth text NOT NULL CHECK (char_length(auth) BETWEEN 20 AND 30),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mycloset_push_subscriptions_owner_idx
  ON public.mycloset_push_subscriptions(user_id, created_at);
ALTER TABLE public.mycloset_push_subscriptions ADD COLUMN IF NOT EXISTS session_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mycloset_push_subscription_session_fk'
    AND conrelid='public.mycloset_push_subscriptions'::regclass) THEN
    ALTER TABLE public.mycloset_push_subscriptions ADD CONSTRAINT mycloset_push_subscription_session_fk
      FOREIGN KEY(session_id) REFERENCES neon_auth.session(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mycloset_push_deliveries (
  subscription_id text NOT NULL REFERENCES public.mycloset_push_subscriptions(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (char_length(event_key) <= 200),
  kind text NOT NULL CHECK (kind IN ('message','outfit')),
  status text NOT NULL CHECK (status IN ('sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 3),
  lease_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id,event_key)
);
CREATE INDEX IF NOT EXISTS mycloset_push_deliveries_cleanup_idx
  ON public.mycloset_push_deliveries(created_at);

ALTER TABLE public.mycloset_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mycloset_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mycloset_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mycloset_notification_preferences FROM PUBLIC;
REVOKE ALL ON TABLE public.mycloset_push_subscriptions FROM PUBLIC;
REVOKE ALL ON TABLE public.mycloset_push_deliveries FROM PUBLIC;

COMMIT;
