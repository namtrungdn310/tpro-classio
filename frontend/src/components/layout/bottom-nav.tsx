"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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

/** Mobile bottom navigation bar (icons only, like a native app tab bar).
 *  Portaled to <body> so no ancestor transform/contain/filter can break its
 *  fixed positioning — the standard approach for fixed overlays. */
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const visibleTabs = [...MAIN_NAVIGATION_ITEMS, SETTINGS_NAVIGATION_ITEM];

  useEffect(() => setMounted(true), []);

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
    event: React.MouseEvent<HTMLAnchorElement>,
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

  if (!mounted) return null;

  return createPortal(
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-50 flex select-none items-stretch border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(15,23,42,0.06)] md:hidden"
    >
      {visibleTabs.map((tab) => {
        const active = isActive(pathname, tab.href);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-label={tab.label}
            title={tab.label}
            onMouseEnter={() => handlePrefetch(tab.href)}
            onFocus={() => handlePrefetch(tab.href)}
            onTouchStart={() => handlePrefetch(tab.href)}
            onClick={(event) => handleTabClick(event, tab.href, active)}
            className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${
              active ? "text-primary" : "text-gray-500"
            }`}
          >
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-6 top-0 h-0.5 rounded-b-full bg-primary"
              />
            ) : null}
            <NavigationIcon icon={Icon} opticalSize={tab.opticalSize} />
          </Link>
        );
      })}
    </nav>,
    document.body,
  );
}
