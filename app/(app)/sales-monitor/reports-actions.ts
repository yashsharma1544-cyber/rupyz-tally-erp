"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReportRow = {
  area_id: string;
  area_name: string;
  beat_id: string;
  beat_name: string;
  customer_id: string;
  customer_name: string;
  target_kg: number;
  achievement_kg: number;
  avg_kg: number;
  last_order_date: string | null;
  last_order_kg: number;
};

async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  return Boolean(appUser?.active && appUser.role === "admin");
}

export async function getReportRows(
  jcId: string | null,
  allJc: boolean,
): Promise<{ error: string } | { rows: ReportRow[] }> {
  if (!(await isAdmin())) return { error: "Admin only" };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("jc_report_rows", {
    p_jc_id: jcId ?? "00000000-0000-0000-0000-000000000000",
    p_all_jc: allJc,
  });
  if (error) return { error: error.message };

  const rows: ReportRow[] = (data ?? []).map(
    (r: {
      r_area_id: string;
      r_area_name: string;
      r_beat_id: string;
      r_beat_name: string;
      r_customer_id: string;
      r_customer_name: string;
      r_target_kg: number | string;
      r_achievement_kg: number | string;
      r_avg_kg: number | string;
      r_last_order_date: string | null;
      r_last_order_kg: number | string;
    }) => ({
      area_id: r.r_area_id,
      area_name: r.r_area_name,
      beat_id: r.r_beat_id,
      beat_name: r.r_beat_name,
      customer_id: r.r_customer_id,
      customer_name: r.r_customer_name,
      target_kg: Number(r.r_target_kg) || 0,
      achievement_kg: Number(r.r_achievement_kg) || 0,
      avg_kg: Number(r.r_avg_kg) || 0,
      last_order_date: r.r_last_order_date,
      last_order_kg: Number(r.r_last_order_kg) || 0,
    }),
  );

  return { rows };
}
