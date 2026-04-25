# Phase 2 — Rupyz Sync Deployment Guide

This is a one-time setup. After it's done, orders flow into your ERP automatically every 15 minutes.

---

## Step 1 — Run the schema migration

In **Supabase → SQL Editor**, paste and run **`sql/04_phase2_orders.sql`**.

This creates the `orders`, `order_items`, `rupyz_session`, and `rupyz_sync_log` tables, plus adds `rupyz_id` columns to your existing tables.

Verify it worked:
```sql
select count(*) from orders;       -- expect 0
select count(*) from order_items;  -- expect 0
select * from rupyz_session;       -- expect empty
```

---

## Step 2 — Seed your Rupyz session token

**(One-time only — done from your laptop in Chrome.)**

1. Sign into `https://app.rupyz.com` in Chrome
2. Press **F12** → **Network** tab → filter **Fetch/XHR** → click 🚫 to clear
3. Sign out, then sign in again with phone + OTP
4. After sign-in, find the request named **`logged_in/`**
5. Click it → **Response** tab → look for the `credentials` block:
   ```json
   "credentials": {
     "access_token":  "Tj1YKMBaetbXpoXmAvXtul5NjznQkm",
     "refresh_token": "50nJKHtSmc9AzG7nOemWJdDpPU1dsi",
     "expires_in":    2592000
   }
   ```
6. Open **`sql/05_seed_rupyz_session.sql`**, replace the two `PASTE-...-HERE` lines with your actual tokens
7. Paste the modified SQL into Supabase SQL Editor and run

Verify:
```sql
select id, org_id, username, expires_at,
       length(access_token) as access_len
from rupyz_session;
```
You should see one row, `access_len` around 30.

> **Token lifetime: 30 days.** The scraper will auto-refresh whenever Rupyz returns 401, so you usually never need to repeat this. If refresh ever fails (rare), the sync log will say so and you re-run this step.

---

## Step 3 — Deploy the Edge Function

In your **local terminal**, from the `rupyz-tally-erp` folder:

```bash
# Install Supabase CLI if you don't have it
npm install -g supabase

# Login
supabase login

# Link to your project (find ref in Supabase URL)
supabase link --project-ref YOUR-PROJECT-REF

# Deploy the function
supabase functions deploy rupyz-sync --no-verify-jwt
```

The `--no-verify-jwt` flag means the function can be called by `pg_cron` (and your manual sync button) without a user JWT. We protect it with an optional shared secret instead (next step).

---

## Step 4 — (Optional but recommended) Set the shared secret

In **Supabase → Edge Functions → rupyz-sync → Manage secrets**:

```
RUPYZ_SYNC_SECRET = <any-random-string-of-your-choice>
RUPYZ_MAX_PAGES   = 5     (how many pages to scan per sync; default fine)
```

Then in your **Vercel project → Settings → Environment Variables**, add the same:
```
RUPYZ_SYNC_SECRET = <same-string-as-above>
```

Redeploy your Vercel app so the env var takes effect.

---

## Step 5 — Test the sync manually

Sign into your ERP, go to **Settings**. You should see the "Rupyz sync" panel showing the session info. Click **"Run sync now"**.

Watch the log table at the bottom — within 5-30 seconds you should see a new row appear with status `success` and a count of inserted orders.

Now go to **Orders** in the sidebar — you should see today's orders streaming in.

---

## Step 6 — Schedule the cron

In **Supabase → SQL Editor**, run this (replace `YOUR-PROJECT-REF` and `YOUR-RUPYZ-SYNC-SECRET`):

```sql
-- Enable pg_cron + pg_net extensions if not already
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schedule sync every 15 minutes
select cron.schedule(
  'rupyz-sync-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/rupyz-sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-trigger', 'cron',
      'x-rupyz-sync-secret', 'YOUR-RUPYZ-SYNC-SECRET'
    )
  );
  $$
);

-- View scheduled jobs
select * from cron.job;
```

To stop the cron later:
```sql
select cron.unschedule('rupyz-sync-15min');
```

---

## Troubleshooting

**"No session row in rupyz_session"** — you skipped Step 2. Re-do it.

**"Refresh failed 401"** — your refresh token has expired or been revoked (e.g., you logged out from Rupyz on another device). Re-do Step 2 with a fresh token.

**Sync runs but no orders show up** — check the sync log. If `orders_inserted` is 0 but `pages_fetched` is 1+, it means all orders Rupyz returned were already in your DB (good!) or there are no orders in the last `RUPYZ_MAX_PAGES * page_size` window.

**Orders appear with "unknown" customer** — these are stub customers auto-created from order data. Go to Customers, search for them by name, and complete their info (beat, salesman, GSTIN). They're flagged with `is_stub = true` in the DB.

**Token refresh works but I want to verify** — the sync log row will have `token_refreshed = true` for that sync. You can also check `rupyz_session.last_refreshed_at` in Supabase.

**I want to see what the scraper is actually doing** — Supabase → Edge Functions → rupyz-sync → **Logs** tab. Every `console.log` and error appears there.

---

## What's next

Once orders are flowing reliably for a day or two, we move to **Phase 3 — Order management**:

- Approve / reject orders with credit-limit check
- Edit order quantities/prices (with audit trail)
- Partial dispatch (split one order into multiple shipments)
- Mobile POD capture for delivery
- Auto-update Rupyz status (so the salesman sees "Approved" / "Dispatched" / "Delivered")

Tell me when you're ready for Phase 3.
