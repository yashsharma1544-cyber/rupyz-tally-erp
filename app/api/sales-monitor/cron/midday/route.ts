import { NextRequest, NextResponse } from "next/server";
import { runSalesmanCron, isAuthorizedCron } from "@/lib/sales-monitor/cron";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const summary = await runSalesmanCron("midday");
  return NextResponse.json(summary);
}
