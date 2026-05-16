================================================================
i18n type-check patch — fixes Vercel build error
================================================================

WHAT BROKE

  Vercel build failed during `tsc --noEmit`:
    app/dispatch/[beatId]/beat-dispatch-client.tsx:139:54
    Type error: Type 'number | undefined' is not assignable
                to type 'string | number'.

  The Bulk action results (bulkApproveOrders, bulkDispatchByBeat,
  dispatchSelectedOrders, shipTruck, createDispatch) all have
  optional success/count fields. TS treats them as `number | undefined`
  even after the `res.error` early-return because none of the early
  returns narrow to "succeeded MUST be defined now."

  Originally the code template-literal'd these (`${res.succeeded}`),
  which coerces undefined to "undefined" at runtime — a latent bug TS
  didn't flag. Once I switched to passing them as typed vars to t(),
  TS started complaining.

WHAT'S IN THIS ZIP — 5 patched files

  app/dispatch/page (none)
  app/dispatch/trucks-loading-panel.tsx              [dispatchCount]
  app/dispatch/load-truck/load-truck-client.tsx      [succeeded/failed/total]
  app/dispatch/[beatId]/beat-dispatch-client.tsx     [succeeded/failed/total]
  app/dispatch/[beatId]/[orderId]/order-dispatch-client.tsx  [dispatchNumber]
  app/pod/[dispatchId]/pod-capture.tsx               [dispatch_number]

  All fixes are local: each optional field is coalesced once into a
  local const with `?? 0` (for numbers) or `?? "—"` (for strings),
  then the local is used in the t() call.

DEPLOY

  Copy the 5 files over, commit, push.

    $src = "$HOME\Downloads\i18n-typefix\"
    Copy-Item "$src\app\dispatch\trucks-loading-panel.tsx" `
      "app\dispatch\trucks-loading-panel.tsx" -Force
    Copy-Item "$src\app\dispatch\load-truck\load-truck-client.tsx" `
      "app\dispatch\load-truck\load-truck-client.tsx" -Force
    Copy-Item "$src\app\dispatch\[beatId]\beat-dispatch-client.tsx" `
      "app\dispatch\[beatId]\beat-dispatch-client.tsx" -Force
    Copy-Item "$src\app\dispatch\[beatId]\[orderId]\order-dispatch-client.tsx" `
      "app\dispatch\[beatId]\[orderId]\order-dispatch-client.tsx" -Force
    Copy-Item "$src\app\pod\[dispatchId]\pod-capture.tsx" `
      "app\pod\[dispatchId]\pod-capture.tsx" -Force

    git add .
    git commit -m "fix(i18n): coalesce optional result fields before passing to t()"
    git push

  Vercel rebuilds. Should compile clean this time.

  If there's ANOTHER TS error, paste it and I'll fix that one too.
  TypeScript's noEmit pass on Vercel is stricter than local dev
  because dev rebuilds incrementally and skips full type-check; first
  full production build always catches the latent ones.

================================================================
