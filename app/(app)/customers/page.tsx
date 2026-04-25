import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CustomersClient } from "./customers-client";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const supabase = await createClient();
  const [{ data: beats }, { data: salesmen }] = await Promise.all([
    supabase.from("beats").select("id,name").order("name"),
    supabase.from("salesmen").select("id,name").order("name"),
  ]);

  return (
    <>
      <PageHeader title="Customers" subtitle="1,096 retailers and wholesalers" />
      <CustomersClient beats={beats ?? []} salesmen={salesmen ?? []} />
    </>
  );
}
