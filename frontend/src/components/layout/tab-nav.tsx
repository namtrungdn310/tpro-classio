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
import { isManagementUser } from "@/lib/auth/permissions";
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
      isAdmin: isManagementUser(user),
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
              className={`font-ui relative inline-flex h-10 w-full items-center justify-start gap-3 overflow-hidden rounded-xl px-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200 ease-out ${
                active
                  ? "bg-primary-soft text-primary shadow-sm"
                  : "text-[#5F6368] hover:-translate-y-0.5 hover:bg-primary-soft/70 hover:text-primary hover:shadow-sm"
              }`}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
                />
              ) : null}
              <NavigationIcon icon={Icon} opticalSize={tab.opticalSize} />
              <span className="min-w-0 truncate whitespace-nowrap">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
  );
}
