"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RiIdCardLine as IdCardLanyard,
  RiAddLine as Plus,
  RiSearchLine as SearchX,
} from "react-icons/ri";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderLoadingStatus } from "@/components/layout/header-loading-status";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { useToast } from "@/components/providers/toast-provider";
import { StaffFormDialog } from "@/components/staff/staff-form-dialog";
import {
  StaffWorkspaceDialog,
  type StaffWorkspaceMode,
} from "@/components/staff/staff-workspace-dialog";
import { StaffSkeleton } from "@/components/staff/staff-skeleton";
import { StaffTable } from "@/components/staff/staff-table";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { ExcelExportButton } from "@/components/ui/excel-export-button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { QuickActionFab } from "@/components/ui/quick-action-fab";
import { createStaffMember, getStaffMembers, updateStaffMember } from "@/lib/api/staff";
import { getClasses } from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import type { ContactSuggestionSource } from "@/lib/forms/use-contact-pair-suggestion";
import { useAuth } from "@/lib/hooks/useAuth";
import { isManagementUser } from "@/lib/auth/permissions";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import {
  filterAndSortStaff,
  prepareStaffRecords,
  type PreparedStaffRecord,
} from "@/lib/staff/presentation";
import { staffQueryKeys } from "@/lib/staff/query-keys";
import { exportStaff } from "@/lib/staff/export";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { invalidateDomainQueries } from "@/lib/query/invalidation";
import type { ClassResponse, StaffCreate, StaffResponse, StaffUpdate } from "@/lib/types";

const EMPTY_STAFF: StaffResponse[] = [];

export type StaffScope = "assigned" | "unassigned" | "inactive";

const STAFF_SCOPE_TABS = [
  {
    scope: "assigned" as const,
    label: "Đang phân công",
    dotClass: "bg-emerald-500",
    emptyTitle: "Chưa có nhân sự đang phân công",
    emptyDescription: "Các nhân sự được phân công vào lớp đang hoạt động sẽ xuất hiện ở đây.",
  },
  {
    scope: "unassigned" as const,
    label: "Chưa phân công",
    dotClass: "bg-amber-500",
    emptyTitle: "Chưa có nhân sự chờ phân công",
    emptyDescription: "Nhân sự mới hoặc nhân sự chưa có lớp phụ trách sẽ xuất hiện ở đây.",
  },
  {
    scope: "inactive" as const,
    label: "Ngừng hoạt động",
    dotClass: "bg-gray-400",
    emptyTitle: "Chưa có nhân sự ngừng hoạt động",
    emptyDescription: "Các nhân sự đã ngừng hoạt động sẽ xuất hiện ở đây.",
  },
] as const;

export default function StaffPage() {
  const { user } = useAuth();
  const canManage = isManagementUser(user);
  const canViewPrivate = canManage;
  const queryClient = useQueryClient();
  const notify = useToast();
  const [storedScope, setScope] = usePersistentState<StaffScope>("tpro:staff:scope", "assigned");
  const [search, setSearch] = usePersistentState("tpro:staff:search", "");
  const deferredSearch = useDeferredValue(search);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [workspace, setWorkspace] = useState<{
    record: PreparedStaffRecord;
    initialMode: StaffWorkspaceMode;
  } | null>(null);

  const scope = STAFF_SCOPE_TABS.some((tab) => tab.scope === storedScope) ? storedScope : "assigned";

  useEffect(() => {
    if (scope !== storedScope) setScope(scope);
  }, [scope, setScope, storedScope]);

  const staffQuery = useQuery({
    queryKey: staffQueryKeys.list,
    queryFn: () => getStaffMembers({ is_active: null }),
    enabled: Boolean(user),
    staleTime: 10 * 60_000,
  });

  const classesQuery = useQuery({
    queryKey: classQueryKeys.list("operational"),
    queryFn: () => getClasses({ scope: "operational" }),
    enabled: Boolean(user),
    staleTime: 10 * 60_000,
  });

  const classesById = useMemo(() => {
    const map = new Map<string, ClassResponse>();
    for (const item of classesQuery.data ?? []) {
      map.set(item.id, item);
    }
    return map;
  }, [classesQuery.data]);

  function refreshDependencies() {
    void invalidateDomainQueries(queryClient, {
      staff: true,
      classes: true,
      dashboard: true,
    });
  }

  function closeCreateForm() {
    setIsCreateOpen(false);
  }

  const createMutation = useMutation({
    mutationFn: createStaffMember,
    onSuccess: (createdStaff) => {
      updateStaffListCache(queryClient, (items) => [
        createdStaff,
        ...items.filter((item) => item.id !== createdStaff.id),
      ]);
      closeCreateForm();
      notify.success("Đã thêm nhân sự.");
      refreshDependencies();
      setScope("unassigned");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: StaffUpdate }) =>
      updateStaffMember(id, values),
    onSuccess: (updatedStaff) => {
      updateStaffListCache(queryClient, (items) =>
        items.map((item) => (item.id === updatedStaff.id ? updatedStaff : item)),
      );
      setWorkspace((current) =>
        current
          ? {
              ...current,
              record: {
                ...current.record,
                staff: updatedStaff,
              },
            }
          : null,
      );
      notify.success("Đã cập nhật nhân sự.");
      refreshDependencies();
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateStaffMember(id, { is_active: isActive }),
    onSuccess: (updatedStaff) => {
      updateStaffListCache(queryClient, (items) =>
        items.map((item) => (item.id === updatedStaff.id ? updatedStaff : item)),
      );
      setWorkspace((current) =>
        current
          ? {
              ...current,
              record: {
                ...current.record,
                staff: updatedStaff,
              },
            }
          : null,
      );
      notify.success(updatedStaff.is_active ? "Đã kích hoạt lại nhân sự." : "Đã ngừng hoạt động nhân sự.");
      refreshDependencies();
    },
    onError: (error) =>
      notify.error(getApiErrorMessage(error, "Không thể thay đổi trạng thái nhân sự.")),
  });

  const staff = staffQuery.data ?? EMPTY_STAFF;
  const contactSuggestionSources = useMemo<ContactSuggestionSource[]>(
    () =>
      canManage
        ? staff
            .filter(
              (staffMember) =>
                Boolean(staffMember.zalo_name?.trim()) &&
                Boolean(staffMember.phone?.trim()),
            )
            .map((staffMember) => ({
              owner: "staff" as const,
              phone: staffMember.phone,
              zaloName: staffMember.zalo_name,
            }))
        : [],
    [canManage, staff],
  );
  const preparedStaff = useMemo(
    () => prepareStaffRecords(staff, canViewPrivate),
    [canViewPrivate, staff],
  );

  const scopeCounts = useMemo(() => {
    let assigned = 0;
    let unassigned = 0;
    let inactive = 0;
    for (const item of staff) {
      if (!item.is_active) {
        inactive += 1;
      } else if (item.assigned_classes.some((c) => c.is_active)) {
        assigned += 1;
      } else {
        unassigned += 1;
      }
    }
    return { assigned, unassigned, inactive };
  }, [staff]);

  const filteredStaff = useMemo(() => {
    return filterAndSortStaff(preparedStaff, {
      search: deferredSearch,
      scope,
    });
  }, [deferredSearch, preparedStaff, scope]);

  const hasStaffData = staffQuery.data !== undefined;
  const hasClassesData = classesQuery.data !== undefined;
  const hasData = hasStaffData && hasClassesData;
  // The table joins staff with their current class assignments. Wait for both
  // sources on the first load so one column never appears later than the rest.
  const isInitialLoading =
    (staffQuery.isPending && !hasStaffData) ||
    (classesQuery.isPending && !hasClassesData);
  const hasBlockingError =
    (staffQuery.isError && !hasStaffData) ||
    (classesQuery.isError && !hasClassesData);
  const hasCachedError =
    (staffQuery.isError && hasStaffData) ||
    (classesQuery.isError && hasClassesData);
  const hasFilters = Boolean(search.trim());
  const currentScope = STAFF_SCOPE_TABS.find((tab) => tab.scope === scope) ?? STAFF_SCOPE_TABS[0];

  function retryStaffData() {
    void Promise.all([staffQuery.refetch(), classesQuery.refetch()]);
  }

  async function handleExport() {
    if (filteredStaff.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      await exportStaff(filteredStaff, currentScope.label);
      notify.success(`Đã xuất danh sách ${filteredStaff.length} nhân sự ra file Excel.`);
    } catch {
      notify.error("Không thể xuất danh sách nhân sự. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  }

  function clearFilters() {
    setSearch("");
  }

  function selectScope(nextScope: StaffScope) {
    setScope(nextScope);
    clearFilters();
  }

  function openCreateForm() {
    setIsCreateOpen(true);
  }

  const filterControls = (
    <HeaderFilterControls
      searchPlaceholder={
        canViewPrivate
          ? "Tìm tên, email, SĐT, lớp..."
          : "Tìm tên, vai trò, lớp..."
      }
      searchValue={search}
      onSearchChange={setSearch}
      onClear={clearFilters}
      filters={[]}
    />
  );

  const addButton = canManage ? <AddStaffButton onClick={openCreateForm} /> : null;
  const exportButton = canManage ? (
    <ExcelExportButton
      disabled={filteredStaff.length === 0 || isInitialLoading}
      isExporting={isExporting}
      onClick={() => void handleExport()}
    />
  ) : null;

  return (
    <div className="flex min-h-0 flex-col gap-3 md:h-full md:overflow-hidden">
      <HeaderControlsPortal>
        <div className="flex min-w-0 items-center gap-3">
          {filterControls}
          {exportButton}
          {addButton}
          <HeaderLoadingStatus
            isLoading={isInitialLoading || staffQuery.isFetching || classesQuery.isFetching}
          />
        </div>
      </HeaderControlsPortal>

      <div className="flex min-w-0 flex-wrap items-center gap-2 md:hidden">
        {filterControls}
        {exportButton}
        {addButton}
      </div>

      <nav
        aria-label="Phạm vi danh sách nhân sự"
        className="scrollbar-hidden flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5"
      >
        {STAFF_SCOPE_TABS.map((tab) => {
          const isActiveTab = scope === tab.scope;
          const count = scopeCounts[tab.scope];

          return (
            <button
              key={tab.scope}
              type="button"
              aria-pressed={isActiveTab}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectScope(tab.scope)}
              className={`font-ui inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                isActiveTab
                  ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20"
                  : "font-medium text-gray-600 hover:bg-primary-soft/60 hover:text-primary"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${tab.dotClass}`}
                aria-hidden="true"
              />
              {tab.label}
              <span
                className={`min-w-4 text-right text-[12px] font-semibold tabular-nums ${
                  isActiveTab ? "text-primary" : "text-gray-500"
                }`}
              >
                {hasData ? count : "–"}
              </span>
            </button>
          );
        })}
      </nav>

      {hasCachedError ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <span>Chưa cập nhật được dữ liệu mới nhất; danh sách đã lưu vẫn đang được hiển thị.</span>
          <button
            type="button"
            disabled={staffQuery.isFetching || classesQuery.isFetching}
            onClick={retryStaffData}
            className="shrink-0 font-medium underline underline-offset-2 disabled:opacity-50"
          >
            {staffQuery.isFetching || classesQuery.isFetching ? <LoadingLabel label="Đang thử lại" /> : "Thử lại"}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 md:flex-1 md:overflow-hidden">
        {isInitialLoading ? (
          <StaffSkeleton canManage={canManage} canViewPrivate={canViewPrivate} />
        ) : null}

        {hasBlockingError ? (
          <DataSectionError
            className="md:h-full"
            title="Không tải được danh sách nhân sự"
            description={getApiErrorMessage(
              staffQuery.error ?? classesQuery.error,
              "Kết nối dữ liệu đang gián đoạn. Vui lòng thử lại.",
            )}
            isRetrying={staffQuery.isFetching || classesQuery.isFetching}
            onRetry={retryStaffData}
          />
        ) : null}

        {!isInitialLoading && !hasBlockingError && filteredStaff.length === 0 && !hasFilters ? (
          <DataSectionEmpty
            className="md:h-full"
            icon={IdCardLanyard}
            title={currentScope.emptyTitle}
            description={
              canManage
                ? currentScope.emptyDescription
                : "Danh sách sẽ xuất hiện khi người quản lý thêm nhân sự."
            }
            actionLabel={canManage && scope !== "inactive" ? "Thêm nhân sự" : undefined}
            onAction={canManage && scope !== "inactive" ? openCreateForm : undefined}
          />
        ) : null}

        {!isInitialLoading && !hasBlockingError && filteredStaff.length === 0 && hasFilters ? (
          <DataSectionEmpty
            className="md:h-full"
            icon={SearchX}
            title="Không tìm thấy nhân sự phù hợp"
            description="Thử từ khóa khác hoặc xóa các bộ lọc đang áp dụng."
            actionLabel="Xóa tìm kiếm và bộ lọc"
            onAction={clearFilters}
          />
        ) : null}

        {!isInitialLoading && !hasBlockingError && filteredStaff.length > 0 ? (
          <StaffTable
            canManage={canManage}
            canViewPrivate={canViewPrivate}
            classesById={classesById}
            records={filteredStaff}
            onRowClick={(record) => {
              if (canManage) {
                setWorkspace({ record, initialMode: "edit" });
              }
            }}
          />
        ) : null}
      </div>

      {isCreateOpen && canManage ? (
        <StaffFormDialog
          assignedClassNames={[]}
          contactSuggestionSources={contactSuggestionSources}
          isSaving={createMutation.isPending}
          staff={null}
          onClose={closeCreateForm}
          onSubmit={async (payload) => {
            await createMutation.mutateAsync(payload as StaffCreate);
          }}
        />
      ) : null}

      {workspace && canManage ? (
        <StaffWorkspaceDialog
          record={workspace.record}
          initialMode={workspace.initialMode}
          contactSuggestionSources={contactSuggestionSources}
          isSaving={updateMutation.isPending}
          isStatusPending={statusMutation.isPending}
          onClose={() => setWorkspace(null)}
          onSubmit={async (payload) => {
            await updateMutation.mutateAsync({
              id: workspace.record.staff.id,
              values: payload,
            });
          }}
          onStatusChange={(rec) => {
            statusMutation.mutate({
              id: rec.staff.id,
              isActive: !rec.staff.is_active,
            });
          }}
        />
      ) : null}

      {canManage && scope !== "inactive" ? (
        <QuickActionFab
          label="Thêm nhân sự"
          onClick={openCreateForm}
        />
      ) : null}
    </div>
  );
}

function AddStaffButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Thêm nhân sự"
      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      Thêm nhân sự
    </button>
  );
}

function updateStaffListCache(
  queryClient: QueryClient,
  updater: (items: StaffResponse[]) => StaffResponse[],
) {
  queryClient.setQueryData<StaffResponse[]>(staffQueryKeys.list, (current = []) => updater(current));
}
