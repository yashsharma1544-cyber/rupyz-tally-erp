// =============================================================================
// /insights/products/[productId] — single product deep-dive
// =============================================================================

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductDetailClient } from "./product-detail-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface BuyerRow {
  customer_id: string;
  customer_name: string;
  mobile: string | null;
  beat_name: string | null;
  kg_90d: number;
  kg_30d: number | null;
  last_order_at: string;
}

export interface BeatBreakdown {
  beat_id: string | null;
  beat_name: string;
  kg_90d: number;
  kg_30d: number | null;
  buyers_30d: number;
}

export interface ProductDetailData {
  id: string;
  name: string;
  brand_id: string | null;
  brand_name: string | null;
  weight_kg: number | null;
  kg_30d: number;
  kg_prev_30d: number;
  kg_90d: number;
  kg_lifetime: number;
  growth_pct: number;
  buyers_30d: number;
  buyers_90d: number;
  last_sold_at: string | null;
  days_since_last_sold: number | null;
  top_buyers: BuyerRow[];
  recent_stoppers: BuyerRow[];
  beats: BeatBreakdown[];
  error?: string;
}

interface PageProps { params: Promise<{ productId: string }> }

export default async function ProductDetailPage({ params }: PageProps) {
  const { productId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/insights/products/${productId}`);

  const { data, error } = await supabase.rpc("product_detail", { p_product_id: productId });
  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Couldn&apos;t load product</h1>
        <p className="text-sm text-ink-muted">{error.message}</p>
      </div>
    );
  }
  if (!data || (data as { error?: string }).error === "not_found") notFound();
  if ((data as { error?: string }).error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not available</h1>
        <p className="text-sm text-ink-muted">{(data as { error?: string }).error}</p>
      </div>
    );
  }
  return <ProductDetailClient data={data as ProductDetailData} />;
}
