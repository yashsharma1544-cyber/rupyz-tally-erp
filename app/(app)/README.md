# Rupyz historical backfill

A separate Edge Function that pulls older orders from Rupyz, resumable across timeouts.

## What it does differently from rupyz-sync

| Aspect | rupyz-sync (existing) | rupyz-backfill (new) |
|---|---|---|
| Stops on | "no new work this page" + MAX_PAGES=5 | Empty page, cutoff date, or max_pages=1000 |
| Resumes | Doesn't (fresh page=1 every run) | Yes — `last_completed_page + 1` |
| Frequency | Every 15 min via pg_cron | One-shot, manually triggered |
| Goal | Keep up with new orders | Backfill old orders |

## Files

```
sql/36_rupyz_backfill_state.sql            — state table + reset() helper
supabase/functions/rupyz-backfill/index.ts — the Edge Function

app/(app)/settings/backfill-actions.ts     — server actions
app/(app)/settings/backfill-panel.tsx      — UI panel (Start/Resume/Reset/Config)
```

## Deploy

### 1. Run SQL in Supabase
Paste contents of `sql/36_rupyz_backfill_state.sql` in SQL editor → Run.

Verify:
```sql
select * from rupyz_backfill_state;
```
Should return one row: id=1, status='idle', last_completed_page=0.

### 2. Deploy the Edge Function
```bash
# From repo root, using Supabase CLI
supabase functions deploy rupyz-backfill
```

If you don't have the Supabase CLI installed, you can also deploy via the
Supabase dashboard:
- Dashboard → Edge Functions → Create a new function → name "rupyz-backfill"
- Paste the contents of `supabase/functions/rupyz-backfill/index.ts`
- The `_shared/rupyz.ts` is shared with the existing rupyz-sync function
  and should already be deployed

### 3. Push the UI code
```powershell
cd C:\Users\Yash\Downloads\rupyz-tally-erp
git add "app/(app)/settings/backfill-actions.ts" "app/(app)/settings/backfill-panel.tsx" "sql/36_rupyz_backfill_state.sql" "supabase/functions/rupyz-backfill"
git commit -m "Add resumable Rupyz historical backfill"
git push
```

### 4. Wire the panel into the Settings page

Open `app/(app)/settings/page.tsx`. Add to it:

```tsx
import { BackfillPanel, type BackfillState } from "./backfill-panel";

// inside the page component, after the existing SyncPanel:
const { data: backfillState } = await supabase
  .from("rupyz_backfill_state")
  .select("*")
  .eq("id", 1)
  .single();

// in the JSX:
<BackfillPanel state={backfillState as BackfillState} />
```

If you want, paste me your current `app/(app)/settings/page.tsx` and I'll
ship the patched version.

## How to run a backfill

1. **Configure (optional)**: Click the gear icon. Set a cutoff date like
   `2025-12-23` so it stops once it reaches your earliest expected orders.
   Save.

2. **Click "Start backfill"**. The function will paginate from page 1.
   - Each page it processes: marked as `last_completed_page`
   - After ~45 seconds (Edge Function time budget): pauses, marks status='paused'
   - Returns immediately to the UI with status

3. **Click "Resume"** to continue from where it left off. Repeat until
   status shows 'completed'.

4. The regular 15-min sync keeps running normally throughout. Both upsert
   by `rupyz_id` so they won't conflict.

## What to verify after completion

```sql
-- Did we get the expected date range?
select min(rupyz_created_at), max(rupyz_created_at), count(*) from orders;
-- Should now show min near Dec 23, 2025 instead of late April 2026

-- Spot-check a Dec order
select id, rupyz_order_id, rupyz_created_at, total_amount 
from orders 
where rupyz_created_at < '2026-01-01'
order by rupyz_created_at asc limit 5;
```

## Troubleshooting

- **"No session row in rupyz_session"**: The shared session token needs to exist
  before the function can call Rupyz. The existing sync setup should have
  provisioned this.

- **Backfill says completed but data still missing**: Rupyz may have older data
  that's only accessible via a different endpoint/filter. The current sync uses
  `/v2/organization/{org}/order/?page_no=N` — if your Rupyz UI has more orders
  than this returns, we'd need to dig into other API endpoints.

- **Hits "auth_expired"**: Your Rupyz auth token expired. Refresh it from the
  Sync Panel (existing UI), then resume backfill.

- **Hits max_pages**: Open config, bump max_pages to 2000+, save, resume.
