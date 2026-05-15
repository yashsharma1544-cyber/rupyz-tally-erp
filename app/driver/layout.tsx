import type { Metadata } from "next";
import { LanguageToggle } from "@/components/language-toggle";

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
  return (
    <>
      {/* Floating language toggle (top-right). Translations themselves are wired
          page-by-page in Phase B. */}
      <div className="fixed top-2 right-2 z-50">
        <LanguageToggle />
      </div>
      {children}
    </>
  );
}
