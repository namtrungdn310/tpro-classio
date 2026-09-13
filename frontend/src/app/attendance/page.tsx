"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RiCheckboxCircleLine, RiLogoutBoxRLine, RiRefreshLine, RiTimeLine } from "react-icons/ri";
import { checkInAttendance, getAttendanceToday } from "@/lib/api/attendance";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useAuth } from "@/lib/hooks/useAuth";
import { useToast } from "@/components/providers/toast-provider";
import { LoadingLabel } from "@/components/ui/loading-label";
import { PendingActionButton } from "@/components/ui/pending-action-button";

const queryKey = ["attendance", "me", "today"] as const;

export default function AttendancePage() {
  const { isLoading, logout, user } = useAuth();
  const queryClient = useQueryClient();
  const notify = useToast();
  const attendanceQuery = useQuery({
    queryKey,
    queryFn: getAttendanceToday,
    enabled: user?.role === "teacher",
    staleTime: 30_000,
  });
  const checkinMutation = useMutation({
    mutationFn: checkInAttendance,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      notify.success("Đã ghi nhận chấm công.");
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể chấm công lúc này.")),
  });

  useEffect(() => {
    if (!isLoading && user && user.role !== "teacher") {
      window.location.replace("/");
    }
  }, [isLoading, user]);

  if (isLoading || !user || user.role !== "teacher") {
    return <AttendancePageSkeleton />;
  }

  if (attendanceQuery.isPending && attendanceQuery.data === undefined) {
    return <AttendancePageSkeleton />;
  }

  const checkins = new Map((attendanceQuery.data?.checkins ?? []).map((item) => [item.key, item]));
  const occurrences = attendanceQuery.data?.occurrences ?? [];

  return (
    <main className="min-h-dvh bg-gray-50 px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-ui text-sm font-semibold text-primary">TPRO English</p>
            <h1 className="mt-1 font-ui text-2xl font-bold text-gray-950">Chấm công</h1>
            <p className="mt-1 text-sm text-gray-500">{user.full_name || user.username || user.email}</p>
          </div>
          <button type="button" onClick={() => void logout()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            <RiLogoutBoxRLine aria-hidden className="h-5 w-5" /> Đăng xuất
          </button>
        </header>

        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="attendance-list-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="attendance-list-title" className="font-ui text-lg font-bold text-gray-950">Lịch được phân công</h2>
              <p className="mt-1 text-sm text-gray-500">Hôm nay và 7 ngày sắp tới</p>
            </div>
            <button type="button" disabled={attendanceQuery.isFetching} onClick={() => void attendanceQuery.refetch()} aria-label="Làm mới lịch" className="grid h-11 w-11 place-items-center rounded-xl border border-gray-200 text-gray-600 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50">
              <RiRefreshLine aria-hidden className={`h-5 w-5 ${attendanceQuery.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>

          {attendanceQuery.isPending ? <div className="py-14 text-center text-sm text-gray-500"><LoadingLabel label="Đang tải lịch" /></div> : null}
          {attendanceQuery.isError ? (
            <div className="mt-5 rounded-xl bg-red-50 px-4 py-4 text-sm text-red-700" role="alert">
              <p>Không thể tải lịch chấm công.</p>
              <button type="button" onClick={() => void attendanceQuery.refetch()} className="mt-3 min-h-11 rounded-lg border border-red-200 bg-white px-4 font-semibold">Thử lại</button>
            </div>
          ) : null}
          {!attendanceQuery.isPending && !attendanceQuery.isError && occurrences.length === 0 ? (
            <div className="py-14 text-center"><RiTimeLine aria-hidden className="mx-auto h-7 w-7 text-gray-400" /><p className="mt-3 text-sm font-medium text-gray-600">Chưa có buổi học được phân công.</p></div>
          ) : null}

          <div className="mt-4 space-y-3">
            {occurrences.map((occurrence) => {
              const checked = checkins.get(occurrence.key);
              const start = new Date(occurrence.original_start_at);
              const end = new Date(occurrence.original_end_at);
              return (
                <article key={occurrence.occurrence_id} className="rounded-xl border border-gray-200 px-4 py-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-ui text-base font-semibold text-gray-950">{new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" }).format(start)}</p>
                      <p className="mt-1 text-sm text-gray-600">{formatTime(start)}–{formatTime(end)}{occurrence.kind === "MAKEUP" ? " · Buổi bù" : ""}</p>
                    </div>
                    {checked ? (
                      <div className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 sm:self-auto"><RiCheckboxCircleLine aria-hidden className="h-5 w-5" /> Đã chấm công</div>
                    ) : (
                      <PendingActionButton type="button" isPending={checkinMutation.isPending} pendingLabel="Đang ghi nhận" onClick={() => checkinMutation.mutate(occurrence.occurrence_id)} className="min-h-11 self-stretch rounded-xl bg-gray-950 px-4 text-sm font-semibold text-white transition hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto">Chấm công</PendingActionButton>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

function AttendancePageSkeleton() {
  return (
    <main className="min-h-dvh animate-pulse bg-gray-50 px-4 py-5 sm:px-6" aria-hidden="true">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-start justify-between gap-4"><div><div className="h-4 w-28 rounded bg-gray-200" /><div className="mt-3 h-7 w-40 rounded bg-gray-200" /><div className="mt-2 h-4 w-48 rounded bg-gray-100" /></div><div className="h-11 w-28 rounded-xl bg-gray-200" /></div>
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5"><div className="h-6 w-48 rounded bg-gray-200" /><div className="mt-2 h-4 w-36 rounded bg-gray-100" /><div className="mt-6 space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-xl bg-gray-100" />)}</div></div>
      </div>
    </main>
  );
}
