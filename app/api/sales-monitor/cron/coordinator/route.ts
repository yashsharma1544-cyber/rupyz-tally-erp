import { NextRequest, NextResponse } from "next/server";
import { runCoordinatorCron, isAuthorizedCron } from "@/lib/sales-monitor/cron";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const summary = await runCoordinatorCron();
  return NextResponse.json(summary);
}
