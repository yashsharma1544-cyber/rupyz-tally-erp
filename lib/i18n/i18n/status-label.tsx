"use client";

// Helper to translate order status enum values consistently across the app.
// Use anywhere you currently display the raw `app_status` enum.

import { useTranslation } from "@/lib/i18n/context";

// Mirror of order_app_status enum from the database.
export type OrderAppStatus =
  | "received"
  | "approved"
  | "loading"
  | "partially_dispatched"
  | "dispatched"
  | "delivered"
  | "rejected"
  | "cancelled"
  | "closed"
  | "on_van_trip"
  | "historical";

export function useStatusLabel() {
  const { t } = useTranslation();
  return (status: string): string => t(`status.${status}`);
}

// Standalone component for rendering a status badge with translation.
export function StatusLabel({ status, className = "" }: { status: string; className?: string }) {
  const { t } = useTranslation();
  return <span className={className}>{t(`status.${status}`)}</span>;
}
