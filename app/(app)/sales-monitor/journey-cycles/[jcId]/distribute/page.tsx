import { redirect } from "next/navigation";

// The old per-JC Distribute screen has been replaced by the Sales Monitor
// "Targets" tab (Area → Beat → Customer cascade, Rupyz shares, manual override).
// This route now redirects there so any old links/bookmarks land in the right place.
export default function DistributeRedirect() {
  redirect("/sales-monitor?tab=targets");
}
