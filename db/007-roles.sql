BEGIN;

-- Two application roles: 'user' (default) and 'admin'. Admins review reports,
-- remove reported posts, block accounts and assign roles in /admin.
ALTER TABLE public.mycloset_profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE public.mycloset_profiles ADD COLUMN IF NOT EXISTS banned_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mycloset_profiles_role_check' AND conrelid='public.mycloset_profiles'::regclass) THEN
    ALTER TABLE public.mycloset_profiles ADD CONSTRAINT mycloset_profiles_role_check CHECK (role IN ('user','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mycloset_profiles_admin_not_banned' AND conrelid='public.mycloset_profiles'::regclass) THEN
    ALTER TABLE public.mycloset_profiles ADD CONSTRAINT mycloset_profiles_admin_not_banned CHECK (role <> 'admin' OR banned_at IS NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS mycloset_profiles_admin_idx ON public.mycloset_profiles(role) WHERE role='admin';

ALTER TABLE public.mycloset_reports ADD COLUMN IF NOT EXISTS decision text;
ALTER TABLE public.mycloset_reports ADD COLUMN IF NOT EXISTS resolved_by text REFERENCES public.mycloset_profiles(user_id) ON DELETE SET NULL;
ALTER TABLE public.mycloset_reports ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mycloset_reports_decision_check' AND conrelid='public.mycloset_reports'::regclass) THEN
    ALTER TABLE public.mycloset_reports ADD CONSTRAINT mycloset_reports_decision_check CHECK (decision IS NULL OR decision IN ('dismiss','remove'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS mycloset_reports_target_idx ON public.mycloset_reports(target_type,target_id,status);

COMMIT;
