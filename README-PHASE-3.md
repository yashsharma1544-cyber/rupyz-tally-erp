# Phase 3 — Order Management Workflow

This phase adds the full operational workflow on top of the synced Rupyz orders: approve / reject / edit / dispatch / deliver with full audit trail.

## What you can do after Phase 3

| Role             | Can do |
|------------------|--------|
| **admin**        | Everything below |
| **approver**     | Approve / Reject / Edit orders, Create Dispatch |
| **dispatch**     | Create / Ship / Cancel dispatches, capture POD |
| **delivery**     | Capture POD only |
| **accounts**     | View only (Phase 4 will give them invoice matching) |
| **salesman**     | View only |

## Step 1 — Run the schema migration

In **Supabase → SQL Editor**, paste and run:

1. **`sql/06_phase3_order_workflow.sql`** — creates 5 new tables, helpers, storage bucket
2. **`sql/07_orders_kpi_function.sql`** — creates the KPI aggregation function for the orders dashboard

Verify:
```sql
select count(*) from dispatches;       -- expect 0
select count(*) from order_audit_events; -- expect 0
select * from storage.buckets where id = 'pod-photos';  -- expect 1 row
select * from orders_kpis_by_status();   -- expect 1 row per status group
```

## Step 2 — Push the new code

In Claude Code:

```
! cd /c/Users/Yash/Downloads/rupyz-tally-erp && git add . && git commit -m "Phase 3 — order management workflow" && git push
```

Vercel rebuilds in ~60s.

## Step 3 — Try it end to end

### a) Approve an order
- Go to **Orders** → click any "Received" order
- Status section shows badges, tabs at top show Current / History
- Bottom-right action buttons: `Reject`, `Edit`, `Approve`
- Click **Approve** → order moves to `approved` status, audit event recorded
- View **History** tab to see the approval entry with your name + timestamp

### b) Edit an order before approval
- Open a "Received" order → click **Edit**
- Each line becomes editable: change qty/price inline, or click trash icon to remove
- Click **+ Add product** → pick from dropdown of your 44 SKUs
- Bottom: enter a comment explaining the change (required, min 3 chars)
- Click **Save changes** → order shows "edited" badge, totals recalculated
- The **Rupyz Original** tab now appears — preserves the original line items as Rupyz sent them
- The **History** tab shows a Revision row with your change summary

### c) Create a dispatch (one or many per order)
- Open an "Approved" order → click **Create Dispatch**
- For each line item, enter the qty being shipped (≤ available qty)
- Enter vehicle number, driver name, driver phone (optional but recommended)
- Click **Create dispatch** → a new dispatch shows up in the order detail and in the **Dispatches** sidebar page
- Status: `pending`

### d) Ship the dispatch
- From either Order detail OR Dispatches page, click **Mark shipped** on a pending dispatch
- Status moves to `shipped`
- Order status auto-recomputes:
  - All items fully shipped? → `dispatched`
  - Some shipped, some pending? → `partially_dispatched`

### e) Capture POD on phone
- From the dispatch row → click **POD** (or share the link `/pod/{dispatchId}` with the delivery person)
- They'll see a mobile-optimized page with:
  - Customer + delivery address (one tap to call)
  - List of items in this dispatch
  - Camera button → opens phone camera, takes photo
  - Auto-fetched location (with accuracy)
  - Optional receiver name + notes
- Click **Confirm Delivery** → photo uploads, dispatch marked `delivered`, order status auto-updates

### f) Watch the order close
- Once all dispatches are delivered, order status becomes `delivered`
- Full delivery + signed receipt photo + GPS coords + driver name + timestamps all in audit trail

## How the data is preserved

For every order, you can always answer "what changed and when?":

- **Rupyz Original** — preserved in `order_items.rupyz_raw` (jsonb snapshot per line) + the Rupyz PO PDF at `orders.purchase_order_url`
- **Each edit** — full snapshot in `order_revisions.snapshot` with revision_number, edited_by, edited_at, change_summary
- **Each action** — discrete event in `order_audit_events` (approved, rejected, edited, dispatched, etc.) with actor, timestamp, optional comment + structured details

In the UI: the **History** tab on every order detail drawer shows the merged timeline.

## Permissions reference

```
approve  / reject  → admin, approver
edit             → admin, approver
create dispatch  → admin, approver, dispatch
ship dispatch    → admin, dispatch
mark delivered   → admin, dispatch, delivery
cancel dispatch  → admin, dispatch
cancel order     → admin
```

## Operational SOP — typical day

1. **Morning** — open `/orders` filtered by "Awaiting approval". Approver works through the queue.
2. After approval, dispatch user opens `/dispatches` → sees all pending dispatches → loads the truck → marks each shipped.
3. Driver gets POD link sent via WhatsApp. At each stop, opens link, takes photo + confirms.
4. Back at office: every delivered order shows green "Delivered" badge. Audit trail complete.

## Known limitations (intentional)

- **Credit limit check** — disabled until Phase 4 (Tally bridge gives real outstanding amounts)
- **Push status to Rupyz** — disabled by your decision; Rupyz status stays as it was when synced
- **Multi-warehouse** — single warehouse assumed
- **Returns / refunds** — not yet built (Phase 5+)

## Troubleshooting

**"Forbidden — requires one of: admin, approver"** — your `app_users.role` doesn't include the right permission. Use Users page to update.

**"Cannot dispatch — order is in received"** — order must be approved first.

**POD photo doesn't upload** — check Supabase → Storage → `pod-photos` bucket exists and "auth upload" policy is in place. If not, re-run `sql/06_phase3_order_workflow.sql`.

**Geolocation says blocked** — phone needs to grant browser permission. Settings → Site Settings → Location.

## What's next — Phase 4 / 5

- **Phase 4** — Tally bridge (pull invoices, reconcile dispatches, ledger balances)
- **Phase 5** — VAN Sales module (separate from office orders, mobile-first for van salesmen)
- **Phase 6** — WATi notifications (order approved → SMS to retailer, dispatched → WhatsApp, etc.)
