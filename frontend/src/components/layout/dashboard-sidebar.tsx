"use client";

import Image from "next/image";
import Link from "next/link";
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
      className="dashboard-sidebar hidden select-none md:fixed md:bottom-0 md:left-0 md:top-0 md:z-50 md:flex md:shrink-0 md:flex-col md:overflow-hidden md:border-r md:border-slate-200 md:bg-slate-50"
    >
      <div className="flex shrink-0 items-center px-3 pb-2 pt-3">
        <Link
          href="/"
          aria-label="Tổng quan"
          title="Về trang tổng quan"
          className="flex w-full min-w-0 items-center gap-2 rounded-lg py-1 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <Image
            src="/logo-mark.png"
            alt="TPRO"
            width={78}
            height={78}
            sizes="26px"
            quality={100}
            className="h-[26px] w-[26px] shrink-0 object-contain"
            priority
          />
          <span className="min-w-0 text-left">
            <span className="font-ui block truncate text-sm font-semibold leading-4 text-gray-900">
              TPRO English
            </span>
            <span className="font-body-ui block truncate text-xs font-medium leading-4 text-slate-600">
              Classio
            </span>
          </span>
        </Link>
      </div>

      <TabNav />

      <div className="mt-auto px-3 py-3">
        <button
          type="button"
          onClick={onLogout}
          aria-label="Đăng xuất"
          className="font-ui inline-flex h-10 w-full items-center justify-start gap-3 overflow-hidden rounded-xl px-3 text-sm font-medium text-slate-600 outline-none transition-[background-color,color] duration-200 ease-out hover:bg-primary-soft/70 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <NavigationIcon icon={LOGOUT_NAVIGATION_ICON} />
          <span className="whitespace-nowrap">Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
