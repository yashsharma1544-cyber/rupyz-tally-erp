import { PageHeader } from "@/components/layout/page-header";
import { BeatsClient } from "./beats-client";

export const dynamic = "force-dynamic";

export default function BeatsPage() {
  return (
    <>
      <PageHeader title="Beats" subtitle="Routes / territories" />
      <BeatsClient />
    </>
  );
}
