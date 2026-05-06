// =============================================================================
// /dispatch/[beatId]/load-truck — DEPRECATED
//
// The wizard moved to /dispatch/load-truck (cross-beat). This route preserves
// any existing links by redirecting and pre-selecting the beat via query param.
// =============================================================================

import { redirect } from "next/navigation";

export default async function DeprecatedPerBeatLoadTruck({
  params,
}: {
  params: Promise<{ beatId: string }>;
}) {
  const { beatId } = await params;
  redirect(`/dispatch/load-truck?beat=${beatId}`);
}
