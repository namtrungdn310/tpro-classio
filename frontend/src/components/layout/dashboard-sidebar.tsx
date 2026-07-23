"use client";

import Image from "next/image";
import { TabNav } from "@/components/layout/tab-nav";
import {
  LOGOUT_NAVIGATION_ICON,
  NavigationIcon,
} from "@/components/layout/navigation-icons";

type DashboardSidebarProps = {
  onLogout: () => void;
};

export function DashboardSidebar({ onLogout }: DashboardSidebarProps) {
  return (
    <aside
      id="dashboard-sidebar"
      className="dashboard-sidebar hidden md:fixed md:bottom-0 md:left-0 md:top-0 md:z-50 md:flex md:shrink-0 md:flex-col md:overflow-hidden md:border-r md:border-[#DADCE0] md:bg-white"
    >
      <div className="flex h-14 shrink-0 items-center px-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          aria-label="Tải lại trang"
          title="Tải lại trang"
          className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
        >
          <Image
            src="/logo-mark-bw.png"
            alt="TPRO"
            width={28}
            height={28}
            className="h-[27px] w-[27px] shrink-0 object-contain"
            priority
          />
          <span className="min-w-0 text-left">
            <span className="font-ui block truncate text-sm font-semibold leading-4 text-[#202124]">
              TPRO English
            </span>
            <span className="font-body-ui block truncate text-[11px] font-medium leading-4 text-[#7A7F85]">
              Classio
            </span>
          </span>
        </button>
      </div>

      <TabNav />

      <div className="mt-auto px-3 py-3">
        <button
          type="button"
          onClick={onLogout}
          aria-label="Đăng xuất"
          className="font-ui inline-flex h-10 w-full items-center justify-start gap-3 overflow-hidden rounded-xl px-3 text-sm font-medium text-[#5F6368] outline-none transition-[background-color,color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#F1F3F4] hover:text-[#202124] focus-visible:ring-2 focus-visible:ring-gray-300"
        >
          <NavigationIcon icon={LOGOUT_NAVIGATION_ICON} />
          <span className="whitespace-nowrap">Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
