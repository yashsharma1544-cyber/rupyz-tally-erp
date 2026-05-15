import type { Metadata } from "next";
import { LanguageToggle } from "@/components/language-toggle";

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
