import { PageHeader } from "@/components/layout/page-header";
import { SalesmenClient } from "./salesmen-client";

export const dynamic = "force-dynamic";

export default function SalesmenPage() {
  return (
    <>
      <PageHeader title="Salesmen" subtitle="5 field salesmen" />
      <SalesmenClient />
    </>
  );
}
