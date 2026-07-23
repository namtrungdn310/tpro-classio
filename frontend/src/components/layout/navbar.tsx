"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  LOGOUT_NAVIGATION_ICON,
  NavigationIcon,
} from "@/components/layout/navigation-icons";
import { useAuth } from "@/lib/hooks/useAuth";

export function Navbar() {
  const router = useRouter();
  const { logout, user } = useAuth();
  const displayName = user?.username || user?.full_name || user?.email?.split("@")[0] || "Tài khoản";
  const avatarLetter = displayName.charAt(0).toLocaleUpperCase("vi-VN");
  const roleLabel = user?.is_owner ? "Dev" : user?.role === "admin" ? "Admin" : "Viewer";

  async function handleLogout() {
    await logout();
  }

  function handleRefresh() {
    window.location.reload();
  }

  function handleOpenSettings() {
    router.push("/settings");
  }

  return (
    <div className="flex min-h-14 w-full items-center justify-between gap-2.5 px-3 py-2">
      <button
        type="button"
        onClick={handleRefresh}
        className="font-ui flex min-w-0 items-center gap-2 text-sm font-medium text-[#202124] md:hidden"
        aria-label="Tải lại trang"
        title="Tải lại trang"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-transparent md:hidden sm:h-9 sm:w-9">
          <Image
            src="/logo-mark-bw.png"
            alt="TPRO"
            width={24}
            height={24}
            className="h-[22px] w-[22px] object-contain sm:h-[25px] sm:w-[25px]"
            priority
          />
        </span>
        <span className="truncate text-[15px]">TPRO Classio</span>
      </button>
      <div
        id="dashboard-header-controls"
        className="hidden min-w-0 flex-1 items-center justify-start md:flex md:pl-2"
      />
      <div className="flex min-w-0 items-center gap-2 text-sm text-[#5F6368] md:pr-2.5">
        <button
          type="button"
          onClick={handleOpenSettings}
          className="font-ui hidden min-w-0 items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-left md:flex"
          aria-label="Mở cài đặt tài khoản"
          title="Mở cài đặt"
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 bg-cover bg-center text-xs font-semibold text-gray-900"
            style={user?.avatar_url ? { backgroundImage: `url(${user.avatar_url})` } : undefined}
            aria-hidden="true"
          >
            {user?.avatar_url ? null : avatarLetter}
          </span>
          <span className="min-w-0">
            <span className="block max-w-[150px] truncate text-xs font-semibold leading-4 text-gray-900 xl:max-w-[200px]">
              {displayName}
            </span>
            <span className="block text-[11px] font-medium leading-3 text-gray-500">{roleLabel}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void handleLogout()}
          aria-label="Đăng xuất"
          title="Đăng xuất"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-[#1967D2] md:hidden"
        >
          <NavigationIcon icon={LOGOUT_NAVIGATION_ICON} />
        </button>
      </div>
    </div>
  );
}
