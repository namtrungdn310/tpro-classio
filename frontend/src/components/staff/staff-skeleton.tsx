"use client";

import {
  STAFF_MANAGER_GRID,
  STAFF_PRIVATE_VIEWER_GRID,
  STAFF_PUBLIC_VIEWER_GRID,
} from "@/components/staff/staff-table";

export function StaffSkeleton({
  canManage,
  canViewPrivate,
}: {
  canManage: boolean;
  canViewPrivate: boolean;
}) {
  const gridClass = canManage
    ? STAFF_MANAGER_GRID
    : canViewPrivate
      ? STAFF_PRIVATE_VIEWER_GRID
      : STAFF_PUBLIC_VIEWER_GRID;
  const columnCount = canManage ? 5 : canViewPrivate ? 4 : 3;

  return (
    <div aria-hidden="true" className="h-full min-h-0 animate-pulse overflow-hidden">
      <div className="grid gap-3 xl:hidden">
        {Array.from({ length: 5 }, (_, row) => (
          <div key={row} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-20 rounded bg-gray-100" />
            <div className="mt-5 grid grid-cols-2 gap-4">
              {Array.from({ length: canViewPrivate ? 3 : 2 }, (_, cell) => (
                <div key={cell}>
                  <div className="h-3 w-16 rounded bg-gray-200" />
                  <div className="mt-2 h-4 rounded bg-gray-100" style={{ width: `${60 + ((row + cell) % 3) * 12}%` }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden h-full min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-white xl:flex xl:flex-col">
        <div className={`grid ${gridClass} shrink-0 border-b border-gray-200 bg-gray-50`}>
          {Array.from({ length: columnCount }, (_, index) => (
            <div key={index} className="px-2.5 py-3">
              <div className="h-3 w-16 rounded bg-gray-200" />
            </div>
          ))}
        </div>
        <div className="min-h-0 flex-1 divide-y divide-gray-100 overflow-hidden">
          {Array.from({ length: 9 }, (_, row) => (
            <div key={row} className={`grid ${gridClass} items-center`}>
              {Array.from({ length: columnCount }, (_, cell) => (
                <div key={cell} className="px-2.5 py-3">
                  <div
                    className="h-4 rounded bg-gray-100"
                    style={{ width: `${45 + ((row + cell) % 4) * 12}%` }}
                  />
                  {cell === 0 ? <div className="mt-1.5 h-3 w-20 rounded bg-gray-100" /> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
