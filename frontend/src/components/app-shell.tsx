"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

const tabs = [
  { href: "/", label: "Tổng quan" },
  { href: "/students", label: "Học viên" },
  { href: "/classes", label: "Lớp học" },
  { href: "/fees", label: "Học phí" },
  { href: "/report", label: "Báo cáo" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const token = window.localStorage.getItem("tpro_token");
    setIsAuthenticated(Boolean(token));
    setEmail(window.localStorage.getItem("tpro_user_email") ?? "");
  }, [pathname]);

  function handleLogout() {
    window.localStorage.removeItem("tpro_token");
    window.localStorage.removeItem("tpro_user_email");
    setIsAuthenticated(false);
    setEmail("");
    router.push("/login");
  }

  if (!isAuthenticated || pathname === "/login") {
    return children;
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <Image
              src="/logo-mark-bw.png"
              alt="TPRO"
              width={28}
              height={28}
              className="h-7 w-7 object-contain"
              priority
            />
            TPRO Classio
          </Link>
          <div className="flex items-center gap-3 text-sm text-gray-700">
            <span className="hidden sm:inline">{email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Đăng xuất
            </button>
          </div>
        </div>
        <nav className="mx-auto flex h-11 max-w-7xl items-end gap-6 overflow-x-auto px-4 sm:px-6">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={
                isActive(pathname, tab.href)
                  ? "whitespace-nowrap border-b-2 border-[#1F5C2E] pb-3 text-sm font-medium text-[#1F5C2E]"
                  : "whitespace-nowrap border-b-2 border-transparent pb-3 text-sm text-gray-600 hover:text-gray-900"
              }
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
