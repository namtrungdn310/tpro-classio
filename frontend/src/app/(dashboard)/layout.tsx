"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/layout/navbar";
import { TabNav } from "@/components/layout/tab-nav";
import { AuthProvider, useAuth } from "@/lib/hooks/useAuth";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DashboardContent>{children}</DashboardContent>
    </AuthProvider>
  );
}

function DashboardContent({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { getMeSilently, isLoading, user } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void getMeSilently();
    }, 10 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [getMeSilently, user]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Đang kiểm tra phiên đăng nhập...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 bg-white">
        <Navbar />
        <TabNav />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
