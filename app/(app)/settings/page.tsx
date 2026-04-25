import { PageHeader } from "@/components/layout/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Integration & system configuration" />
      <div className="p-6 max-w-2xl space-y-4">
        <Card title="Rupyz fetcher" detail="Coming in Phase 2 — login number, polling interval, OTP webhook URL." />
        <Card title="Tally bridge"  detail="Coming in Phase 4 — local agent registration, manual sync trigger." />
        <Card title="WATi WhatsApp" detail="Coming in Phase 5 — API key, template IDs, sender number." />
      </div>
    </>
  );
}

function Card({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-ink-muted mt-1">{detail}</p>
    </div>
  );
}
