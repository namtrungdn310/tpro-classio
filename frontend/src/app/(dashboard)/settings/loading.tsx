"use client";

import { useAuth } from "@/lib/hooks/useAuth";

export default function SettingsLoading() {
  const { user } = useAuth();
  const canManageUsers = Boolean(user?.is_owner);

  return (
    <div
      aria-busy="true"
      aria-label="Đang tải cài đặt"
      className={`scrollbar-hidden h-full min-h-0 overflow-x-hidden ${
        canManageUsers ? "overflow-y-auto min-[1360px]:overflow-y-hidden" : "overflow-y-auto"
      }`}
    >
      <div
        className={
          canManageUsers
            ? "grid min-w-0 gap-4 min-[1360px]:h-full min-[1360px]:grid-cols-[minmax(470px,500px)_minmax(0,1fr)]"
            : "mx-auto w-full max-w-[720px]"
        }
      >
        <div className="flex min-w-0 animate-pulse flex-col gap-4 min-[1360px]:h-full min-[1360px]:min-h-0">
          <div className="flex h-[216px] flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <div className="h-3 w-28 rounded bg-gray-200" />
            <div className="mt-2 h-9 rounded bg-gray-100" />
            <div className="h-9 rounded bg-gray-100" />
            <div className="mt-auto h-8 w-24 self-end rounded-md bg-gray-200" />
          </div>
          <div className="flex h-[248px] flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <div className="h-3 w-36 rounded bg-gray-200" />
            <div className="mt-2 h-9 rounded bg-gray-100" />
            <div className="h-9 rounded bg-gray-100" />
            <div className="mt-auto h-8 w-24 self-end rounded-md bg-gray-200" />
          </div>
        </div>

        {canManageUsers ? (
          <div className="min-h-[420px] min-w-0 animate-pulse min-[1360px]:min-h-0">
            <div className="flex h-full min-h-[420px] flex-col rounded-xl border border-gray-200 bg-white p-4">
              <div className="h-3 w-32 rounded bg-gray-200" />
              <div className="mt-3 h-8 rounded bg-gray-100" />
              <div className="mt-2 h-8 rounded bg-gray-100" />
              <div className="mt-3 flex-1 rounded bg-gray-50" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}