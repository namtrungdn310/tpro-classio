"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import {
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
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
import { getClasses } from "@/lib/api/classes";
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
        detailWidthClassName="lg:grid-cols-[minmax(0,1fr)_150px]"
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
    queryKey: ["classes", { is_active: true }],
    queryFn: () => getClasses({ is_active: true }),
    enabled: Boolean(user),
  });

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

      <div className="dashboard-overview-no-selection grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(430px,0.82fr)_minmax(0,1.85fr)] 2xl:grid-cols-[500px_minmax(0,1fr)]">
        <OverviewMetricsSection query={overviewQuery} />

        <section className="min-h-0">
          {classesQuery.data ? (
            <WeeklyScheduleBoard
              classes={classes}
              detailDay={today}
              className="h-full min-h-0"
              detailWidthClassName="lg:grid-cols-[minmax(0,1fr)_150px]"
            />
          ) : classesQuery.isLoading ? (
            <WeeklyScheduleBoardSkeleton
              className="h-full min-h-0"
              detailWidthClassName="lg:grid-cols-[minmax(0,1fr)_150px]"
            />
          ) : (
            <DataSectionError
              className="h-full min-h-[520px]"
              title="Chưa tải được lịch học"
              description={getApiErrorMessage(
                classesQuery.error,
                "Không thể tải lịch học. Vui lòng thử lại.",
              )}
              isRetrying={classesQuery.isFetching}
              onRetry={() => void classesQuery.refetch()}
            />
          )}
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

function OverviewMetricsSection({
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
        className="xl:h-full"
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

  return <OverviewMetrics overview={overview} />;
}

function OverviewMetrics({ overview }: { overview: DashboardOverviewResponse }) {
  const teachingStaffCount =
    overview.summary.active_teacher_count + overview.summary.active_assistant_count;

  return (
    <section className="flex shrink-0 flex-col gap-3 xl:h-full xl:min-h-0">
      <div className="grid grid-cols-3 gap-2.5">
        <DashboardMetricCard
          delayMs={0}
          label="Học viên"
          value={String(overview.summary.active_student_count)}
          hint={
            overview.summary.active_student_count > 0
              ? "Đang học"
              : "Chưa có dữ liệu"
          }
        />
        <DashboardMetricCard
          delayMs={55}
          label="Lớp học"
          value={String(overview.summary.active_class_count)}
          hint={`${overview.summary.weekly_session_count} ca / tuần`}
        />
        <DashboardMetricCard
          delayMs={110}
          label="Đội ngũ"
          value={String(teachingStaffCount)}
          hint={
            `${overview.summary.active_teacher_count} giáo viên · ` +
            `${overview.summary.active_assistant_count} trợ giảng`
          }
        />
      </div>

      <DashboardFeeSummaryCard
        fees={overview.fees}
        revenueTrend={overview.revenue_trend}
      />
    </section>
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
