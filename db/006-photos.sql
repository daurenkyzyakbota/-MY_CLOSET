BEGIN;
ALTER TABLE public.mycloset_wardrobes ADD COLUMN IF NOT EXISTS wire_hash text
  CHECK (wire_hash IS NULL OR wire_hash ~ '^[a-f0-9]{64}$');
CREATE TABLE IF NOT EXISTS public.mycloset_photos (
  user_id text NOT NULL,
  photo_id text NOT NULL CHECK (photo_id ~ '^[a-f0-9]{64}$'),
  characters integer NOT NULL CHECK (characters > 0 AND characters <= 4000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,photo_id)
);
ALTER TABLE public.mycloset_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mycloset_photos FROM PUBLIC;
COMMENT ON TABLE public.mycloset_photos IS 'Private immutable photo objects; keys are scoped to the verified account. No photo bytes in wardrobe JSON.';
COMMIT;
