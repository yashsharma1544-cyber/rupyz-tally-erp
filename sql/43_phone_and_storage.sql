-- 43_phone_and_storage.sql
-- Phase 4 — WATi integration prerequisites
--
-- 1. Add phone column to app_users (admin uses this for daily reports)
-- 2. Create the sales-reports Storage bucket (PDFs are uploaded here and
--    served to WATi via signed URLs)

-- ---------------------------------------------------------------------------
-- 1. Phone column on app_users
-- ---------------------------------------------------------------------------
alter table app_users add column if not exists phone text;

comment on column app_users.phone is
  'WhatsApp number in E.164 without + sign (e.g. 919860748060). '
  'Used by Sales Monitor to send daily reports to admins.';

-- ---------------------------------------------------------------------------
-- 2. Storage bucket for daily report PDFs
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('sales-reports', 'sales-reports', false)
on conflict (id) do nothing;

-- No RLS policies needed — backend uploads via service role which bypasses RLS.
-- PDFs are served to WhatsApp via short-lived signed URLs (no auth on the URL).

-- ---------------------------------------------------------------------------
-- 3. (run separately, after you UPDATE your phone) Reload PostgREST schema
-- ---------------------------------------------------------------------------
-- After running this migration, set the admin phone:
--   update app_users set phone = '919XXXXXXXXX' where id = 'YOUR-USER-ID';
-- Then reload the PostgREST schema cache:
--   notify pgrst, 'reload schema';
