import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}
export const config = {
  // Skip middleware for static assets AND for cron endpoints. Vercel cron
  // requests arrive with no user session (auth is done inside the route via
  // CRON_SECRET); without this exclusion the auth middleware 307-redirects
  // the request before the handler can run, which is why messages
  // mysteriously stopped going out.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/sales-monitor/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
