"use client";

import { useSyncExternalStore } from "react";
import { HeaderLoadingControls } from "@/components/layout/header-loading-status";
import { getSelectedStudentClassFromSearchParams } from "@/lib/students/selected-class-route";
import {
  STUDENTS_TABLE_GRID_CLASS,
  STUDENTS_TABLE_VIEWER_GRID_CLASS,
} from "@/components/students/students-table-layout";

function subscribeToRoute(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

type StudentRouteSkeletonVariant = "class-detail" | "class-selection" | "profile";

function getStudentRouteSkeletonVariant(): StudentRouteSkeletonVariant {
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view");
  if (["unassigned", "stopped", "former", "archived"].includes(requestedView ?? "")) {
    return "profile";
  }
  return getSelectedStudentClassFromSearchParams(params)
    ? "class-detail"
    : "class-selection";
}

export function StudentsRouteSkeleton() {
  const variant = useSyncExternalStore(
    subscribeToRoute,
    getStudentRouteSkeletonVariant,
    () => "class-selection" as const,
  );

  return (
    <>
      <StudentHeaderLoadingSkeleton isAdmin />
      {variant === "class-detail" ? (
        <StudentClassDetailSkeleton isAdmin includeScopeTabs />
      ) : variant === "profile" ? (
        <StudentProfileScopeSkeleton isAdmin includeScopeTabs />
      ) : (
        <StudentClassSelectionSkeleton />
      )}
    </>
  );
}

export function StudentHeaderLoadingSkeleton({ isAdmin }: { isAdmin: boolean }) {
  return <HeaderLoadingControls actionCount={isAdmin ? 1 : 0} />;
}

export function StudentClassSelectionSkeleton({
  includeScopeTabs = true,
}: {
  includeScopeTabs?: boolean;
} = {}) {
  return (
    <div
      className="flex h-full min-h-64 animate-pulse flex-col gap-4"
      aria-hidden="true"
    >
      {includeScopeTabs ? <StudentScopeTabsSkeleton /> : null}
      <div className="min-h-0 flex-1 rounded-lg border border-gray-200 bg-white p-4">
        <div className="h-5 w-40 rounded bg-gray-200/80" />
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="min-h-[128px] rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

const PROFILE_TABLE_GRID_CLASS = "grid grid-cols-5 gap-x-4";

export function StudentProfileTableSkeleton() {
  const columnWidths = [72, 110, 80, 96, 120];

  return (
    <div
      className="scrollbar-hidden overflow-x-hidden md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-contain xl:overflow-hidden"
      aria-hidden="true"
    >
      <div className="grid animate-pulse gap-3 xl:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={index} className="rounded-md border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="h-4 w-40 rounded bg-gray-200" />
                <div className="mt-2 h-3 w-28 rounded bg-gray-100" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
              <div className="h-9 rounded bg-gray-100" />
              <div className="h-9 rounded bg-gray-100" />
              <div className="col-span-2 h-9 rounded bg-gray-100" />
            </div>
          </article>
        ))}
      </div>

      <div className="hidden animate-pulse overflow-hidden rounded-lg border border-gray-200 xl:h-full xl:min-h-0 xl:flex xl:flex-col">
        <div className="shrink-0 border-b border-gray-200 bg-gray-100">
          <div className={`${PROFILE_TABLE_GRID_CLASS} items-center`}>
            {columnWidths.map((width, index) => (
              <div key={index} className="px-2.5 py-3">
                <div
                  className="h-3 rounded bg-gray-200"
                  style={{ width: `${width}px`, maxWidth: "100%" }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="scrollbar-hidden min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain bg-white">
          <div className="divide-y divide-gray-200">
            {Array.from({ length: 8 }).map((_, rowIndex) => (
              <div key={rowIndex} className={`${PROFILE_TABLE_GRID_CLASS} cv-auto items-center`}>
                {columnWidths.map((width, cellIndex) => (
                  <div key={cellIndex} className="px-2.5 py-3">
                    <div
                      className="h-4 rounded bg-gray-100"
                      style={{
                        width: `${width + (rowIndex % 3) * 10}px`,
                        maxWidth: "100%",
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function StudentProfileScopeSkeleton({
  includeScopeTabs = false,
}: {
  includeScopeTabs?: boolean;
  isAdmin?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" aria-hidden="true">
      {includeScopeTabs ? <StudentScopeTabsSkeleton /> : null}
      <div className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="animate-pulse">
          <div className="h-5 w-56 rounded bg-gray-200" />
          <div className="mt-1 h-3.5 w-72 max-w-full rounded bg-gray-100" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <StudentProfileTableSkeleton />
      </div>
    </div>
  );
}

export function StudentClassDetailSkeleton({
  includeScopeTabs = false,
  isAdmin,
}: {
  includeScopeTabs?: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 md:h-full md:overflow-hidden" aria-hidden="true">
      {includeScopeTabs ? <StudentScopeTabsSkeleton /> : null}
      <div className="w-full rounded-md border border-gray-200 bg-white px-4 py-2.5">
        <div className="animate-pulse">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-5 w-24 rounded bg-gray-200" />
              <div className="h-6 w-36 rounded-md bg-gray-100" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 w-20 rounded-md bg-gray-100" />
              <div className="h-8 w-20 rounded-md bg-gray-100" />
            </div>
          </div>
        </div>
      </div>
      <StudentTableSkeleton isAdmin={isAdmin} />
    </div>
  );
}

export function StudentScopeTabsSkeleton() {
  return (
    <div className="shrink-0 rounded-xl border border-gray-200 bg-white p-1.5">
      <div className="grid grid-cols-3 gap-1">
        {["w-32", "w-36", "w-40"].map((labelWidth) => (
          <div
            key={labelWidth}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 md:min-h-9"
          >
            <div className={`h-4 ${labelWidth} rounded bg-gray-200/90`} />
            <div className="h-3.5 w-5 shrink-0 rounded bg-gray-200/90" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudentTableSkeleton({ isAdmin }: { isAdmin: boolean }) {
  const tableGridClass = isAdmin
    ? STUDENTS_TABLE_GRID_CLASS
    : STUDENTS_TABLE_VIEWER_GRID_CLASS;
  const columnWidths = [72, 52, 96, 68, 90, 94, 108];

  return (
    <div
      className="scrollbar-hidden overflow-x-hidden md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-contain xl:overflow-hidden"
      aria-hidden="true"
    >
      <div className="grid animate-pulse gap-3 xl:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={index} className="rounded-md border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="h-4 w-40 rounded bg-gray-200" />
                <div className="mt-2 h-3 w-28 rounded bg-gray-100" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
              <div className="h-9 rounded bg-gray-100" />
              <div className="h-9 rounded bg-gray-100" />
              <div className="col-span-2 h-9 rounded bg-gray-100" />
              <div className="col-span-2 h-9 rounded bg-gray-100" />
            </div>
          </article>
        ))}
      </div>

      <div className="hidden animate-pulse overflow-hidden rounded-md border border-gray-200 xl:h-full xl:min-h-0 xl:flex xl:flex-col">
        <div className="shrink-0 border-b border-gray-200 bg-gray-100">
          <div className={`${tableGridClass} items-center`}>
            {columnWidths.map((width, index) => (
              <div
                key={index}
                className={index === 4 ? "py-3 pl-4 pr-2.5" : "px-2.5 py-3"}
              >
                <div
                  className="h-3 rounded bg-gray-200"
                  style={{ width: `${width}px`, maxWidth: "100%" }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="scrollbar-hidden min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain bg-white">
          <div className="divide-y divide-gray-200">
            {Array.from({ length: 10 }).map((_, rowIndex) => (
              <div key={rowIndex} className={`${tableGridClass} cv-auto items-center`}>
                {columnWidths.map((width, cellIndex) => (
                  <div
                    key={cellIndex}
                    className={cellIndex === 4 ? "py-3 pl-4 pr-2.5" : "px-2.5 py-3"}
                  >
                    <div
                      className="h-4 rounded bg-gray-100"
                      style={{
                        width: `${width + (rowIndex % 3) * 10}px`,
                        maxWidth: "100%",
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
