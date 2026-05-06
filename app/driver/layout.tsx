import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Driver · Sushil Agencies",
  manifest: "/manifest-driver.json",
  applicationName: "Sushil Agencies Driver",
  appleWebApp: {
    capable: true,
    title: "Driver",
    statusBarStyle: "default",
  },
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
