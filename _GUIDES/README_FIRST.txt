============================================================
TALLY TARGETS — COMPLETE FILE BUNDLE
============================================================
This zip mirrors your repo structure. Each file is already at the path it
belongs to. Copy the folders into your repo root, overwriting when asked.

FILES & WHERE THEY GO (already arranged in this zip):
  app/(app)/tally-targets/page.tsx                    (the page)
  app/(app)/tally-targets/tally-targets-client.tsx    (the UI)
  app/(app)/tally-targets/tally-target-actions.ts     (server actions)
  app/api/tally-targets/refresh/route.ts              (Google Sheet refresh)
  components/layout/sidebar.tsx                        (sidebar w/ Tally Targets)
  sql/56_tally_targets.sql                             (base tables + RPCs)
  sql/57_tally_multicompany.sql                        (company + voucher_type)

------------------------------------------------------------
DEPLOY (laptop, repo at C:\Users\Yash\Downloads\rupyz-tally-erp)
------------------------------------------------------------
1) Unzip somewhere, e.g. Downloads\tally_bundle

2) Copy the app/components folders into the repo (overwrites the 4 app files
   + sidebar):

   robocopy "$HOME\Downloads\tally_bundle\app"        "C:\Users\Yash\Downloads\rupyz-tally-erp\app" /E
   robocopy "$HOME\Downloads\tally_bundle\components" "C:\Users\Yash\Downloads\rupyz-tally-erp\components" /E

   (robocopy merges folders; it won't delete anything else.)

3) SQL — run in Supabase SQL editor, in order (skip 56 if you already ran it):
     sql/56_tally_targets.sql      (only if not already run)
     sql/57_tally_multicompany.sql

4) Build + push from the repo root:
     cd C:\Users\Yash\Downloads\rupyz-tally-erp
     npm run build
     git add -A
     git commit -m "tally targets: multi-company system"
     git push

5) After Vercel deploys: open app -> Tally Targets -> "Refresh from Google Sheet"
   -> wait ~15s -> it loads ~24,100 rows. Paste the perTab response to verify.

------------------------------------------------------------
PREREQS (should already be done)
------------------------------------------------------------
- Vercel env vars: TALLY_SHEET_ID, GOOGLE_SHEETS_CLIENT_EMAIL,
  GOOGLE_SHEETS_PRIVATE_KEY  (see GOOGLE_SERVICE_ACCOUNT_SETUP.txt)
- The Google service account shared as Viewer on the sheet.

SCOPE LOADED BY REFRESH:
  Sushil Agencies (26-27): GST SALES + NEW MONDHA
  Anjali Agencies (25-26 + 26-27): GST SALES + GST INTERCITY SALES + NEW MONDHA
  PRIYA SALES excluded.
