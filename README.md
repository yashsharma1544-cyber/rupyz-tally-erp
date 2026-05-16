# i18n Phase A — Layout Patches

This zip contains 4 replacement layout files plus the infrastructure from the previous zip.

## What's in this zip

```
lib/i18n/dictionary.ts            ← all translation keys + Marathi
lib/i18n/context.tsx              ← React context + useTranslation hook
lib/i18n/status-label.tsx         ← status enum helper
components/language-toggle.tsx    ← EN | मर toggle button

app/layout.tsx                    ← REPLACED: wraps everything with <I18nProvider>
app/load/layout.tsx               ← REPLACED: adds floating toggle
app/dispatch/layout.tsx           ← REPLACED: adds floating toggle
app/driver/layout.tsx             ← REPLACED: adds floating toggle
```

## Deploy

### 1. Extract & copy everything

```powershell
cd C:\Users\Yash\Downloads\rupyz-tally-erp

# Extract zip to e.g. C:\Users\Yash\Downloads\i18n-phase-a-deploy\
# Then copy each section:

# Infrastructure (new directories)
Copy-Item -Recurse -Force -LiteralPath "C:\Users\Yash\Downloads\i18n-phase-a-deploy\lib\i18n" -Destination "lib\i18n"
Copy-Item -Force -LiteralPath "C:\Users\Yash\Downloads\i18n-phase-a-deploy\components\language-toggle.tsx" -Destination "components\language-toggle.tsx"

# Layout replacements (overwrites your existing layouts)
Copy-Item -Force -LiteralPath "C:\Users\Yash\Downloads\i18n-phase-a-deploy\app\layout.tsx" -Destination "app\layout.tsx"
Copy-Item -Force -LiteralPath "C:\Users\Yash\Downloads\i18n-phase-a-deploy\app\load\layout.tsx" -Destination "app\load\layout.tsx"
Copy-Item -Force -LiteralPath "C:\Users\Yash\Downloads\i18n-phase-a-deploy\app\dispatch\layout.tsx" -Destination "app\dispatch\layout.tsx"
Copy-Item -Force -LiteralPath "C:\Users\Yash\Downloads\i18n-phase-a-deploy\app\driver\layout.tsx" -Destination "app\driver\layout.tsx"
```

Verify:

```powershell
Test-Path "lib\i18n\dictionary.ts"
Test-Path "lib\i18n\context.tsx"
Test-Path "lib\i18n\status-label.tsx"
Test-Path "components\language-toggle.tsx"
Test-Path "app\layout.tsx"
Test-Path "app\load\layout.tsx"
Test-Path "app\dispatch\layout.tsx"
Test-Path "app\driver\layout.tsx"
```

All eight should print `True`.

### 2. Local test

```powershell
npm run dev
```

Open these URLs and verify the EN | मर toggle is visible in the top-right corner:
- http://localhost:3000/load
- http://localhost:3000/dispatch
- http://localhost:3000/driver

Click the toggle. Nothing visible should change in the page content (no strings wrapped yet) — but the active button highlights, and reloading the page preserves the choice.

Confirm from browser console:
```javascript
localStorage.getItem("rupyz_lang")
```
Should return "mr" after toggling, "en" after switching back.

### 3. Push

```powershell
git add `
  "lib/i18n/" `
  "components/language-toggle.tsx" `
  "app/layout.tsx" `
  "app/load/layout.tsx" `
  "app/dispatch/layout.tsx" `
  "app/driver/layout.tsx"

git commit -m "Add i18n infrastructure + language toggle on ops layouts (Phase A)"
git push
```

## What changed in each layout

### `app/layout.tsx` (root)
- Added `import { I18nProvider } from "@/lib/i18n/context";`
- Wrapped the `<body>` contents with `<I18nProvider>...</I18nProvider>`
- Everything else (Toaster, metadata, viewport) is unchanged
- Also: changed `Â·` to proper `·` in title (was a UTF-8 issue from the cat output)

### `app/load/layout.tsx`, `app/dispatch/layout.tsx`, `app/driver/layout.tsx`
- Added `import { LanguageToggle } from "@/components/language-toggle";`
- Wrapped children with a fragment that renders the toggle as a fixed-position element at top-right (`fixed top-2 right-2 z-50`)
- Everything else unchanged (metadata, manifest, etc.)
- Also fixed the `Â·` characters

## Notes

**Why fixed-position toggle?** Your ops layouts had no header element — pages render their own. A fixed-position floating button avoids conflicts with any existing page chrome. It's mobile-friendly (top-right corner is reachable on phones).

**Want it elsewhere?** Move the `<div className="fixed top-2 right-2 z-50">` block in each layout. Common alternatives:
- `bottom-2 right-2` — bottom-right
- `top-2 left-2` — top-left
- Remove the `fixed top-2 right-2 z-50` wrapper and the toggle becomes inline (you'd then need to place it in a header inside each page)

**Van/POD pages not covered yet.** `app/van/...` and `app/pod/...` don't have layouts. They'll get the toggle inline when we do Phase B for those workflows.

**Admin pages.** `app/(app)/layout.tsx` doesn't have the toggle yet either. If you want it on admin pages too, paste me that file and I'll add it. Or skip — admin staff read English fine, that's why we limited scope to ops.

## What's next (Phase B)

After this is deployed and you've verified the toggle works, Phase B will go page-by-page through the 24 ops files and replace hardcoded English with `t("key")` calls. I'll need to see them in batches.

Best to start with the smallest workflow first — **Loading (5 files)**. When ready, paste:

```powershell
cat "app\load\page.tsx"
cat "app\load\orders\[orderId]\page.tsx"
cat "app\load\orders\[orderId]\load-order-client.tsx"
```

(Skip `app\load\layout.tsx` — already done. Skip `actions.ts` — server actions, no UI strings to translate unless they return user-facing error messages.)

Then I send full replacements for those 3 files with all strings wrapped.
