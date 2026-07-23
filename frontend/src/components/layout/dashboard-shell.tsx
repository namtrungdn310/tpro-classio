"use client";

import { ReactNode, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/hooks/useAuth";
import { prefetchRouteData } from "@/lib/query-prefetch";
import { Navbar } from "@/components/layout/navbar";
import { TabNav } from "@/components/layout/tab-nav";
import { DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { LoadingLabel } from "@/components/ui/loading-label";


export function DashboardShell({ children }: { children: ReactNode }) {
  return <DashboardContent>{children}</DashboardContent>;
}

function DashboardContent({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const { getMeSilently, isLoading, isLoggingOut, isSessionUnavailable, logout, user } = useAuth();
  const lockScrollToPanel =
    pathname === "/" ||
    pathname.startsWith("/classes") ||
    pathname.startsWith("/students") ||
    pathname.startsWith("/fees") ||
    pathname.startsWith("/report") ||
    pathname.startsWith("/staff") ||
    pathname.startsWith("/settings");
  const isDashboardRoute = pathname === "/";

  useEffect(() => {
    if (!isLoading && !isSessionUnavailable && !user) {
      router.replace("/login");
    }
  }, [isLoading, isSessionUnavailable, router, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    const handle = globalThis.setTimeout(() => {
      void (async () => {
        if (cancelled) {
          return;
        }

        await prefetchRouteData(queryClient, pathname, {
          isAdmin: user.role === "admin",
          isOwner: Boolean(user.is_owner),
        });
      })();
    }, 240);

    return () => {
      cancelled = true;
      globalThis.clearTimeout(handle);
    };
  }, [pathname, queryClient, user]);

  useEffect(() => {
    if (!lockScrollToPanel) {
      return;
    }

    function syncScrollLock() {
      const shouldLock = window.innerWidth >= 768;
      document.documentElement.style.overflow = shouldLock ? "hidden" : "";
      document.body.style.overflow = shouldLock ? "hidden" : "";
    }

    syncScrollLock();
    window.addEventListener("resize", syncScrollLock);

    return () => {
      window.removeEventListener("resize", syncScrollLock);
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, [lockScrollToPanel]);

  if (isLoggingOut) return <DashboardSessionScreen label="Đang đăng xuất" />;
  if (isLoading) return <DashboardSessionScreen label="Đang tải" />;

  if (!user && isSessionUnavailable) {
    return (
      <div className="flex h-[100dvh] w-screen items-center justify-center bg-[#F8FAFD] px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white px-6 py-6 text-center shadow-sm">
          <p className="font-ui text-[15px] font-semibold text-gray-950">
            Chưa thể kiểm tra phiên đăng nhập
          </p>
          <p className="mt-2 text-sm leading-5 text-gray-500">
            Kết nối đang tạm thời gián đoạn. Phiên của bạn vẫn được giữ an toàn.
          </p>
          <button
            type="button"
            onClick={() => void getMeSilently()}
            className="mt-4 h-9 rounded-lg bg-gray-950 px-4 text-sm font-semibold text-white transition hover:bg-gray-800"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={lockScrollToPanel ? "dashboard-app min-h-screen bg-[#F8FAFD] md:h-screen md:overflow-hidden" : "dashboard-app min-h-screen bg-[#F8FAFD]"}>
      <header className="dashboard-header fixed inset-x-0 top-0 z-40 border-b border-gray-100 bg-white">
        <Navbar />
      </header>
      <div className={lockScrollToPanel ? "pt-14 md:flex md:h-full md:overflow-hidden" : "pt-14 md:flex"}>
        <DashboardSidebar onLogout={() => void logout()} />
        <div className={`dashboard-content min-w-0 flex-1 ${lockScrollToPanel ? "md:h-full md:overflow-hidden" : ""}`}>
          <div className="bg-white md:hidden">
            <TabNav />
          </div>
          <main
            className={lockScrollToPanel
              ? isDashboardRoute
                ? "w-full overflow-x-hidden px-4 py-5 md:h-full md:overflow-y-auto md:px-5 md:py-4"
                : "w-full px-4 py-5 md:h-full md:overflow-hidden md:px-5 md:py-4"
              : "w-full px-4 py-5 md:px-5 md:py-4"}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function DashboardSessionScreen({ label }: { label: string }) {
  return (
    <div className="flex h-[100dvh] w-screen items-center justify-center bg-[#F8FAFD] px-4">
      <div
        role="status"
        aria-live="polite"
        className="flex min-w-[176px] flex-col items-center rounded-2xl border border-gray-200/80 bg-white px-8 py-7 shadow-sm"
      >
        <div className="relative h-12 w-12">
          <Image
            src="/logo-mark-bw.png"
            alt="TPRO"
            fill
            className="object-contain"
            priority
          />
        </div>
        <div className="mt-3 text-center">
          <p className="font-ui text-[15px] font-semibold leading-5 text-gray-950">TPRO English</p>
          <p className="font-body-ui text-xs font-medium leading-5 text-gray-500">Classio</p>
        </div>
        <div className="caption-text mt-4 select-none text-gray-500">
          <LoadingLabel label={label} />
        </div>
      </div>
    </div>
  );
}
