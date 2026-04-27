import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Rupyz · Tally ERP",
  description: "Order management for Sushil Agencies",
  manifest: "/manifest.json",
  applicationName: "Sushil Agencies VAN",
  appleWebApp: {
    capable: true,
    title: "VAN",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0d5b58",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="relative z-10">{children}</div>
        <Toaster
          position="top-center"
          richColors
          closeButton
          duration={4500}
          toastOptions={{
            unstyled: false,
            classNames: {
              // Keep types tinted (richColors handles that), but force solid surface + readable text
              toast:
                "!bg-white !text-[#0e1414] !border !border-[#e6e1d7] !shadow-lg !rounded-md !text-sm !font-medium",
              title: "!font-semibold !text-[#0e1414]",
              description: "!text-[#4a5959]",
              success: "!bg-[#e3efe5] !text-[#1f6b3a] !border-[#1f6b3a]/30",
              error: "!bg-[#f5e3e3] !text-[#9a2929] !border-[#9a2929]/30",
              warning: "!bg-[#f7ecd5] !text-[#8a5a00] !border-[#8a5a00]/30",
              info: "!bg-[#e8f0ef] !text-[#0d5b58] !border-[#0d5b58]/30",
              closeButton:
                "!bg-white !border !border-[#e6e1d7] !text-[#4a5959] hover:!bg-[#f3efe8] !opacity-100 !top-2 !right-2 !left-auto !w-6 !h-6 !rounded-full",
            },
          }}
        />
      </body>
    </html>
  );
}
