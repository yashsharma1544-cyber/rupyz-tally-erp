import type { Metadata } from "next";
import { LanguageToggle } from "@/components/language-toggle";

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
