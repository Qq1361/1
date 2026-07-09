import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Resale ERP",
    template: "%s | Resale ERP",
  },
  description: "二手商品采购、验货、库存、销售与结算管理",
  applicationName: "Resale ERP",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/app-icon.svg",
    apple: "/icons/app-icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <AppShell>{children}</AppShell>
        <Toaster richColors />
      </body>
    </html>
  );
}
