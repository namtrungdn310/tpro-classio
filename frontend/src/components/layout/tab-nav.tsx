"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  MAIN_NAVIGATION_ITEMS,
  NavigationIcon,
  SETTINGS_NAVIGATION_ITEM,
} from "@/components/layout/navigation-icons";
import { useAuth } from "@/lib/hooks/useAuth";
import { prefetchRouteData } from "@/lib/query-prefetch";
import {
  buildStudentsHref,
  getSelectedStudentClassFromSearchParams,
  readRememberedStudentClass,
  rememberStudentClass,
} from "@/lib/students/selected-class-route";

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname.startsWith(href);
}

export function TabNav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const visibleTabs = [...MAIN_NAVIGATION_ITEMS, SETTINGS_NAVIGATION_ITEM];

  function handlePrefetch(href: string) {
    const selectedStudentClassId =
      href === "/students" ? readRememberedStudentClass(user?.id) : "";
    router.prefetch(
      href === "/students" ? buildStudentsHref(selectedStudentClassId) : href,
    );
    void prefetchRouteData(queryClient, href, {
      isAdmin: user?.role === "admin",
      isOwner: Boolean(user?.is_owner),
      selectedStudentClassId,
    });
  }

  function handleTabClick(
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
    active: boolean,
  ) {
    if (active) {
      event.preventDefault();

      const currentStudentClassId =
        href === "/students"
          ? getSelectedStudentClassFromSearchParams(new URLSearchParams(window.location.search))
          : "";

      if (
        href === "/students" &&
        (currentStudentClassId || readRememberedStudentClass(user?.id))
      ) {
        rememberStudentClass(user?.id, "");
        router.push("/students");
      }

      return;
    }

    if (href !== "/students") {
      return;
    }

    const selectedStudentClassId = readRememberedStudentClass(user?.id);
    if (selectedStudentClassId) {
      event.preventDefault();
      router.push(buildStudentsHref(selectedStudentClassId));
    }
  }

  return (
    <>
      <nav className="flex w-full gap-1.5 overflow-x-auto px-4 py-2 md:hidden">
        {visibleTabs.map((tab) => {
          const active = isActive(pathname, tab.href);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              onMouseEnter={() => handlePrefetch(tab.href)}
              onFocus={() => handlePrefetch(tab.href)}
              onTouchStart={() => handlePrefetch(tab.href)}
              onClick={(event) => handleTabClick(event, tab.href, active)}
              className={
                active
                  ? "font-ui inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-[#F1F3F4] px-4 text-sm font-medium text-[#202124]"
                  : "font-ui inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#202124]"
              }
            >
              <NavigationIcon icon={Icon} opticalSize={tab.opticalSize} />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <nav className="hidden md:flex md:h-full md:flex-col md:items-stretch md:gap-2 md:px-3 md:py-3">
        {visibleTabs.map((tab) => {
          const active = isActive(pathname, tab.href);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-label={tab.label}
              onMouseEnter={() => handlePrefetch(tab.href)}
              onFocus={() => handlePrefetch(tab.href)}
              onTouchStart={() => handlePrefetch(tab.href)}
              onClick={(event) => handleTabClick(event, tab.href, active)}
              className={`font-ui inline-flex h-10 w-full items-center justify-start gap-3 overflow-hidden rounded-xl px-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200 ease-out ${
                active
                  ? "bg-[#F1F3F4] text-[#202124] shadow-sm"
                  : "text-[#5F6368] hover:-translate-y-0.5 hover:bg-[#F1F3F4] hover:text-[#202124] hover:shadow-sm"
              }`}
            >
              <NavigationIcon icon={Icon} opticalSize={tab.opticalSize} />
              <span className="min-w-0 truncate whitespace-nowrap">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
