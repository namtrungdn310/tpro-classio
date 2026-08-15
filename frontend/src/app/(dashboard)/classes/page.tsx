"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RiAddLine as Plus, RiGraduationCapLine as GraduationCap, RiSearchLine as SearchX } from "react-icons/ri";
import { ClassFormDialog } from "@/components/classes/class-form-dialog";
import { ClassWorkspaceDialog } from "@/components/classes/class-workspace-dialog";
import {
  ClassesSkeleton,
  ClassesTable,
  HistoricalClassesSkeleton,
} from "@/components/classes/classes-table";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { useToast } from "@/components/providers/toast-provider";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { LoadingLabel } from "@/components/ui/loading-label";
import { QuickActionFab } from "@/components/ui/quick-action-fab";
import {
  completeMakeup,
  createClass,
  createPostponement,
  deleteClass,
  getClassScopeSummary,
  getClasses,
  restoreOriginalSession,
  scheduleMakeup,
  unscheduleMakeup,
  updateClass,
} from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getActiveTeacherOptions } from "@/lib/api/staff";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { CLASS_DAYS, filterAndSortPreparedClasses, prepareClassRecords } from "@/lib/classes/presentation";
import { useAuth } from "@/lib/hooks/useAuth";
import { isManagementUser } from "@/lib/auth/permissions";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import { getCourseWeeks } from "@/lib/utils/format";
import type {
  ClassCategory,
  ClassCreate,
  ClassResponse,
  ClassScope,
  ClassScopeSummary,
  ClassType,
  ClassUpdate,
  ExceptionCommandResponse,
  MakeupCommandRequest,
  MakeupScheduleRequest,
  PostponementCreateRequest,
  PostponementCreateResponse,
} from "@/lib/types";
import { staffQueryKeys } from "@/lib/staff/query-keys";

const ACTIVE_TEACHERS_QUERY_KEY = staffQueryKeys.teacherOptions;
const EMPTY_CLASSES: ClassResponse[] = [];

const SCOPE_TABS: { scope: ClassScope; summaryKey: keyof ClassScopeSummary; label: string; emptyTitle: string; emptyDescription: string }[] = [
  { scope: "operational", summaryKey: "operational", label: "Đang hoạt động", emptyTitle: "Chưa có lớp đang hoạt động", emptyDescription: "Tạo lớp mới để phân công giáo viên, lịch học và học viên." },
  { scope: "scheduled", summaryKey: "scheduled", label: "Sắp mở", emptyTitle: "Chưa có lớp sắp mở", emptyDescription: "Các lớp có ngày bắt đầu trong tương lai sẽ xuất hiện ở đây." },
  { scope: "completed", summaryKey: "completed", label: "Đã kết thúc", emptyTitle: "Chưa có lớp đã kết thúc", emptyDescription: "Các lớp đã kết thúc vẫn giữ nguyên hồ sơ học viên và lịch sử giảng dạy." },
  { scope: "cancelled", summaryKey: "cancelled", label: "Đã hủy", emptyTitle: "Chưa có lớp đã hủy", emptyDescription: "Các lớp được hủy sẽ vẫn có lịch sử riêng tại đây." },
];

type ClassWorkspaceState = {
  class: ClassResponse;
  mode: "edit" | "history" | "makeup";
};

export default function ClassesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const notify = useToast();
  const isAdmin = isManagementUser(user);
  const [storedScope, setScope] = usePersistentState<ClassScope>("tpro:classes:scope", "operational");
  const [search, setSearch] = usePersistentState("tpro:classes:search", "");
  const deferredSearch = useDeferredValue(search);
  const [type, setType] = useState<ClassType | "">("");
  const [category, setCategory] = useState<ClassCategory | "">("");
  const [selectedDay, setSelectedDay] = useState("");
  const [courseDuration, setCourseDuration] = useState("");
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [workspace, setWorkspace] = useState<ClassWorkspaceState | null>(null);
  const scope = SCOPE_TABS.some((tab) => tab.scope === storedScope) ? storedScope : "operational";
  const isOperationalScope = scope === "operational" || scope === "scheduled";
  const classesQueryKey = classQueryKeys.list(scope);

  useEffect(() => {
    if (scope !== storedScope) setScope(scope);
  }, [scope, setScope, storedScope]);

  const classesQuery = useQuery({
    queryKey: classesQueryKey,
    queryFn: () => getClasses({ scope }),
    enabled: Boolean(user),
    staleTime: 45_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const classSummaryQuery = useQuery({
    queryKey: classQueryKeys.summary(),
    queryFn: getClassScopeSummary,
    enabled: Boolean(user),
    staleTime: 30_000,
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

  /** Targeted invalidation matrix — không bao giờ invalidate toàn bộ fees
   * khi mutation chỉ ảnh hưởng lịch/lifecycle. */
  function invalidateClassScopeData() {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: classQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  }

  const createMutation = useMutation({
    mutationFn: createClass,
    onSuccess: () => {
      setIsCreateFormOpen(false);
      notify.success("Đã thêm lớp học.");
      invalidateClassScopeData();
      setScope("operational");
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể thêm lớp học.")),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ClassUpdate }) => updateClass(id, values),
    onSuccess: () => {
      setWorkspace(null);
      notify.success("Đã cập nhật lớp học.");
      invalidateClassScopeData();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể cập nhật lớp học.")),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteClass,
    onSuccess: () => {
      setWorkspace(null);
      notify.success("Đã hủy lớp học. Lịch sử vẫn được giữ lại.");
      invalidateClassScopeData();
      setScope("cancelled");
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể hủy lớp học.")),
  });
  const makeupMutation = useMutation({
    mutationFn: ({
      action,
      exceptionId,
      payload,
    }: {
      action: "postpone" | "schedule" | "unschedule" | "complete" | "restore";
      exceptionId: string;
      payload: object;
    }): Promise<PostponementCreateResponse | ExceptionCommandResponse> => {
      switch (action) {
        case "postpone":
          return createPostponement(workspace?.class.id ?? "", payload as PostponementCreateRequest);
        case "schedule":
          return scheduleMakeup(exceptionId, payload as MakeupScheduleRequest);
        case "unschedule":
          return unscheduleMakeup(exceptionId, payload as MakeupCommandRequest);
        case "complete":
          return completeMakeup(exceptionId, payload as MakeupCommandRequest);
        case "restore":
          return restoreOriginalSession(exceptionId, payload as MakeupCommandRequest);
      }
    },
    onSuccess: () => {
      notify.success("Đã cập nhật buổi học bù.");
      invalidateClassScopeData();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể cập nhật buổi học bù.")),
  });

  function openCreateForm() {
    if (isAdmin && teachersQuery.isPending && teachersQuery.data === undefined) return;
    setIsCreateFormOpen(true);
  }
  function openClassWorkspace(class_: ClassResponse) {
    const canEdit = isAdmin && isOperationalScope && class_.can_edit === true;
    setWorkspace({ class: class_, mode: canEdit ? "edit" : "history" });
  }
  function clearFilters() {
    setSearch(""); setType(""); setCategory(""); setSelectedDay(""); setCourseDuration("");
  }
  function selectScope(nextScope: ClassScope) {
    setScope(nextScope);
    clearFilters();
  }

  const classes = classesQuery.data ?? EMPTY_CLASSES;
  const courseDurationOptions = useMemo(() => Array.from(new Set(classes.flatMap((class_) => class_.type === "COURSE" && class_.billing_cycle_weeks ? [class_.billing_cycle_weeks] : class_.type === "COURSE" ? [getCourseWeeks(class_.billing_cycle_months)] : []))).sort((left, right) => left - right).map((weeks) => ({ label: `${weeks} tuần`, value: String(weeks) })), [classes]);
  const preparedClasses = useMemo(() => prepareClassRecords(classes), [classes]);
  const filteredClasses = useMemo(() => filterAndSortPreparedClasses(preparedClasses, { search: deferredSearch, type, category, courseDuration, day: selectedDay }), [category, courseDuration, deferredSearch, preparedClasses, selectedDay, type]);
  const hasData = classesQuery.data !== undefined;
  const hasBlockingError = classesQuery.isError && !hasData;
  const hasCachedError = classesQuery.isError && hasData;
  const isTeacherOptionsInitialLoading = Boolean(isAdmin && teachersQuery.isPending && teachersQuery.data === undefined);
  const isInitialLoading = !hasBlockingError && ((classesQuery.isPending && !hasData) || isTeacherOptionsInitialLoading);
  const hasFilters = Boolean(search.trim() || type || category || selectedDay || courseDuration);
  const currentScope = SCOPE_TABS.find((tab) => tab.scope === scope) ?? SCOPE_TABS[0];

  const filters = <HeaderFilterControls searchPlaceholder="Tìm lớp, giáo viên, lịch học..." searchValue={search} onSearchChange={setSearch} onClear={clearFilters} filters={[
    { label: "Loại lớp", value: category, onChange: (value) => setCategory(value as ClassCategory | ""), options: [{ label: "Phổ thông", value: "GENERAL" }, { label: "Thi Chuyên", value: "SPECIALIZED" }, { label: "IELTS", value: "IELTS" }, { label: "Custom", value: "CUSTOM" }] },
    { label: "Hình thức đóng học phí", value: type, onChange: (value) => { const next = value as ClassType | ""; setType(next); if (next === "MONTHLY") setCourseDuration(""); }, options: [{ label: "Theo tháng", value: "MONTHLY" }, { label: "Theo gói", value: "COURSE" }] },
    { label: "Thời lượng gói", value: courseDuration, hidden: type !== "COURSE" && !courseDuration, onChange: (value) => { setCourseDuration(value); if (value) setType("COURSE"); }, options: courseDurationOptions },
    { label: "Ngày học", value: selectedDay, onChange: setSelectedDay, options: CLASS_DAYS.map((day) => ({ label: day, value: day })) },
  ]} />;
  const addButton = isAdmin ? <button type="button" onClick={openCreateForm} disabled={isTeacherOptionsInitialLoading} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-wait disabled:opacity-60"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Thêm lớp</button> : null;

  return <div className="font-body-ui flex min-h-0 flex-col gap-3 md:h-full md:overflow-hidden">
    <HeaderControlsPortal><div className="flex min-w-0 items-center gap-3">{filters}{addButton}</div></HeaderControlsPortal>
    <div className="flex min-w-0 flex-wrap items-center gap-2 md:hidden">{filters}{addButton}</div>
    <nav aria-label="Phạm vi danh sách lớp" className="flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 scrollbar-hidden">
      {SCOPE_TABS.map((tab) => <button key={tab.scope} type="button" aria-pressed={scope === tab.scope} onPointerDown={(event) => event.preventDefault()} onClick={() => selectScope(tab.scope)} className={`font-ui inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${scope === tab.scope ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20" : "font-medium text-gray-600 hover:bg-primary-soft/60 hover:text-primary"}`}><span className={`h-1.5 w-1.5 rounded-full ${tab.scope === "operational" ? "bg-emerald-500" : tab.scope === "scheduled" ? "bg-primary" : tab.scope === "completed" ? "bg-gray-400" : "bg-destructive"}`} aria-hidden="true" />{tab.label}<span className={`min-w-4 text-right text-[12px] font-semibold tabular-nums ${scope === tab.scope ? "text-primary" : "text-gray-500"}`}>{classSummaryQuery.data?.[tab.summaryKey] ?? "–"}</span></button>)}
    </nav>
    {hasCachedError ? <div role="status" className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"><span>Chưa cập nhật được dữ liệu mới nhất; danh sách đang hiển thị có thể chưa đầy đủ.</span><button type="button" disabled={classesQuery.isFetching} onClick={() => void classesQuery.refetch()} className="shrink-0 font-medium underline underline-offset-2 disabled:opacity-50">{classesQuery.isFetching ? <LoadingLabel label="Đang thử lại" /> : "Thử lại"}</button></div> : null}
    <div className="min-h-0 md:flex-1 md:overflow-hidden">
      {isInitialLoading
        ? scope === "operational" || scope === "scheduled"
          ? <ClassesSkeleton />
          : <HistoricalClassesSkeleton />
        : null}
      {hasBlockingError ? <DataSectionError className="md:h-full" title="Không tải được danh sách lớp học" description={getApiErrorMessage(classesQuery.error, "Kết nối dữ liệu đang gián đoạn. Vui lòng thử lại.")} isRetrying={classesQuery.isFetching} onRetry={() => void classesQuery.refetch()} /> : null}
      {!isInitialLoading && !hasBlockingError && classes.length === 0 ? <DataSectionEmpty className="md:h-full" icon={GraduationCap} title={currentScope.emptyTitle} description={isAdmin ? currentScope.emptyDescription : "Danh sách sẽ xuất hiện khi quản trị viên cập nhật dữ liệu lớp."} actionLabel={isAdmin && scope === "operational" ? "Thêm lớp" : undefined} onAction={isAdmin && scope === "operational" ? openCreateForm : undefined} /> : null}
      {!isInitialLoading && !hasBlockingError && classes.length > 0 && filteredClasses.length === 0 ? <DataSectionEmpty className="md:h-full" icon={SearchX} title="Không tìm thấy lớp phù hợp" description="Thử từ khóa khác hoặc xóa các bộ lọc đang áp dụng." actionLabel={hasFilters ? "Xóa tìm kiếm và bộ lọc" : undefined} onAction={hasFilters ? clearFilters : undefined} /> : null}
      {!isInitialLoading && !hasBlockingError && filteredClasses.length > 0 ? <ClassesTable classes={filteredClasses} scope={scope} selectedDay={selectedDay} onRowClick={openClassWorkspace} /> : null}
    </div>
    {isCreateFormOpen && isAdmin ? <ClassFormDialog class_={null} teachers={teachersQuery.data ?? []} isTeachersLoading={teachersQuery.isPending && teachersQuery.data === undefined} isTeachersError={teachersQuery.isError} isSaving={createMutation.isPending} onClose={() => setIsCreateFormOpen(false)} onRetryTeachers={() => void teachersQuery.refetch()} onSubmit={(payload) => createMutation.mutate(payload as ClassCreate)} /> : null}
    {workspace ? (
      <ClassWorkspaceDialog
        class_={workspace.class}
        initialMode={workspace.mode}
        showModeRail={Boolean(isAdmin && isOperationalScope && workspace.class.can_edit)}
        isSaving={updateMutation.isPending || makeupMutation.isPending}
        isDeleting={deleteMutation.isPending}
        isTeachersError={teachersQuery.isError}
        isTeachersLoading={teachersQuery.isPending && teachersQuery.data === undefined}
        teachers={teachersQuery.data ?? []}
        onClose={() => setWorkspace(null)}
        onRetryTeachers={() => void teachersQuery.refetch()}
        onSubmit={(payload) => updateMutation.mutate({ id: workspace.class.id, values: payload })}
        onCancelClass={() => deleteMutation.mutate(workspace.class.id)}
        onMakeupAction={(action, exceptionId, payload) =>
          makeupMutation.mutate({ action, exceptionId, payload })
        }
        onPostponed={() => notify.success("Đã hoãn buổi học.")}
        isMakeupSaving={makeupMutation.isPending}
      />
    ) : null}
    {isAdmin ? <QuickActionFab label="Thêm lớp" onClick={openCreateForm} /> : null}
  </div>;
}
