import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dispatch · Sushil Agencies",
  manifest: "/manifest-dispatch.json",
  applicationName: "Sushil Agencies Dispatch",
  appleWebApp: {
    capable: true,
    title: "Dispatch",
    statusBarStyle: "default",
  },
};

export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
