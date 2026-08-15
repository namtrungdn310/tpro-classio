"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import {
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  RiLoader4Line as LoaderCircle,
  RiRefreshLine as RefreshCw,
} from "react-icons/ri";
import { DashboardFeeSummaryCard } from "@/components/dashboard/dashboard-fee-summary";
import { DashboardMetricCard } from "@/components/dashboard/dashboard-metric-card";
import { DashboardMetricsSkeleton } from "@/components/dashboard/dashboard-overview-skeleton";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import {
  getTodayLabel,
  WeeklyScheduleBoardSkeleton,
} from "@/components/layout/weekly-schedule-board";
import { Button } from "@/components/ui/button";
import { DataSectionError } from "@/components/ui/data-section-state";
import {
  getClasses,
  getEffectiveOccurrences,
  type EffectiveOccurrenceSummary,
} from "@/lib/api/classes";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { getDashboardOverview } from "@/lib/api/dashboard";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useAuth } from "@/lib/hooks/useAuth";
import type { ClassResponse, DashboardOverviewResponse } from "@/lib/types";
import { getClassSortKey } from "@/lib/utils/class-groups";
import { formatCompactDateTime, formatPeriod } from "@/lib/utils/format";

const WeeklyScheduleBoard = dynamic(
  () =>
    import("@/components/layout/weekly-schedule-board").then(
      (module) => module.WeeklyScheduleBoard,
    ),
  {
    ssr: false,
    loading: () => (
      <WeeklyScheduleBoardSkeleton
        className="h-full min-h-0"
        detailWidthClassName="lg:grid-cols-[minmax(0,1fr)_220px]"
      />
    ),
  },
);

export default function DashboardPage() {
  const { user } = useAuth();
  const overviewQuery = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: getDashboardOverview,
    enabled: Boolean(user),
  });
  const classesQuery = useQuery({
    queryKey: classQueryKeys.list("active"),
    queryFn: () => getClasses({ scope: "active" }),
    enabled: Boolean(user),
  });

  const weekRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    const day = (now.getDay() + 6) % 7;
    start.setDate(now.getDate() - day);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      from: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      to: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`,
    };
  }, []);
  const occurrencesQuery = useQuery({
    queryKey: classQueryKeys.effectiveOccurrences(weekRange.from, weekRange.to),
    queryFn: () => getEffectiveOccurrences(weekRange.from, weekRange.to),
    enabled: Boolean(user),
    staleTime: 30_000,
  });
  const occurrencesByClass = useMemo(() => {
    const map = new Map<string, EffectiveOccurrenceSummary["occurrences"]>();
    for (const entry of occurrencesQuery.data ?? []) {
      map.set(entry.class_id, entry.occurrences);
    }
    return map;
  }, [occurrencesQuery.data]);

  const overview = overviewQuery.data;
  const classes = useMemo(
    () => sortClasses(classesQuery.data ?? []),
    [classesQuery.data],
  );
  const today = getTodayLabel();
  const isRefreshing = overviewQuery.isFetching || classesQuery.isFetching;
  const hasRefreshError =
    (overviewQuery.isError && Boolean(overview)) ||
    (classesQuery.isError && Boolean(classesQuery.data));
  const lastUpdatedAt = Math.max(
    overviewQuery.dataUpdatedAt || 0,
    classesQuery.dataUpdatedAt || 0,
  );

  function refreshDashboard() {
    void Promise.all([overviewQuery.refetch(), classesQuery.refetch()]);
  }

  return (
    <>
      <HeaderControlsPortal>
        <DashboardHeaderStatus
          isRefreshing={isRefreshing}
          hasRefreshError={hasRefreshError}
          lastUpdatedAt={lastUpdatedAt}
          period={overview?.summary.period}
          onRefresh={refreshDashboard}
        />
      </HeaderControlsPortal>

      <div className="dashboard-overview-no-selection mb-3 flex min-h-8 items-center justify-between gap-3 md:hidden">
        <p className="caption-text rounded-md bg-gray-100 px-2 py-1 text-gray-600">
          {overview ? formatPeriod(overview.summary.period) : "Dữ liệu hiện tại"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={isRefreshing}
          aria-label="Làm mới tổng quan"
          onClick={refreshDashboard}
        >
          {isRefreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>

      <div className="dashboard-overview-no-selection flex h-full min-h-0 flex-col gap-4">
        <section className="shrink-0">
          <OverviewTopSection query={overviewQuery} />
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-2.5">
          <ScheduleToolbar
            weeklySessionCount={overview?.summary.weekly_session_count}
          />
          <div className="min-h-0 flex-1">
            {classesQuery.data ? (
              <WeeklyScheduleBoard
                classes={classes}
                detailDay={today}
                className="h-full min-h-0"
                detailWidthClassName="lg:grid-cols-[minmax(0,1fr)_220px]"
                occurrencesByClass={occurrencesByClass}
              />
            ) : classesQuery.isLoading ? (
              <WeeklyScheduleBoardSkeleton
                className="h-full min-h-0"
                detailWidthClassName="lg:grid-cols-[minmax(0,1fr)_220px]"
              />
            ) : (
              <DataSectionError
                className="h-full min-h-[360px]"
                title="Chưa tải được lịch học"
                description={getApiErrorMessage(
                  classesQuery.error,
                  "Không thể tải lịch học. Vui lòng thử lại.",
                )}
                isRetrying={classesQuery.isFetching}
                onRetry={() => void classesQuery.refetch()}
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function DashboardHeaderStatus({
  hasRefreshError,
  isRefreshing,
  lastUpdatedAt,
  onRefresh,
  period,
}: {
  hasRefreshError: boolean;
  isRefreshing: boolean;
  lastUpdatedAt: number;
  onRefresh: () => void;
  period?: string;
}) {
  return (
    <div className="dashboard-overview-no-selection flex min-w-0 items-center gap-2">
      {period ? (
        <span className="caption-text inline-flex shrink-0 rounded-md bg-gray-100 px-2 py-1 text-gray-600">
          {formatPeriod(period)}
        </span>
      ) : null}
      <span
        aria-live="polite"
        className={`caption-text hidden truncate xl:inline ${
          hasRefreshError ? "text-amber-700" : "text-gray-500"
        }`}
      >
        {hasRefreshError
          ? "Chưa cập nhật được dữ liệu mới"
          : isRefreshing
            ? "Đang cập nhật..."
            : lastUpdatedAt
              ? `Cập nhật ${formatCompactDateTime(lastUpdatedAt)}`
              : "Đang chuẩn bị dữ liệu"}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={isRefreshing}
        aria-label="Làm mới tổng quan"
        title="Làm mới dữ liệu"
        onClick={onRefresh}
      >
        {isRefreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
      </Button>
    </div>
  );
}

function OverviewTopSection({
  query,
}: {
  query: UseQueryResult<DashboardOverviewResponse, Error>;
}) {
  const overview = query.data;

  if (!overview && query.isLoading) {
    return <DashboardMetricsSkeleton />;
  }

  if (!overview) {
    return (
      <DataSectionError
        className="min-h-[180px]"
        title="Chưa tải được số liệu tổng quan"
        description={getApiErrorMessage(
          query.error,
          "Không thể tải số liệu tổng quan. Vui lòng thử lại.",
        )}
        isRetrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(300px,0.35fr)_minmax(0,0.65fr)]">
      <OverviewMetrics overview={overview} />
      <DashboardFeeSummaryCard
        fees={overview.fees}
        className="h-full"
      />
    </div>
  );
}

function OverviewMetrics({ overview }: { overview: DashboardOverviewResponse }) {
  const summary = overview.summary;

  return (
    <div className="grid auto-rows-fr grid-cols-2 gap-3">
      <DashboardMetricCard
        delayMs={0}
        label="Học viên"
        value={String(summary.active_student_count)}
        hint="Đang học"
      />
      <DashboardMetricCard
        delayMs={55}
        label="Lớp học"
        value={String(summary.active_class_count)}
        hint={`${summary.weekly_session_count} ca / tuần`}
      />
      <DashboardMetricCard
        delayMs={110}
        label="Giáo viên"
        value={String(summary.active_teacher_count)}
        hint="Đang hoạt động"
      />
      <DashboardMetricCard
        delayMs={165}
        label="Trợ giảng"
        value={String(summary.active_assistant_count)}
        hint="Đang hoạt động"
      />
    </div>
  );
}

function ScheduleToolbar({
  weeklySessionCount,
}: {
  weeklySessionCount?: number;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 px-0.5">
      <h2 className="section-title-text text-gray-900">Lịch học tuần</h2>
      {typeof weeklySessionCount === "number" ? (
        <span className="caption-text rounded-md bg-gray-100 px-2 py-1 text-gray-600">
          {weeklySessionCount} ca / tuần
        </span>
      ) : null}
    </div>
  );
}

function sortClasses(classes: ClassResponse[]) {
  return [...classes].sort((a, b) => {
    const [sortA, nameA] = getClassSortKey(a.name);
    const [sortB, nameB] = getClassSortKey(b.name);

    if (sortA !== sortB) {
      return sortA - sortB;
    }

    return nameA.localeCompare(nameB, "vi");
  });
}
