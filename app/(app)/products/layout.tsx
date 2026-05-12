// =============================================================================
// /products layout — adds a tab strip on top for Catalog vs Insights.
//
// The actual page content (Catalog table or Insights view) comes from
// app/(app)/products/page.tsx OR app/(app)/products/insights/...
// =============================================================================

import { ProductsTabStrip } from "./products-tab-strip";

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ProductsTabStrip />
      {children}
    </>
  );
}
