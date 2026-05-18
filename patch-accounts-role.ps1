# =============================================================================
# patch-accounts-role.ps1
#
# Grants the 'accounts' role admin-equivalent access for office tasks:
#   - Dashboard (full admin widgets)
#   - Orders + invoice management
#   - Customers, beats, drivers
#   - Sales monitor (incl. journey cycles, log, salesman details, tests)
#   - Settings (outstandings, backfill, account settings)
#   - Data import
#   - AI features (briefing, chat, narratives, insights)
#
# DOES NOT patch:
#   - app/(app)/users/*       — user management stays admin-only
#   - Operational pages (/load, /dispatch, /driver, /van, /trips) —
#     accounts staff don't perform field operations. Patch those
#     separately later if needed.
#
# Run from repo root: .\patch-accounts-role.ps1
# Review with:        git diff
# =============================================================================

$ErrorActionPreference = "Stop"
$applied = @()
$failed = @()

function Patch {
    param([string]$relPath, [string]$find, [string]$replace, [string]$desc)
    if (-not (Test-Path -LiteralPath $relPath)) {
        $script:failed += "MISSING FILE: $relPath ($desc)"
        return
    }
    $content = Get-Content -Raw -LiteralPath $relPath
    if (-not $content.Contains($find)) {
        $script:failed += "PATTERN NOT FOUND: $relPath -- $desc"
        return
    }
    $newContent = $content.Replace($find, $replace)
    if ($newContent -eq $content) {
        $script:failed += "NO CHANGE: $relPath -- $desc"
        return
    }
    Set-Content -LiteralPath $relPath -Value $newContent -NoNewline
    $script:applied += "$relPath -- $desc"
}

Write-Host "Patching role checks to include 'accounts' alongside 'admin'..." -ForegroundColor Cyan
Write-Host ""

# ===== Layout =====
Patch "app\(app)\layout.tsx" `
    'const isAdmin = appUser.role === "admin";' `
    'const isAdmin = ["admin", "accounts"].includes(appUser.role);' `
    "layout: isAdmin nav variable"

# ===== Dashboard =====
Patch "app\(app)\dashboard\page.tsx" `
    'if (pendingApproval.count > 0 && ["admin", "approver"].includes(me.role)) {' `
    'if (pendingApproval.count > 0 && ["admin", "accounts", "approver"].includes(me.role)) {' `
    "dashboard: pending approval widget"

Patch "app\(app)\dashboard\page.tsx" `
    'if (readyToSend.count > 0 && ["admin", "van_lead", "dispatch"].includes(me.role)) {' `
    'if (readyToSend.count > 0 && ["admin", "accounts", "van_lead", "dispatch"].includes(me.role)) {' `
    "dashboard: ready to send widget"

Patch "app\(app)\dashboard\page.tsx" `
    'const isAdmin = me.role === "admin";' `
    'const isAdmin = ["admin", "accounts"].includes(me.role);' `
    "dashboard: isAdmin variable"

# ===== Beats =====
Patch "app\(app)\beats\page.tsx" `
    'const isAdmin = me.role === "admin";' `
    'const isAdmin = ["admin", "accounts"].includes(me.role);' `
    "beats: isAdmin variable"

Patch "app\(app)\beats\manage-areas\actions.ts" `
    'if (!me?.active || me.role !== "admin") throw new Error("Not authorized");' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) throw new Error("Not authorized");' `
    "beats/manage-areas: actions auth"

Patch "app\(app)\beats\manage-areas\page.tsx" `
    'if (!me?.active || me.role !== "admin") {' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) {' `
    "beats/manage-areas: page auth"

# ===== Admin > Data Import =====
Patch "app\(app)\admin\data-import\actions.ts" `
    'if (!me?.active || me.role !== "admin") return { ok: false, error: "Admin only" };' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) return { ok: false, error: "Admin or accounts only" };' `
    "data-import: actions auth"

Patch "app\(app)\admin\data-import\page.tsx" `
    'if (!me?.active || me.role !== "admin") {' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) {' `
    "data-import: page auth"

# ===== Customers =====
Patch "app\(app)\customers\actions.ts" `
    'const actor = await requireRoles(["admin"]);' `
    'const actor = await requireRoles(["admin", "accounts"]);' `
    "customers: actions auth"

# ===== Drivers =====
Patch "app\(app)\drivers\page.tsx" `
    'if (!me?.active || me.role !== "admin") {' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) {' `
    "drivers: page auth"

# ===== Orders =====
Patch "app\(app)\orders\actions.ts" `
    'const actor = await requireRoles(["admin", "approver"]);' `
    'const actor = await requireRoles(["admin", "accounts", "approver"]);' `
    "orders/actions: approver actions (replaces all 4 occurrences)"

Patch "app\(app)\orders\actions.ts" `
    'const actor = await requireRoles(["admin"]);' `
    'const actor = await requireRoles(["admin", "accounts"]);' `
    "orders/actions: admin-only action"

Patch "app\(app)\orders\actions.ts" `
    'const actor = await requireRoles(["admin", "billing"]);' `
    'const actor = await requireRoles(["admin", "accounts", "billing"]);' `
    "orders/actions: invoice actions (replaces both occurrences)"

Patch "app\(app)\orders\order-drawer.tsx" `
    'const canApprove   = ["admin", "approver"].includes(me.role) && order.app_status === "received";' `
    'const canApprove   = ["admin", "accounts", "approver"].includes(me.role) && order.app_status === "received";' `
    "order-drawer: canApprove"

Patch "app\(app)\orders\order-drawer.tsx" `
    'const canEdit      = ["admin", "approver"].includes(me.role) && ["received", "approved"].includes(order.app_status);' `
    'const canEdit      = ["admin", "accounts", "approver"].includes(me.role) && ["received", "approved"].includes(order.app_status);' `
    "order-drawer: canEdit"

Patch "app\(app)\orders\order-drawer.tsx" `
    'isAdmin={me.role === "admin"}' `
    'isAdmin={["admin", "accounts"].includes(me.role)}' `
    "order-drawer: isAdmin prop"

Patch "app\(app)\orders\order-drawer.tsx" `
    'const canEdit = ["admin", "billing"].includes(me.role)' `
    'const canEdit = ["admin", "accounts", "billing"].includes(me.role)' `
    "order-drawer: canEdit invoice"

Patch "app\(app)\orders\orders-client.tsx" `
    'const isApprover = ["admin", "approver"].includes(meRole);' `
    'const isApprover = ["admin", "accounts", "approver"].includes(meRole);' `
    "orders-client: isApprover (replaces both occurrences)"

Patch "app\(app)\orders\orders-client.tsx" `
    'const isBilling = ["admin", "billing"].includes(meRole);' `
    'const isBilling = ["admin", "accounts", "billing"].includes(meRole);' `
    "orders-client: isBilling (replaces both occurrences)"

# ===== Sales Monitor =====
Patch "app\(app)\sales-monitor\actions.ts" `
    'if (!appUser || appUser.role !== "admin") throw new Error("Not authorized");' `
    'if (!appUser || !["admin", "accounts"].includes(appUser.role)) throw new Error("Not authorized");' `
    "sales-monitor: actions auth"

Patch "app\(app)\sales-monitor\page.tsx" `
    'if (!appUser || appUser.role !== "admin") {' `
    'if (!appUser || !["admin", "accounts"].includes(appUser.role)) {' `
    "sales-monitor: page auth"

Patch "app\(app)\sales-monitor\test-actions.ts" `
    'if (!me?.active || me.role !== "admin") throw new Error("Not authorized — admin only");' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) throw new Error("Not authorized — admin or accounts only");' `
    "sales-monitor: test-actions auth"

Patch "app\(app)\sales-monitor\log\actions.ts" `
    'if (!me?.active || me.role !== "admin") throw new Error("Not authorized");' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) throw new Error("Not authorized");' `
    "sales-monitor/log: actions auth"

Patch "app\(app)\sales-monitor\log\page.tsx" `
    'if (!me?.active || me.role !== "admin") {' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) {' `
    "sales-monitor/log: page auth"

Patch "app\(app)\sales-monitor\journey-cycles\page.tsx" `
    'if (!appUser || appUser.role !== "admin") redirect("/");' `
    'if (!appUser || !["admin", "accounts"].includes(appUser.role)) redirect("/");' `
    "sales-monitor/journey-cycles: page auth"

Patch "app\(app)\sales-monitor\journey-cycles\[jcId]\actions.ts" `
    'if (!appUser || appUser.role !== "admin") throw new Error("Not authorized");' `
    'if (!appUser || !["admin", "accounts"].includes(appUser.role)) throw new Error("Not authorized");' `
    "sales-monitor/journey-cycles/[jcId]: actions auth"

Patch "app\(app)\sales-monitor\journey-cycles\[jcId]\page.tsx" `
    'if (!appUser || appUser.role !== "admin") redirect("/");' `
    'if (!appUser || !["admin", "accounts"].includes(appUser.role)) redirect("/");' `
    "sales-monitor/journey-cycles/[jcId]: page auth"

Patch "app\(app)\sales-monitor\journey-cycles\[jcId]\distribute\actions.ts" `
    'if (!me?.active || me.role !== "admin") throw new Error("Not authorized");' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) throw new Error("Not authorized");' `
    "sales-monitor/journey-cycles/distribute: actions auth"

Patch "app\(app)\sales-monitor\journey-cycles\[jcId]\distribute\page.tsx" `
    'if (!me?.active || me.role !== "admin") redirect("/");' `
    'if (!me?.active || !["admin", "accounts"].includes(me.role)) redirect("/");' `
    "sales-monitor/journey-cycles/distribute: page auth"

Patch "app\(app)\sales-monitor\[salesmanId]\page.tsx" `
    'if (!appUser || appUser.role !== "admin") {' `
    'if (!appUser || !["admin", "accounts"].includes(appUser.role)) {' `
    "sales-monitor/[salesmanId]: page auth"

Patch "app\(app)\sales-monitor\[salesmanId]\send-actions.ts" `
    'if (!appUser || appUser.role !== "admin") throw new Error("Not authorized");' `
    'if (!appUser || !["admin", "accounts"].includes(appUser.role)) throw new Error("Not authorized");' `
    "sales-monitor/[salesmanId]: send-actions auth"

# ===== Settings (NOT user management) =====
# app/(app)/users/* is intentionally NOT patched — that's user management, stays admin-only.

Patch "app\(app)\settings\page.tsx" `
    'if (!me || me.role !== "admin") redirect("/dashboard");' `
    'if (!me || !["admin", "accounts"].includes(me.role)) redirect("/dashboard");' `
    "settings: page auth"

Patch "app\(app)\settings\actions.ts" `
    'if (!appUser?.active || appUser.role !== "admin") return { error: "Admin only" };' `
    'if (!appUser?.active || !["admin", "accounts"].includes(appUser.role)) return { error: "Admin or accounts only" };' `
    "settings: actions auth (replaces all 4 occurrences)"

Patch "app\(app)\settings\backfill-actions.ts" `
    'if (appUser?.role !== "admin") return { ok: false, error: "Admin only" };' `
    'if (appUser?.role !== "admin" && appUser?.role !== "accounts") return { ok: false, error: "Admin or accounts only" };' `
    "settings: backfill auth (replaces all 3 occurrences)"

Patch "app\(app)\settings\outstanding-actions.ts" `
    'if (!appUser?.active || appUser.role !== "admin") throw new Error("Admin only");' `
    'if (!appUser?.active || !["admin", "accounts"].includes(appUser.role)) throw new Error("Admin or accounts only");' `
    "settings: outstanding-actions auth"

# ===== AI API routes =====
Patch "app\api\ai\briefing\route.ts" `
    'if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });' `
    'if (me?.role !== "admin" && me?.role !== "accounts") return NextResponse.json({ error: "Admin or accounts only" }, { status: 403 });' `
    "ai/briefing: auth"

Patch "app\api\ai\chat\route.ts" `
    'if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });' `
    'if (me?.role !== "admin" && me?.role !== "accounts") return NextResponse.json({ error: "Admin or accounts only" }, { status: 403 });' `
    "ai/chat: auth"

Patch "app\api\ai\chat\threads\route.ts" `
    'if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });' `
    'if (me?.role !== "admin" && me?.role !== "accounts") return NextResponse.json({ error: "Admin or accounts only" }, { status: 403 });' `
    "ai/chat/threads: auth"

Patch "app\api\ai\insights-beat-lines\route.ts" `
    'if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });' `
    'if (me?.role !== "admin" && me?.role !== "accounts") return NextResponse.json({ error: "Admin or accounts only" }, { status: 403 });' `
    "ai/insights-beat-lines: auth"

Patch "app\api\ai\narrative\beat\[id]\route.ts" `
    'if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });' `
    'if (me?.role !== "admin" && me?.role !== "accounts") return NextResponse.json({ error: "Admin or accounts only" }, { status: 403 });' `
    "ai/narrative/beat: auth"

Patch "app\api\ai\narrative\customer\[id]\route.ts" `
    'if (me?.role !== "admin") {' `
    'if (me?.role !== "admin" && me?.role !== "accounts") {' `
    "ai/narrative/customer: auth"

Patch "app\api\ai\narrative\product\[id]\route.ts" `
    'if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });' `
    'if (me?.role !== "admin" && me?.role !== "accounts") return NextResponse.json({ error: "Admin or accounts only" }, { status: 403 });' `
    "ai/narrative/product: auth"

# ===== API: sales-monitor PDF =====
Patch "app\api\sales-monitor\pdf\[type]\[salesmanId]\route.ts" `
    'if (!appUser || appUser.role !== "admin") {' `
    'if (!appUser || !["admin", "accounts"].includes(appUser.role)) {' `
    "api/sales-monitor/pdf: route auth"

# ===== Report =====
Write-Host ""
Write-Host "=== APPLIED ($($applied.Count)) ===" -ForegroundColor Green
$applied | ForEach-Object { Write-Host "  $_" }

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "=== FAILED OR SKIPPED ($($failed.Count)) ===" -ForegroundColor Yellow
    $failed | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "Some patterns weren't found — likely because they were already patched," -ForegroundColor Yellow
    Write-Host "the file has been edited since the grep, or the file doesn't exist." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. git diff   # review changes"
Write-Host "  2. npm run build   # catch any type errors"
Write-Host "  3. git add -A && git commit -m 'auth: grant accounts role admin-equivalent access' && git push"
