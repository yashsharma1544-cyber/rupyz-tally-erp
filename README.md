# Helper feature — Phase 1

Adds an optional "helper" to the per-order dispatch screen. Helpers are app_users with role `van_helper`. When assigned, they can open `/driver` and POD the delivery same as the driver.

## What's in this zip

```
sql/47_dispatch_helper.sql                                NEW migration — helper_user_id column

app/(app)/dispatches/actions.ts                           UPDATED — createDispatch accepts helperUserId,
                                                                    markDelivered allows van_helper role
                                                                    (also accepts 'loaded' orders, matching prev fix)
app/dispatch/[beatId]/[orderId]/page.tsx                  UPDATED — fetch helpers list
app/dispatch/[beatId]/[orderId]/order-dispatch-client.tsx UPDATED — helper dropdown in truck details

app/driver/page.tsx                                       UPDATED — show dispatches where you're driver OR helper
app/driver/[dispatchId]/page.tsx                          UPDATED — authz check allows helper
```

## What's NOT in this phase

- Bulk dispatch screen (`bulkDispatchByBeat`) — no helper
- Load-truck wizard (`/dispatch/load-truck`, `/dispatch/[beatId]/load-truck`) — no helper
- Beat-level "Dispatch all orders" — no helper
- Admin can add helpers via existing Users page (role dropdown already has `van_helper`)

If you use bulk or wizard paths, `helper_user_id` stays NULL. No data corruption — just no helper assigned. Per-order dispatch is the only path that gets helper UI for now.

## Step 1 — Run SQL #47 in Supabase

```sql
alter table dispatches
  add column if not exists helper_user_id uuid references app_users(id);

comment on column dispatches.helper_user_id is
  'Optional helper app_user (typically van_helper role) accompanying the driver. NULL = no helper.';
```

Verify:
```sql
select column_name, data_type
from information_schema.columns
where table_name = 'dispatches' and column_name = 'helper_user_id';
```
Should return one row.

## Step 2 — Copy files

```powershell
cd C:\Users\Yash\Downloads\rupyz-tally-erp

$src = "C:\Users\Yash\Downloads\helper-phase1"

Copy-Item -LiteralPath "$src\sql\47_dispatch_helper.sql" -Destination "sql\47_dispatch_helper.sql" -Force
Copy-Item -LiteralPath "$src\app\(app)\dispatches\actions.ts" -Destination "app\(app)\dispatches\actions.ts" -Force
Copy-Item -LiteralPath "$src\app\dispatch\[beatId]\[orderId]\page.tsx" -Destination "app\dispatch\[beatId]\[orderId]\page.tsx" -Force
Copy-Item -LiteralPath "$src\app\dispatch\[beatId]\[orderId]\order-dispatch-client.tsx" -Destination "app\dispatch\[beatId]\[orderId]\order-dispatch-client.tsx" -Force
Copy-Item -LiteralPath "$src\app\driver\page.tsx" -Destination "app\driver\page.tsx" -Force
Copy-Item -LiteralPath "$src\app\driver\[dispatchId]\page.tsx" -Destination "app\driver\[dispatchId]\page.tsx" -Force
```

## Step 3 — Create helpers in the Users page

Open `/users` in your admin app. Click "Invite User" or "Create driver" (whichever fits — the existing form has a role dropdown that includes `van_helper`).

For helpers without email, use "Create driver" path — it lets you set phone + password directly. Set role to `van_helper` after creation (via the role dropdown on the users table row), OR if Invite form's role dropdown lets you pick van_helper, use that.

You said you'd provide helper info ahead of time — when you're ready, paste names + phone numbers and I can SQL-insert them directly if the UI isn't working for some reason.

## Step 4 — Commit + push

```powershell
git add -A app sql
git status
```

Expected: 1 new SQL, 5 modified TS files. Paste status before committing.

```powershell
git commit -m "Helper feature phase 1: per-order dispatch + driver app authz"
git push
```

## Step 5 — Test after deploy

### Test 1: Helper dropdown shows in dispatch screen
1. Open `/dispatch` → pick a beat → pick an order
2. Scroll to "Truck details"
3. Below "Driver phone" you should see "Helper (optional)" dropdown
4. If no helpers exist, you'll see the message about adding van_helper users

### Test 2: Assign a helper
1. Create a van_helper user (Step 3 above)
2. Reload the order dispatch page → helper should appear in dropdown
3. Select a helper, fill vehicle/driver, tap Dispatch
4. Should succeed normally

### Test 3: Helper sees the delivery in /driver
1. Log out, log in as the helper (phone + password)
2. Open `/driver`
3. Should see the dispatch under the truck. Shows "as helper" badge.
4. Pending dispatches show as preview-only. Once dispatcher taps "Mark dispatched (truck left)", it moves to "Ready to deliver."

### Test 4: Helper can POD
1. As helper, tap the delivery card
2. Should land on the same POD screen as driver
3. Take photo, optional GPS, optional receiver name/notes
4. Tap "Mark delivered"
5. Should succeed — POD photo uploads, dispatch status moves to delivered

### Verify in SQL
```sql
select 
  d.id, d.status, d.vehicle_number,
  driver.full_name as driver,
  helper.full_name as helper,
  d.delivered_at, d.delivered_by
from dispatches d
left join app_users driver on driver.id = d.driver_user_id
left join app_users helper on helper.id = d.helper_user_id
where d.helper_user_id is not null
order by d.created_at desc
limit 10;
```

## What about admin auditing?

The `markDelivered` action now logs `captured_by_role` in `order_audit_events.details`. So you can see in audit:
- Who delivered (actor_name)
- Their role at the time (driver vs van_helper)

## Rollback

```powershell
git revert HEAD --no-edit
git push
```

DB rollback (only if no dispatches use helper yet):
```sql
alter table dispatches drop column if exists helper_user_id;
```

Harmless to leave the column if any rows reference it — NULL is the default.
