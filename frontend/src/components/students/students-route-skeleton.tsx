"use client";

import { useSyncExternalStore } from "react";
import { getSelectedStudentClassFromSearchParams } from "@/lib/students/selected-class-route";
import {
  STUDENTS_TABLE_GRID_CLASS,
  STUDENTS_TABLE_VIEWER_GRID_CLASS,
} from "@/components/students/students-table-layout";

function subscribeToRoute(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function hasSelectedClassInCurrentUrl() {
  return Boolean(
    getSelectedStudentClassFromSearchParams(new URLSearchParams(window.location.search)),
  );
}

export function StudentsRouteSkeleton() {
  const hasSelectedClass = useSyncExternalStore(
    subscribeToRoute,
    hasSelectedClassInCurrentUrl,
    () => false,
  );

  return hasSelectedClass ? (
    <StudentClassDetailSkeleton isAdmin />
  ) : (
    <StudentClassSelectionSkeleton />
  );
}

export function StudentClassSelectionSkeleton() {
  return (
    <div
      className="flex h-full min-h-64 animate-pulse flex-col gap-4"
      aria-hidden="true"
    >
      <div className="h-8 w-full rounded-lg bg-gray-200/80" />
      <div className="min-h-0 flex-1 rounded-lg border border-gray-200 bg-white p-4">
        <div className="h-5 w-40 rounded bg-gray-200/80" />
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-28 rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function StudentClassDetailSkeleton({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-4 md:h-full md:overflow-hidden" aria-hidden="true">
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

export function StudentTableSkeleton({ isAdmin }: { isAdmin: boolean }) {
  const tableGridClass = isAdmin
    ? STUDENTS_TABLE_GRID_CLASS
    : STUDENTS_TABLE_VIEWER_GRID_CLASS;
  const columnWidths = isAdmin
    ? [72, 52, 96, 68, 90, 94, 108, 56]
    : [72, 52, 96, 68, 90, 94, 108];

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
              {isAdmin ? (
                <div className="flex shrink-0 gap-2">
                  <div className="h-7 w-7 rounded-md bg-gray-100" />
                  <div className="h-7 w-7 rounded-md bg-gray-100" />
                </div>
              ) : null}
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
        <div className="shrink-0 border-b border-gray-200 bg-gray-50">
          <div className={`${tableGridClass} items-center`}>
            {columnWidths.map((width, index) => (
              <div
                key={index}
                className={
                  isAdmin && index === 7
                    ? "flex justify-center px-2 py-3"
                    : index === 4
                      ? "py-3 pl-4 pr-2.5"
                      : "px-2.5 py-3"
                }
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
          <div className="divide-y divide-gray-100">
            {Array.from({ length: 10 }).map((_, rowIndex) => (
              <div key={rowIndex} className={`${tableGridClass} cv-auto items-center`}>
                {columnWidths.map((width, cellIndex) => (
                  <div
                    key={cellIndex}
                    className={
                      isAdmin && cellIndex === 7
                        ? "px-2 py-3"
                        : cellIndex === 4
                          ? "py-3 pl-4 pr-2.5"
                          : "px-2.5 py-3"
                    }
                  >
                    {isAdmin && cellIndex === 7 ? (
                      <div className="flex justify-center gap-1.5">
                        <div className="h-7 w-7 rounded-md bg-gray-100" />
                        <div className="h-7 w-7 rounded-md bg-gray-100" />
                      </div>
                    ) : (
                      <div
                        className="h-4 rounded bg-gray-100"
                        style={{
                          width: `${width + (rowIndex % 3) * 10}px`,
                          maxWidth: "100%",
                        }}
                      />
                    )}
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
