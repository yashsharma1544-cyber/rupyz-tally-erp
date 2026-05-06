-- ============================================================================
-- 18a — Add 'driver' value to user_role enum.
--
-- IMPORTANT: Postgres requires this to be committed before the new value can
-- be referenced (e.g. in WHERE role = 'driver'). Supabase wraps SQL editor
-- scripts in a transaction, so the rest of the migration must run as a
-- separate script (see 18b).
--
-- This file contains ONLY the enum change. Run it first, then run 18b.
-- ============================================================================

alter type user_role add value if not exists 'driver';

-- Verify (should now include 'driver'):
--   select unnest(enum_range(null::user_role));
