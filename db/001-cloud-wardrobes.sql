CREATE TABLE IF NOT EXISTS public.mycloset_wardrobes (
  user_id text PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  snapshot json NOT NULL CHECK (json_typeof(snapshot) = 'object'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.mycloset_wardrobes IS 'Private validated MyCloset snapshots; API ownership always comes from the authenticated session.';
