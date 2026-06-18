import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "TPRO Classio",
  description: "Hệ thống quản lý học viên và học phí TPRO English Center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={cn("font-sans", inter.variable)}>
      <body className="min-h-screen bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}
