-- JSON preserves the full backup format, including escaped NUL and lone surrogates.
-- Existing JSONB snapshots convert losslessly; all steps run in one transaction.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mycloset_wardrobes' AND column_name='snapshot' AND data_type='jsonb') THEN
    ALTER TABLE public.mycloset_wardrobes DROP CONSTRAINT IF EXISTS mycloset_wardrobes_snapshot_check;
    ALTER TABLE public.mycloset_wardrobes ALTER COLUMN snapshot TYPE json USING snapshot::json;
    ALTER TABLE public.mycloset_wardrobes ADD CONSTRAINT mycloset_wardrobes_snapshot_check CHECK (json_typeof(snapshot)='object');
  END IF;
END $$;
COMMIT;
