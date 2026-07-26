import type { Metadata } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import { AppProviders } from "@/components/providers/app-providers";
import { getUserFromToken, ACCESS_TOKEN_COOKIE_KEY } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import "./globals.css";

const bodyFont = localFont({
  src: "./fonts/source-sans-3/SourceSans3-400-700.woff2",
  display: "swap",
  variable: "--font-body",
  style: "normal",
  weight: "400 700",
});

const uiFont = localFont({
  src: [
    {
      path: "./fonts/be-vietnam-pro/BeVietnamPro-500.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/be-vietnam-pro/BeVietnamPro-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/be-vietnam-pro/BeVietnamPro-700.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-ui",
});

const metricFont = localFont({
  src: "./fonts/josefin-sans/JosefinSans-500-700.woff2",
  display: "swap",
  variable: "--font-metric",
  style: "normal",
  weight: "500 700",
  preload: false,
});

export const metadata: Metadata = {
  title: "TPRO Classio",
  description: "Hệ thống quản lý học viên và học phí TPRO English Center",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_KEY)?.value ?? null;
  const initialUser = getUserFromToken(accessToken);

  return (
    <html lang="vi" className={cn(bodyFont.variable, uiFont.variable, metricFont.variable)}>
      <body className="min-h-screen bg-background text-gray-900 antialiased">
        <AppProviders initialUser={initialUser}>{children}</AppProviders>
      </body>
    </html>
  );
}
