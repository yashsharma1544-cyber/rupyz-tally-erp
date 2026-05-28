import { redirect } from "next/navigation";

// The per-JC single-salesman planning screen has been replaced by the
// consolidated PJP view at /sales-monitor/journey-cycles (JC dropdown +
// all-salesmen grid). This route now redirects there with the JC preselected,
// so old links/bookmarks still work.
export default function JcDetailRedirect({ params }: { params: { jcId: string } }) {
  redirect(`/sales-monitor/journey-cycles?jc=${params.jcId}`);
}
