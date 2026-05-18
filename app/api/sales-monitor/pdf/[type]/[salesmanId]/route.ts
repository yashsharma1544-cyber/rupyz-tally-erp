import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSalesmanDayStatus } from "@/lib/sales-monitor/compute";
import {
  renderSalesmanPdf,
  pdfFilename,
  PDF_REPORT_TYPES,
  type PdfReportType,
} from "@/lib/sales-monitor/pdf/render";

// @react-pdf/renderer needs Node runtime â€” won't run on Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { type: string; salesmanId: string } },
) {
  // Auth â€” admin only
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!appUser || appUser.role !== "admin") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Validate type
  if (!PDF_REPORT_TYPES.includes(params.type as PdfReportType)) {
    return NextResponse.json(
      { error: `Invalid report type. Use one of: ${PDF_REPORT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  const type = params.type as PdfReportType;

  // Resolve date (default today in IST)
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayISO = istNow.toISOString().slice(0, 10);
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayISO;

  // Fetch the salesman day status
  const status = await getSalesmanDayStatus(params.salesmanId, date);
  if (!status) {
    return NextResponse.json({ error: "Salesman not found" }, { status: 404 });
  }

  // Render PDF
  try {
    const pdfBuffer = await renderSalesmanPdf(type, status);
    const filename = pdfFilename(type, status.salesman_name, date);
    const wantDownload = url.searchParams.get("download") === "1";

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${wantDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "no-store",
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PDF render failed:", message);
    return NextResponse.json(
      { error: "PDF render failed", detail: message },
      { status: 500 },
    );
  }
}
