import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CustomersClient } from "./customers-client";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const supabase = await createClient();

  const [{ data: beats }, { data: salesmen }, { data: cityRows }, { count: total }] = await Promise.all([
    supabase.from("beats").select("id,name").order("name"),
    supabase.from("salesmen").select("id,name").order("name"),
    supabase.from("customers").select("city").not("city", "is", null),
    supabase.from("customers").select("id", { count: "exact", head: true }),
  ]);

  // Dedupe cities case-insensitively, preserve first-seen casing, sort A→Z.
  const seen = new Map<string, string>();
  for (const r of cityRows ?? []) {
    const raw = (r as { city: string | null }).city;
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  const cities = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));

  const subtitle = total != null ? `${total.toLocaleString("en-IN")} retailers and wholesalers` : "";

  return (
    <>
      <PageHeader title="Customers" subtitle={subtitle} />
      <CustomersClient beats={beats ?? []} salesmen={salesmen ?? []} cities={cities} />
    </>
  );
}
