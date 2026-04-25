import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ProductsClient } from "./products-client";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const supabase = await createClient();
  const [{ data: brands }, { data: categories }] = await Promise.all([
    supabase.from("brands").select("id,name").order("name"),
    supabase.from("categories").select("id,name").order("name"),
  ]);

  return (
    <>
      <PageHeader title="Products" subtitle="43 SKUs across 10 brands" />
      <ProductsClient brands={brands ?? []} categories={categories ?? []} />
    </>
  );
}
