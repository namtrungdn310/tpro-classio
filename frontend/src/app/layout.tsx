import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Be_Vietnam_Pro, Josefin_Sans, Source_Sans_3 } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { getUserFromToken, ACCESS_TOKEN_COOKIE_KEY } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import "./globals.css";

const bodyFont = Source_Sans_3({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-body",
  style: ["normal"],
});

const uiFont = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-ui",
  weight: ["500", "600", "700"],
  style: ["normal"],
});

const metricFont = Josefin_Sans({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-metric",
  weight: ["500", "600", "700"],
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
