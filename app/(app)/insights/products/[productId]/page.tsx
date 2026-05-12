// Redirect — moved to /products/insights/[productId]
import { redirect } from "next/navigation";

interface PageProps { params: Promise<{ productId: string }> }

export default async function OldProductDetailRedirect({ params }: PageProps) {
  const { productId } = await params;
  redirect(`/products/insights/${productId}`);
}
