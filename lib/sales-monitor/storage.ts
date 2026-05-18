/**
 * Supabase Storage helper for sales-report PDFs.
 *
 * Uploads PDFs to the private `sales-reports` bucket and returns a signed URL
 * that's embedded in the WhatsApp message body (as of 2026-05-18). Uses the
 * service-role client to bypass RLS (uploads happen from server-side cron +
 * admin actions, never directly from a user).
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "sales-reports";

/**
 * Signed URL TTL — 7 days so a Monday morning link still works after a
 * weekend (in case the salesman doesn't tap immediately). Each new send
 * generates a fresh URL, so users always have access to the most recent
 * report via the most recent message.
 */
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

let adminClientCache: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (adminClientCache) return adminClientCache;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  adminClientCache = createClient(url, serviceRole, {
    auth: { persistSession: false },
  });
  return adminClientCache;
}

/**
 * Upload a PDF to Storage and return a signed URL valid for 7 days.
 *
 * Path layout: sales-reports/{date}/{salesman_id}/{type}.pdf
 * Same path is reused if you re-send — overwrite is enabled.
 */
export async function uploadReportPdf(opts: {
  salesmanId: string;
  date: string;
  reportType: "morning" | "midday" | "evening";
  pdf: Buffer | Uint8Array;
}): Promise<{ storagePath: string; signedUrl: string }> {
  const storagePath = `${opts.date}/${opts.salesmanId}/${opts.reportType}.pdf`;
  const admin = getAdminClient();
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, opts.pdf, {
      contentType: "application/pdf",
      upsert: true,
      cacheControl: "3600",
    });
  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Signed URL generation failed: ${signErr?.message || "unknown"}`);
  }
  return {
    storagePath,
    signedUrl: signed.signedUrl,
  };
}
