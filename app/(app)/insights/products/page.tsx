// Redirect — moved to /products/insights as a tab on the products page.
import { redirect } from "next/navigation";

export default function OldInsightsProductsRedirect() {
  redirect("/products/insights");
}
