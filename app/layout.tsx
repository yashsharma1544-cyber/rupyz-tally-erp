import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Rupyz · Tally ERP",
  description: "Order management for Sushil Agencies",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="relative z-10">{children}</div>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "var(--background, #faf7f2)",
              color: "var(--foreground, #0e1414)",
              border: "1px solid #e6e1d7",
            },
          }}
        />
      </body>
    </html>
  );
}
