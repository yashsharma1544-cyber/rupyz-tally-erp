-- ============================================================================
-- ONE-TIME SETUP — paste your Rupyz session into the database.
--
-- HOW TO GET THESE VALUES:
-- 1. Sign into https://app.rupyz.com in Chrome
-- 2. F12 → Network → Fetch/XHR
-- 3. After signing in, look for the request named "logged_in/"
-- 4. Click it → Response tab → find the "credentials" object:
--      "credentials": {
--        "access_token":  "...30-char string...",
--        "refresh_token": "...30-char string...",
--        "expires_in":    2592000     <-- this is 30 days in seconds
--      }
-- 5. Also note "user_id" near the top of the response.
-- 6. Paste them below and run this whole file in Supabase SQL Editor.
--
-- The org_id (17188) and username are already filled in for Sushil Agencies.
-- ============================================================================

insert into rupyz_session (
    id, org_id, user_id, username, access_token, refresh_token, expires_at
)
values (
    1,
    17188,
    '1643761',
    '91-9028901902',
    'qy9EtDRuhD42dzeLiJ5oDtSmeLZM7O',
    '7vO5PoxMr5NDrreNnLMIudwaSBRJPh',
    now() + interval '30 days'
)
on conflict (id) do update set
    access_token      = excluded.access_token,
    refresh_token     = excluded.refresh_token,
    expires_at        = excluded.expires_at,
    last_refreshed_at = now(),
    updated_at        = now();

-- verify
select id, org_id, username, expires_at, last_refreshed_at,
       length(access_token) as access_len,
       length(refresh_token) as refresh_len
from rupyz_session;
