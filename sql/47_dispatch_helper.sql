-- ============================================================================
-- 47 — Helper on dispatches
--
-- Adds helper_user_id to dispatches. A helper is an app_user (typically with
-- role 'van_helper') who accompanies the driver on a delivery truck. If
-- assigned, they can open /driver and POD the delivery same as the driver.
--
-- NULL means no helper assigned (the default; backwards-compatible).
-- ============================================================================

alter table dispatches
  add column if not exists helper_user_id uuid references app_users(id);

comment on column dispatches.helper_user_id is
  'Optional helper app_user (typically van_helper role) accompanying the driver. NULL = no helper.';
