"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, LoaderCircle, Plus, SearchX } from "lucide-react";
import { ArchiveClassDialog } from "@/components/classes/archive-class-dialog";
import { ClassFormDialog } from "@/components/classes/class-form-dialog";
import { ClassesSkeleton, ClassesTable } from "@/components/classes/classes-table";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { useToast } from "@/components/providers/toast-provider";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { LoadingLabel } from "@/components/ui/loading-label";
import { archiveClass, createClass, getClasses, updateClass } from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getActiveTeacherOptions } from "@/lib/api/staff";
import {
  CLASS_DAYS,
  COURSE_DURATION_OPTIONS,
  filterAndSortPreparedClasses,
  prepareClassRecords,
} from "@/lib/classes/presentation";
import { useAuth } from "@/lib/hooks/useAuth";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import type { ClassCreate, ClassResponse, ClassType, ClassUpdate } from "@/lib/types";
import { staffQueryKeys } from "@/lib/staff/query-keys";

const ACTIVE_CLASSES_QUERY_KEY = ["classes", { is_active: true }] as const;
const ACTIVE_TEACHERS_QUERY_KEY = staffQueryKeys.teacherOptions;
const EMPTY_CLASSES: ClassResponse[] = [];

export default function ClassesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const notify = useToast();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = usePersistentState("tpro:classes:search", "");
  const deferredSearch = useDeferredValue(search);
  const [type, setType] = useState<ClassType | "">("");
  const [selectedDay, setSelectedDay] = useState("");
  const [courseDuration, setCourseDuration] = useState("");
  const [editingClass, setEditingClass] = useState<ClassResponse | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ClassResponse | null>(null);

  const classesQuery = useQuery({
    queryKey: ACTIVE_CLASSES_QUERY_KEY,
    queryFn: () => getClasses({ is_active: true }),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const teachersQuery = useQuery({
    queryKey: ACTIVE_TEACHERS_QUERY_KEY,
    queryFn: getActiveTeacherOptions,
    enabled: Boolean(isAdmin),
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: true,
  });

  function refreshDependencies() {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["classes"] }),
      queryClient.invalidateQueries({ queryKey: ["students"] }),
      queryClient.invalidateQueries({ queryKey: ["fees"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  }

  const createMutation = useMutation({
    mutationFn: createClass,
    onSuccess: (created) => {
      queryClient.setQueryData<ClassResponse[]>(ACTIVE_CLASSES_QUERY_KEY, (current = []) => [
        created,
        ...current.filter((class_) => class_.id !== created.id),
      ]);
      closeForm();
      notify.success("Đã thêm lớp học.");
      refreshDependencies();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể thêm lớp học.")),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ClassUpdate }) => updateClass(id, values),
    onSuccess: (updated) => {
      queryClient.setQueryData<ClassResponse[]>(ACTIVE_CLASSES_QUERY_KEY, (current = []) =>
        current.map((class_) => (class_.id === updated.id ? updated : class_)),
      );
      closeForm();
      notify.success("Đã cập nhật lớp học.");
      refreshDependencies();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể cập nhật lớp học.")),
  });
  const archiveMutation = useMutation({
    mutationFn: archiveClass,
    onSuccess: (_response, archivedId) => {
      queryClient.setQueryData<ClassResponse[]>(ACTIVE_CLASSES_QUERY_KEY, (current = []) =>
        current.filter((class_) => class_.id !== archivedId),
      );
      setArchiveTarget(null);
      notify.success("Đã ngừng hoạt động lớp học.");
      refreshDependencies();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể ngừng hoạt động lớp học.")),
  });

  function openCreateForm() {
    if (isAdmin && teachersQuery.isPending && teachersQuery.data === undefined) {
      return;
    }
    setEditingClass(null);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingClass(null);
  }

  function clearFilters() {
    setSearch("");
    setType("");
    setSelectedDay("");
    setCourseDuration("");
  }

  const classes = classesQuery.data ?? EMPTY_CLASSES;
  const preparedClasses = useMemo(() => prepareClassRecords(classes), [classes]);
  const filteredClasses = useMemo(
    () =>
      filterAndSortPreparedClasses(preparedClasses, {
        search: deferredSearch,
        type,
        courseDuration,
        day: selectedDay,
      }),
    [courseDuration, deferredSearch, preparedClasses, selectedDay, type],
  );
  const hasData = classesQuery.data !== undefined;
  const hasBlockingError = classesQuery.isError && !hasData;
  const hasCachedError = classesQuery.isError && hasData;
  const isTeacherOptionsInitialLoading = Boolean(
    isAdmin && teachersQuery.isPending && teachersQuery.data === undefined,
  );
  const isInitialLoading =
    !hasBlockingError &&
    ((classesQuery.isPending && !hasData) || isTeacherOptionsInitialLoading);
  const hasFilters = Boolean(search.trim() || type || selectedDay || courseDuration);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const filters = (
    <HeaderFilterControls
      searchPlaceholder="Tìm lớp, giáo viên, lịch học..."
      searchValue={search}
      onSearchChange={setSearch}
      onClear={clearFilters}
      filters={[
        {
          label: "Hình thức học phí",
          value: type,
          onChange: (value) => {
            const next = value as ClassType | "";
            setType(next);
            if (next === "MONTHLY") setCourseDuration("");
          },
          options: [
            { label: "Theo tháng", value: "MONTHLY" },
            { label: "Theo gói", value: "COURSE" },
          ],
        },
        {
          label: "Thời lượng gói",
          value: courseDuration,
          hidden: type !== "COURSE" && !courseDuration,
          onChange: (value) => {
            setCourseDuration(value);
            if (value) setType("COURSE");
          },
          options: COURSE_DURATION_OPTIONS.map((option) => ({
            label: option.label,
            value: String(option.months),
          })),
        },
        {
          label: "Ngày học",
          value: selectedDay,
          onChange: setSelectedDay,
          options: CLASS_DAYS.map((day) => ({ label: day, value: day })),
        },
      ]}
    />
  );
  const classCountStatus = (
    <span
      aria-live="polite"
      title={`${classes.length} lớp đang hoạt động`}
      className="caption-text inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-gray-600"
    >
      {classesQuery.isFetching && hasData ? (
        <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <span
          className={`h-2 w-2 rounded-full ${classes.length ? "bg-emerald-500" : "bg-gray-300"}`}
          aria-hidden="true"
        />
      )}
      {classes.length} lớp đang hoạt động
    </span>
  );
  const addButton = isAdmin ? (
    <button
      type="button"
      onClick={openCreateForm}
      disabled={isTeacherOptionsInitialLoading}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-gray-950 px-3 text-sm font-medium text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-wait disabled:opacity-60"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      Thêm lớp
    </button>
  ) : null;

  return (
    <div className="flex min-h-0 flex-col gap-3 md:h-full md:overflow-hidden">
      <HeaderControlsPortal>
        <div className="flex min-w-0 items-center gap-3">
          {filters}
          {classCountStatus}
          {addButton}
        </div>
      </HeaderControlsPortal>
      <div className="flex min-w-0 flex-wrap items-center gap-2 md:hidden">
        {filters}
        {classCountStatus}
        {addButton}
      </div>

      {hasCachedError ? (
        <div role="status" className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>Chưa cập nhật được dữ liệu mới nhất; danh sách đã lưu vẫn đang được hiển thị.</span>
          <button type="button" disabled={classesQuery.isFetching} onClick={() => void classesQuery.refetch()} className="shrink-0 font-medium underline underline-offset-2 disabled:opacity-50">
            {classesQuery.isFetching ? <LoadingLabel label="Đang thử lại" /> : "Thử lại"}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 md:flex-1 md:overflow-hidden">
        {isInitialLoading ? <ClassesSkeleton isAdmin={isAdmin} /> : null}
        {hasBlockingError ? (
          <DataSectionError
            className="md:h-full"
            title="Không tải được danh sách lớp học"
            description={getApiErrorMessage(classesQuery.error, "Kết nối dữ liệu đang gián đoạn. Vui lòng thử lại.")}
            isRetrying={classesQuery.isFetching}
            onRetry={() => void classesQuery.refetch()}
          />
        ) : null}
        {!isInitialLoading && !hasBlockingError && classes.length === 0 ? (
          <DataSectionEmpty
            className="md:h-full"
            icon={GraduationCap}
            title="Chưa có lớp học đang hoạt động"
            description={isAdmin ? "Tạo lớp đầu tiên để phân công giáo viên, lịch học và học viên." : "Danh sách sẽ xuất hiện khi quản trị viên tạo lớp học."}
            actionLabel={isAdmin ? "Thêm lớp" : undefined}
            onAction={isAdmin ? openCreateForm : undefined}
          />
        ) : null}
        {!isInitialLoading && !hasBlockingError && classes.length > 0 && filteredClasses.length === 0 ? (
          <DataSectionEmpty
            className="md:h-full"
            icon={SearchX}
            title="Không tìm thấy lớp phù hợp"
            description="Thử từ khóa khác hoặc xóa các bộ lọc đang áp dụng."
            actionLabel={hasFilters ? "Xóa tìm kiếm và bộ lọc" : undefined}
            onAction={hasFilters ? clearFilters : undefined}
          />
        ) : null}
        {!isInitialLoading && !hasBlockingError && filteredClasses.length > 0 ? (
          <ClassesTable
            classes={filteredClasses}
            isAdmin={isAdmin}
            selectedDay={selectedDay}
            onEdit={(class_) => { setEditingClass(class_); setIsFormOpen(true); }}
            onArchive={setArchiveTarget}
          />
        ) : null}
      </div>

      {isFormOpen && isAdmin ? (
        <ClassFormDialog
          class_={editingClass}
          classes={classes}
          teachers={teachersQuery.data ?? []}
          isTeachersLoading={teachersQuery.isPending && teachersQuery.data === undefined}
          isTeachersError={teachersQuery.isError}
          isSaving={isSaving}
          onClose={closeForm}
          onRetryTeachers={() => void teachersQuery.refetch()}
          onSubmit={(payload: ClassCreate) => {
            if (editingClass) updateMutation.mutate({ id: editingClass.id, values: payload });
            else createMutation.mutate(payload);
          }}
        />
      ) : null}
      {archiveTarget && isAdmin ? (
        <ArchiveClassDialog
          class_={archiveTarget}
          isArchiving={archiveMutation.isPending}
          onClose={() => setArchiveTarget(null)}
          onConfirm={() => archiveMutation.mutate(archiveTarget.id)}
        />
      ) : null}
    </div>
  );
}
