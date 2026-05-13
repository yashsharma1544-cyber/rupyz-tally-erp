import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Loading · Sushil Agencies",
  manifest: "/manifest-load.json",
  applicationName: "Sushil Agencies Loading",
  appleWebApp: {
    capable: true,
    title: "Loading",
    statusBarStyle: "default",
  },
};

export default function LoadLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
