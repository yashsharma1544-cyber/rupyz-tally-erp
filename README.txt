================================================================
Orders date range filter
================================================================

WHAT'S IN THIS ZIP

  sql/40_orders_kpis_by_status_with_until.sql   <- SQL migration
  app/(app)/orders/orders-client.tsx            <- REPLACE

DEPLOY (do the SQL first, then the file — order matters)

  STEP 1. Run the SQL.
    Open Supabase Studio → SQL Editor → New query.
    Paste the contents of sql/40_orders_kpis_by_status_with_until.sql.
    Click "Run". You should see "Success. No rows returned."

    What it does: DROPs the existing `orders_kpis_by_status` function
    and recreates it with a new optional `until_ts` parameter. Any
    existing caller (Tally backfill, briefing scripts, etc.) that only
    passes since_ts + beat_id_filter keeps working unchanged because
    until_ts defaults to NULL.

    Verify in psql or SQL Editor:
      SELECT * FROM orders_kpis_by_status();           -- all data
      SELECT * FROM orders_kpis_by_status(NOW() - interval '7 days');
      SELECT * FROM orders_kpis_by_status(
        '2026-04-01'::timestamptz, NULL, '2026-05-01'::timestamptz);

  STEP 2. Copy the client.

    Copy-Item "$HOME\Downloads\orders-daterange\app\(app)\orders\orders-client.tsx" `
      "app\(app)\orders\orders-client.tsx" -Force

    Then `npm run dev` and visit /orders.

WHAT CHANGED IN THE UI

  The "date filter" dropdown in the advanced filters panel went from
  4 options to 8:

      Today              — since local midnight today
      Yesterday          — full local day
      Last 7 days        — rolling
      Last 30 days       — rolling
      This month         — since 1st of this month
      Last month         — full previous calendar month
      Custom range       — opens two <input type="date"> below
      All time           — no filter

  When "Custom range" is selected for the first time it seeds the
  inputs with "last 30 days" so you don't get an empty Custom view.
  The date inputs use the native picker on mobile.

BUGS FIXED ALONG THE WAY

  1. "Today" was actually "last 24 hours" — used Date.now() - 86400 * 1000
     instead of local midnight. Orders placed at 10am two days ago would
     still show in "Today" between 10am-midnight. Now it's strictly since
     local-midnight.

  2. "Clear filters" was setting dateF to "today" instead of "all". So
     clicking the Clear button silently applied a date filter. Now it
     clears everything including custom from/to.

  3. The KPI cards previously only respected `since_ts`, not `until_ts`.
     With this migration they correctly reflect both endpoints. Especially
     visible on "Yesterday", "Last month", and Custom ranges with a
     non-empty "To" date — you'll now see KPIs scoped to the chosen
     window, not "everything since the start date".

ROLLBACK

  Client: `git checkout HEAD -- app/(app)/orders/orders-client.tsx`

  SQL: re-run the original function definition. The previous body was:

    CREATE OR REPLACE FUNCTION public.orders_kpis_by_status(
      since_ts timestamp with time zone DEFAULT NULL,
      beat_id_filter uuid DEFAULT NULL
    ) RETURNS TABLE(...) AS $$ ... $$;

  You can reconstruct that from the function body in the new migration
  by deleting the until_ts parameter and the matching WHERE clause line.

================================================================
