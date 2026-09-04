"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RiAddLine as Plus, RiGraduationCapLine as GraduationCap, RiSearchLine as SearchX } from "react-icons/ri";
import { ClassFormDialog } from "@/components/classes/class-form-dialog";
import { ClassStartDateDialog } from "@/components/classes/class-start-date-dialog";
import { ClassWorkspaceDialog } from "@/components/classes/class-workspace-dialog";
import {
  ClassesSkeleton,
  ClassesTable,
  HistoricalClassesSkeleton,
} from "@/components/classes/classes-table";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderLoadingStatus } from "@/components/layout/header-loading-status";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { useToast } from "@/components/providers/toast-provider";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { ExcelExportButton } from "@/components/ui/excel-export-button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { QuickActionFab } from "@/components/ui/quick-action-fab";
import {
  createClass,
  createClassContinuation,
  getClassScopeSummary,
  getClasses,
  updateClass,
  previewClassStartDate,
  updateClassStartDate,
  previewClassStop,
  stopClass,
} from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getActiveStaffOptions } from "@/lib/api/staff";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { exportClasses } from "@/lib/classes/export";
import { invalidateDomainQueries } from "@/lib/query/invalidation";
import { CLASS_DAYS, filterAndSortPreparedClasses, prepareClassRecords } from "@/lib/classes/presentation";
import { useAuth } from "@/lib/hooks/useAuth";
import { isManagementUser } from "@/lib/auth/permissions";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import { getCourseWeeks } from "@/lib/utils/format";
import type {
  ClassCategory,
  ClassContinuationCreate,
  ClassCreate,
  ClassResponse,
  ClassScope,
  ClassScopeSummary,
  ClassType,
  ClassUpdate,
} from "@/lib/types";
import { staffQueryKeys } from "@/lib/staff/query-keys";

const ACTIVE_STAFF_QUERY_KEY = staffQueryKeys.staffOptions;
const EMPTY_CLASSES: ClassResponse[] = [];

const SCOPE_TABS: { scope: ClassScope; summaryKey: keyof ClassScopeSummary; label: string; emptyTitle: string; emptyDescription: string }[] = [
  { scope: "operational", summaryKey: "operational", label: "Đang hoạt động", emptyTitle: "Chưa có lớp đang hoạt động", emptyDescription: "Tạo lớp mới để phân công giáo viên, lịch học và học viên." },
  { scope: "scheduled", summaryKey: "scheduled", label: "Sắp mở", emptyTitle: "Chưa có lớp sắp mở", emptyDescription: "Các lớp có ngày bắt đầu trong tương lai sẽ xuất hiện ở đây." },
  { scope: "stopped", summaryKey: "stopped", label: "Đã ngừng", emptyTitle: "Chưa có lớp đã ngừng", emptyDescription: "Các lớp đã ngừng vẫn giữ nguyên hồ sơ học viên và lịch sử giảng dạy." },
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
  const createSubmissionLockedRef = useRef(false);
  const [isExporting, setIsExporting] = useState(false);
  const [workspace, setWorkspace] = useState<ClassWorkspaceState | null>(null);
  const [pendingStartDateChange, setPendingStartDateChange] = useState<{
    class_: ClassResponse;
    newStartDate: string;
    classPatch: ClassUpdate;
  } | null>(null);
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
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });
  const classSummaryQuery = useQuery({
    queryKey: classQueryKeys.summary(),
    queryFn: getClassScopeSummary,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
  const staffOptionsQuery = useQuery({
    queryKey: ACTIVE_STAFF_QUERY_KEY,
    queryFn: getActiveStaffOptions,
    enabled: Boolean(isAdmin),
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });

  /** Targeted invalidation matrix — không bao giờ invalidate toàn bộ fees
   * khi mutation chỉ ảnh hưởng lịch/lifecycle. */
  function invalidateClassScopeData() {
    void invalidateDomainQueries(queryClient, { classes: true, dashboard: true });
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
    onSettled: () => {
      createSubmissionLockedRef.current = false;
    },
  });
  const updateMutation = useMutation({
    mutationFn: async ({ id, values, current }: { id: string; values: ClassUpdate; current: ClassResponse }) => {
      const nextValues = { ...values };
      delete nextValues.end_date;
      delete nextValues.end_date_change_reason;
      const reason = nextValues.start_date_change_reason;
      delete nextValues.start_date_change_reason;
      if (nextValues.start_date && nextValues.start_date !== current.start_date) {
        const preview = await previewClassStartDate(id, {
          start_date: nextValues.start_date,
          expected_version: current.version,
          class_patch: nextValues,
        });
        if (!preview.can_apply) {
          throw new Error(preview.blocking_reason || "Không thể dời ngày bắt đầu của lớp học.");
        }
        return updateClassStartDate(id, {
          start_date: nextValues.start_date,
          reason: reason ?? "Điều chỉnh ngày bắt đầu",
          expected_version: current.version,
          expected_fingerprint: preview.preview_fingerprint,
          class_patch: nextValues,
        });
      }
      return updateClass(id, nextValues);
    },
    onSuccess: () => {
      setWorkspace(null);
      notify.success("Đã cập nhật lớp học.");
      invalidateClassScopeData();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể cập nhật lớp học.")),
  });
  const deleteMutation = useMutation({
    mutationFn: async ({ class_: current, reason }: { class_: ClassResponse; reason: string }) => {
      const preview = await previewClassStop(current.id, current.version);
      return stopClass(current.id, {
        reason,
        request_id: crypto.randomUUID(),
        expected_version: current.version,
        expected_fingerprint: preview.preview_fingerprint,
      });
    },
    onSuccess: () => {
      setWorkspace(null);
      notify.success("Đã ngừng hoạt động lớp học. Lịch sử vẫn được giữ lại.");
      invalidateClassScopeData();
      setScope("stopped");
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể ngừng hoạt động lớp học.")),
  });
  const continuationMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ClassContinuationCreate }) =>
      createClassContinuation(id, values),
    onSuccess: (result) => {
      notify.success(`Đã tạo lớp kế tiếp với ${result.enrolled_student_count} học viên.`);
      void invalidateDomainQueries(queryClient, {
        classes: true,
        students: true,
        fees: true,
        dashboard: true,
      });
      setScope(result.created_class.effective_status === "SCHEDULED" ? "scheduled" : "operational");
      setWorkspace({ class: result.created_class, mode: "edit" });
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể tạo lớp kế tiếp.")),
  });
  function openCreateForm() {
    createSubmissionLockedRef.current = false;
    setIsCreateFormOpen(true);
  }
  function createClassOnce(payload: ClassCreate) {
    if (createSubmissionLockedRef.current) return;
    createSubmissionLockedRef.current = true;
    createMutation.mutate(payload);
  }
  function openClassWorkspace(class_: ClassResponse) {
    const canEdit = isAdmin && isOperationalScope && class_.can_edit === true;
    setWorkspace({ class: class_, mode: canEdit ? "edit" : "history" });
  }
  function openClassHistory(class_: ClassResponse) {
    setWorkspace({ class: class_, mode: "history" });
  }
  function handlePackageDurationChanged(updated: ClassResponse) {
    setWorkspace((current) =>
      current ? { ...current, class: updated } : current,
    );
    queryClient.setQueriesData<ClassResponse[]>(
      { queryKey: classQueryKeys.all },
      (current) =>
        Array.isArray(current)
          ? current.map((item) => (item.id === updated.id ? updated : item))
          : current,
    );
    void invalidateDomainQueries(queryClient, {
      classes: true,
      students: true,
      fees: true,
      reports: true,
      dashboard: true,
    });
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
  const isSummaryInitialLoading = classSummaryQuery.isPending && classSummaryQuery.data === undefined;
  const isInitialLoading = !hasBlockingError && ((classesQuery.isPending && !hasData) || isSummaryInitialLoading);
  const hasFilters = Boolean(search.trim() || type || category || selectedDay || courseDuration);
  const currentScope = SCOPE_TABS.find((tab) => tab.scope === scope) ?? SCOPE_TABS[0];

  async function handleExport() {
    if (filteredClasses.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      await exportClasses(filteredClasses, currentScope.label);
      notify.success(`Đã xuất danh sách ${filteredClasses.length} lớp ra file Excel.`);
    } catch {
      notify.error("Không thể xuất danh sách lớp. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  }

  const filters = <HeaderFilterControls searchPlaceholder="Tìm lớp, giáo viên, lịch học..." searchValue={search} onSearchChange={setSearch} onClear={clearFilters} filters={[
    { label: "Loại lớp", value: category, onChange: (value) => setCategory(value as ClassCategory | ""), options: [{ label: "Phổ thông", value: "GENERAL" }, { label: "Thi Chuyên", value: "SPECIALIZED" }, { label: "IELTS", value: "IELTS" }, { label: "Custom", value: "CUSTOM" }] },
    { label: "Hình thức đóng học phí", value: type, onChange: (value) => { const next = value as ClassType | ""; setType(next); if (next === "MONTHLY") setCourseDuration(""); }, options: [{ label: "Theo tháng", value: "MONTHLY" }, { label: "Theo gói", value: "COURSE" }] },
    { label: "Thời lượng gói", value: courseDuration, hidden: type !== "COURSE" && !courseDuration, onChange: (value) => { setCourseDuration(value); if (value) setType("COURSE"); }, options: courseDurationOptions },
    { label: "Ngày học", value: selectedDay, onChange: setSelectedDay, options: CLASS_DAYS.map((day) => ({ label: day, value: day })) },
  ]} />;
  const addButton = isAdmin ? <button type="button" onClick={openCreateForm} disabled={isSummaryInitialLoading} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-wait disabled:opacity-60"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Thêm lớp</button> : null;
  const exportButton = isAdmin ? <ExcelExportButton disabled={filteredClasses.length === 0 || isInitialLoading} isExporting={isExporting} onClick={() => void handleExport()} /> : null;

  return <div className="font-body-ui flex min-h-0 flex-col gap-3 md:h-full md:overflow-hidden">
    <HeaderControlsPortal><div className="flex min-w-0 items-center gap-3">{filters}{exportButton}{addButton}<HeaderLoadingStatus isLoading={isInitialLoading || classesQuery.isFetching || classSummaryQuery.isFetching} /></div></HeaderControlsPortal>
    <div className="flex min-w-0 flex-wrap items-center gap-2 md:hidden">{filters}{exportButton}{addButton}</div>
    <nav aria-label="Phạm vi danh sách lớp" className="flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 scrollbar-hidden">
      {SCOPE_TABS.map((tab) => <button key={tab.scope} type="button" aria-pressed={scope === tab.scope} onPointerDown={(event) => event.preventDefault()} onClick={() => selectScope(tab.scope)} className={`font-ui inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${scope === tab.scope ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20" : "font-medium text-gray-600 hover:bg-primary-soft/60 hover:text-primary"}`}><span className={`h-1.5 w-1.5 rounded-full ${tab.scope === "operational" ? "bg-emerald-500" : tab.scope === "scheduled" ? "bg-primary" : tab.scope === "completed" ? "bg-gray-400" : "bg-destructive"}`} aria-hidden="true" />{tab.label}{isInitialLoading ? <span aria-hidden="true" className="h-3.5 w-5 shrink-0 animate-pulse rounded bg-gray-200" /> : <span className={`min-w-4 text-right text-[12px] font-semibold tabular-nums ${scope === tab.scope ? "text-primary" : "text-gray-500"}`}>{classSummaryQuery.data?.[tab.summaryKey] ?? "–"}</span>}</button>)}
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
      {!isInitialLoading && !hasBlockingError && filteredClasses.length > 0 ? <ClassesTable classes={filteredClasses} scope={scope} selectedDay={selectedDay} onRowClick={openClassWorkspace} onPostponedClick={openClassHistory} /> : null}
    </div>
    {isCreateFormOpen && isAdmin ? <ClassFormDialog class_={null} teachers={staffOptionsQuery.data ?? []} isTeachersLoading={staffOptionsQuery.isPending && staffOptionsQuery.data === undefined} isTeachersError={staffOptionsQuery.isError} isSaving={createMutation.isPending} onClose={() => setIsCreateFormOpen(false)} onRetryTeachers={() => void staffOptionsQuery.refetch()} onSubmit={(payload) => createClassOnce(payload as ClassCreate)} /> : null}
    {workspace ? (
      <ClassWorkspaceDialog
        class_={workspace.class}
        initialMode={workspace.mode}
        showModeRail={Boolean(isAdmin && workspace.class.effective_status !== "CANCELLED")}
        canEdit={Boolean(isAdmin && isOperationalScope && workspace.class.can_edit)}
        canContinue={Boolean(isAdmin && ["ACTIVE", "STOPPED"].includes(workspace.class.effective_status) && workspace.class.identity_scheme !== "LEGACY")}
        isSaving={updateMutation.isPending}
        isContinuing={continuationMutation.isPending}
        isDeleting={deleteMutation.isPending}
        isTeachersError={staffOptionsQuery.isError}
        isTeachersLoading={staffOptionsQuery.isPending && staffOptionsQuery.data === undefined}
        teachers={staffOptionsQuery.data ?? []}
        onClose={() => setWorkspace(null)}
        onRetryTeachers={() => void staffOptionsQuery.refetch()}
        onSubmit={(payload) => {
          if (payload.start_date && payload.start_date !== workspace.class.start_date) {
            const patch = { ...payload };
            delete patch.end_date;
            delete patch.end_date_change_reason;
            setPendingStartDateChange({
              class_: workspace.class,
              newStartDate: payload.start_date,
              classPatch: patch,
            });
          } else {
            updateMutation.mutate({ id: workspace.class.id, values: payload, current: workspace.class });
          }
        }}
        onCreateContinuation={(payload) => continuationMutation.mutate({ id: workspace.class.id, values: payload })}
        onCancelClass={(reason) => deleteMutation.mutate({ class_: workspace.class, reason })}
        onPostponed={() => notify.success("Đã hoãn buổi học.")}
        onPackageDurationChanged={handlePackageDurationChanged}
      />
    ) : null}
    {pendingStartDateChange ? (
      <ClassStartDateDialog
        class_={pendingStartDateChange.class_}
        newStartDate={pendingStartDateChange.newStartDate}
        classPatch={pendingStartDateChange.classPatch}
        onApplied={() => {
          setPendingStartDateChange(null);
          setWorkspace(null);
          invalidateClassScopeData();
        }}
        onClose={() => setPendingStartDateChange(null)}
      />
    ) : null}
    {isAdmin ? <QuickActionFab label="Thêm lớp" onClick={openCreateForm} /> : null}
  </div>;
}
