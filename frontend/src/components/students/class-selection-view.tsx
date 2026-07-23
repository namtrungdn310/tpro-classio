"use client";

import { useDeferredValue, useMemo } from "react";
import {
  ChevronRight,
  GraduationCap,
  LoaderCircle,
  RefreshCw,
  SearchX,
  UsersRound,
} from "lucide-react";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import type { ClassResponse, ClassType } from "@/lib/types";
import { getClassGroupInfo } from "@/lib/utils/class-groups";
import { formatCurrency, getCourseWeeks } from "@/lib/utils/format";
import { filterAndSortClassSelection } from "@/lib/students/class-selection";

type ClassSelectionViewProps = {
  classDuration: string;
  classes: ClassResponse[];
  classSearch: string;
  classType: ClassType | "";
  errorDescription: string;
  isError: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  onClassDurationChange: (value: string) => void;
  onClassSearchChange: (value: string) => void;
  onClassTypeChange: (value: ClassType | "") => void;
  onPrefetchClass: (classId: string) => void;
  onRetry: () => void;
  onSelectClass: (classId: string) => void;
};

export function ClassSelectionView({
  classDuration,
  classes,
  classSearch,
  classType,
  errorDescription,
  isError,
  isLoading,
  isRefreshing,
  onClassDurationChange,
  onClassSearchChange,
  onClassTypeChange,
  onPrefetchClass,
  onRetry,
  onSelectClass,
}: ClassSelectionViewProps) {
  const deferredClassSearch = useDeferredValue(classSearch);
  const filteredClasses = useMemo(
    () => filterAndSortClassSelection(classes, {
      duration: classDuration,
      search: deferredClassSearch,
      type: classType,
    }),
    [classDuration, classes, classType, deferredClassSearch],
  );
  const courseDurationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          classes
            .filter((class_) => class_.type === "COURSE")
            .map((class_) => class_.billing_cycle_months),
        ),
      )
        .sort((first, second) => first - second)
        .map((months) => ({
          label: `${getCourseWeeks(months)} tuần`,
          value: String(months),
        })),
    [classes],
  );
  const hasActiveFilters = Boolean(classSearch.trim() || classType || classDuration);
  const hasCachedData = classes.length > 0;
  const hasBlockingError = isError && !hasCachedData;
  const resultLabel = hasActiveFilters
    ? `${filteredClasses.length}/${classes.length} lớp đang hoạt động`
    : `${classes.length} lớp đang hoạt động`;

  function clearFilters() {
    onClassSearchChange("");
    onClassTypeChange("");
    onClassDurationChange("");
  }

  const filterControls = (
    <HeaderFilterControls
      searchPlaceholder="Tìm theo tên lớp..."
      searchValue={classSearch}
      onSearchChange={onClassSearchChange}
      onClear={clearFilters}
      filters={[
        {
          label: "Hình thức học phí",
          value: classType,
          onChange: (value) => {
            const nextType = value as ClassType | "";
            onClassTypeChange(nextType);
            if (nextType !== "COURSE") {
              onClassDurationChange("");
            }
          },
          options: [
            { label: "Theo tháng", value: "MONTHLY" },
            { label: "Theo gói", value: "COURSE" },
          ],
        },
        {
          label: "Thời lượng gói",
          value: classDuration,
          hidden: classType !== "COURSE" || courseDurationOptions.length === 0,
          onChange: (value) => {
            onClassDurationChange(value);
            if (value) onClassTypeChange("COURSE");
          },
          options: courseDurationOptions,
        },
      ]}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 md:h-full md:overflow-hidden">
      <HeaderControlsPortal>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {filterControls}
          <ActiveClassStatus label={resultLabel} hasActiveClasses={classes.length > 0} />
          {isRefreshing ? (
            <span className="caption-text hidden items-center gap-1.5 text-gray-500 2xl:inline-flex">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Đang cập nhật
            </span>
          ) : null}
        </div>
      </HeaderControlsPortal>

      <div className="space-y-2 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {filterControls}
          <ActiveClassStatus label={resultLabel} hasActiveClasses={classes.length > 0} compact />
        </div>
        <p className="caption-text px-0.5 text-gray-500">Chọn một lớp để xem danh sách.</p>
      </div>

      {isError && hasCachedData ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
        >
          <p className="helper-text">Chưa cập nhật được dữ liệu mới. Danh sách gần nhất vẫn được giữ lại.</p>
          <button
            type="button"
            disabled={isRefreshing}
            onClick={onRetry}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold hover:bg-amber-100 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Thử lại
          </button>
        </div>
      ) : null}

      {isLoading ? <ClassCardsSkeleton /> : null}

      {hasBlockingError ? (
        <DataSectionError
          className="md:flex-1"
          title="Chưa tải được danh sách lớp"
          description={errorDescription}
          isRetrying={isRefreshing}
          onRetry={onRetry}
        />
      ) : null}

      {!isLoading && !isError && classes.length === 0 ? (
        <DataSectionEmpty
          className="md:flex-1"
          icon={GraduationCap}
          title="Chưa có lớp học"
          description="Hãy tạo lớp học trước khi thêm và quản lý học viên."
        />
      ) : null}

      {!isLoading && !hasBlockingError && hasCachedData && filteredClasses.length === 0 ? (
        <DataSectionEmpty
          className="md:flex-1"
          icon={SearchX}
          title="Không tìm thấy lớp phù hợp"
          description="Thử từ khóa khác hoặc xóa các bộ lọc đang áp dụng."
          actionLabel="Xóa tìm kiếm và bộ lọc"
          onAction={clearFilters}
        />
      ) : null}

      {!isLoading && !hasBlockingError && filteredClasses.length > 0 ? (
        <div className="min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="grid gap-3 pb-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredClasses.map((class_) => (
              <ClassSelectionCard
                key={class_.id}
                class_={class_}
                onPrefetch={() => onPrefetchClass(class_.id)}
                onSelect={() => onSelectClass(class_.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ClassSelectionCard({
  class_,
  onPrefetch,
  onSelect,
}: {
  class_: ClassResponse;
  onPrefetch: () => void;
  onSelect: () => void;
}) {
  const group = getClassGroupInfo(class_.name);
  const teacherNames = class_.teacher_names?.length
    ? class_.teacher_names
    : class_.teacher_name
      ? [class_.teacher_name]
      : [];
  const billingLabel = class_.type === "COURSE"
    ? `${getCourseWeeks(class_.billing_cycle_months)} tuần`
    : "tháng";

  return (
    <button
      type="button"
      title={class_.name}
      aria-label={`Mở lớp ${class_.name}, ${class_.student_count} học viên`}
      onFocus={onPrefetch}
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
      onClick={onSelect}
      className="group relative flex min-h-[128px] flex-col overflow-hidden rounded-lg border px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.035)] transition-shadow duration-150 hover:shadow-[0_3px_10px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1967D2]/30"
      style={{
        backgroundColor: group.color.background,
        borderColor: group.color.border,
      }}
    >
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-ui line-clamp-2 text-[16px] font-semibold leading-5 text-gray-950">
            {class_.name}
          </h2>
          <p className="mt-1 truncate text-xs text-gray-600">
            {teacherNames.length > 0 ? teacherNames.join(", ") : "Chưa phân công giáo viên"}
          </p>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold"
          style={{ color: group.color.text }}
        >
          <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
          {class_.student_count}
        </span>
      </div>

      <div className="mt-2.5 flex w-full items-center justify-between gap-3 border-t border-black/5 pt-2.5">
        <span className="text-[13px] font-semibold text-gray-800">
          {formatCurrency(class_.base_fee)} <span className="font-normal text-gray-500">/ {billingLabel}</span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </button>
  );
}

function ClassCardsSkeleton() {
  return (
    <div className="min-h-0 md:flex-1 md:overflow-hidden">
      <div className="grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="min-h-[128px] rounded-lg border border-gray-200 bg-white px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="h-4 w-24 rounded bg-gray-200" />
              <div className="h-4 w-8 rounded bg-gray-100" />
            </div>
            <div className="mt-2 h-3 w-32 rounded bg-gray-100" />
            <div className="mt-4 border-t border-gray-100 pt-2">
              <div className="h-3 w-28 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActiveClassStatus({
  compact = false,
  hasActiveClasses,
  label,
}: {
  compact?: boolean;
  hasActiveClasses: boolean;
  label: string;
}) {
  return (
    <span
      aria-live="polite"
      className={`caption-text inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-gray-600 ${compact ? "text-[11px]" : ""}`}
      title={label}
    >
      <span
        className={`h-2 w-2 rounded-full ${hasActiveClasses ? "bg-emerald-500" : "bg-gray-300"}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}
