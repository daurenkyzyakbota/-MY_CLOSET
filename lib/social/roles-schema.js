// Applies migration 007 (roles) automatically the first time the community is
// used, so a site updated before `npm run db:setup` keeps working instead of
// failing on the missing role columns. Keep in sync with db/007-roles.sql
// (a test compares them).
export const ROLES_MIGRATION = `-- Two application roles: 'user' (default) and 'admin'. Admins review reports,
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
CREATE INDEX IF NOT EXISTS mycloset_reports_target_idx ON public.mycloset_reports(target_type,target_id,status);`;

const CHECK =
  "SELECT count(*)::int AS present FROM information_schema.columns WHERE table_schema='public' AND table_name='mycloset_profiles' AND column_name IN ('role','banned_at')";

export async function ensureRolesSchema(pool) {
  const { rows } = await pool.query(CHECK);
  if (rows[0]?.present === 2) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Several server instances may start at once; only one applies the migration.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mycloset:migration:007',0))");
    await client.query(ROLES_MIGRATION);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function rolesSchemaGuard(getPool, report = () => {}) {
  let ready = null;
  return () =>
    (ready ||= ensureRolesSchema(getPool()).then(
      (applied) => {
        if (applied) report('ROLES_MIGRATION_APPLIED');
      },
      (error) => {
        ready = null;
        throw error;
      },
    ));
}
