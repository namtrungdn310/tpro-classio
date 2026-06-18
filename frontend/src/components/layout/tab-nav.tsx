"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function TabNav() {
  const pathname = usePathname();

  return (
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
  );
}
