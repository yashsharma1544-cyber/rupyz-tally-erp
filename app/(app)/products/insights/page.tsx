// =============================================================================
// /products/insights — Insights tab content (was: /insights/products)
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductsInsightsClient } from "./products-insights-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface ProductRow {
  product_id: string;
  product_name: string;
  brand_id: string | null;
  brand_name: string | null;
  kg_30d: number;
  kg_prev_30d: number;
  kg_90d: number;
  kg_lifetime: number;
  last_sold_at: string | null;
  buyers_30d: number;
  buyers_90d: number;
  growth_pct: number;
  days_since_last_sold: number | null;
  share_pct_30d: number;
}

export interface BrandRow {
  brand_id: string | null;
  brand_name: string;
  kg_30d: number;
  kg_prev_30d: number;
  kg_90d: number;
  kg_lifetime: number;
  sku_count: number;
  active_sku_count: number;
  growth_pct: number;
  share_pct_30d: number;
}

export interface ProductsOverviewData {
  products: ProductRow[];
  brands: BrandRow[];
  total_kg_30d: number;
  error?: string;
}

export default async function ProductsInsightsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/products/insights");

  const { data, error } = await supabase.rpc("products_overview");
  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Couldn&apos;t load products insights</h1>
        <p className="text-sm text-ink-muted">{error.message}</p>
      </div>
    );
  }
  if (!data || (data as { error?: string }).error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">{(data as { error?: string })?.error ?? "unknown"}</p>
      </div>
    );
  }
  return <ProductsInsightsClient data={data as ProductsOverviewData} />;
}
