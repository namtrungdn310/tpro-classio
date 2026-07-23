"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IdCardLanyard, LoaderCircle, Plus, SearchX } from "lucide-react";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { useToast } from "@/components/providers/toast-provider";
import { StaffFormDialog } from "@/components/staff/staff-form-dialog";
import { StaffSkeleton } from "@/components/staff/staff-skeleton";
import { StaffTable } from "@/components/staff/staff-table";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { LoadingLabel } from "@/components/ui/loading-label";
import { createStaffMember, getStaffMembers, updateStaffMember } from "@/lib/api/staff";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useAuth } from "@/lib/hooks/useAuth";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import {
  countActiveStaff,
  filterAndSortStaff,
  prepareStaffRecords,
  type PreparedStaffRecord,
  type StaffStatusFilter,
} from "@/lib/staff/presentation";
import { staffQueryKeys } from "@/lib/staff/query-keys";
import type { StaffCreate, StaffResponse, StaffType, StaffUpdate } from "@/lib/types";

const EMPTY_STAFF: StaffResponse[] = [];

export default function StaffPage() {
  const { user } = useAuth();
  const canManage = Boolean(user?.is_owner);
  const canViewPrivate = user?.role === "admin";
  const queryClient = useQueryClient();
  const notify = useToast();
  const [search, setSearch] = usePersistentState("tpro:staff:search", "");
  const deferredSearch = useDeferredValue(search);
  const [staffType, setStaffType] = useState<StaffType | "">("");
  const [status, setStatus] = useState<StaffStatusFilter>("ACTIVE");
  const [editingRecord, setEditingRecord] = useState<PreparedStaffRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<PreparedStaffRecord | null>(null);

  const staffQuery = useQuery({
    queryKey: staffQueryKeys.list,
    queryFn: () => getStaffMembers({ is_active: null }),
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  function refreshDependencies() {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.root }),
      queryClient.invalidateQueries({ queryKey: ["classes"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingRecord(null);
  }

  const createMutation = useMutation({
    mutationFn: createStaffMember,
    onSuccess: (createdStaff) => {
      updateStaffListCache(queryClient, (items) => [
        createdStaff,
        ...items.filter((item) => item.id !== createdStaff.id),
      ]);
      closeForm();
      notify.success("Đã thêm nhân sự.");
      refreshDependencies();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: StaffUpdate }) =>
      updateStaffMember(id, values),
    onSuccess: (updatedStaff) => {
      updateStaffListCache(queryClient, (items) =>
        items.map((item) => (item.id === updatedStaff.id ? updatedStaff : item)),
      );
      closeForm();
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
      setStatusTarget(null);
      notify.success(updatedStaff.is_active ? "Đã kích hoạt lại nhân sự." : "Đã ngừng hoạt động nhân sự.");
      refreshDependencies();
    },
    onError: (error) =>
      notify.error(getApiErrorMessage(error, "Không thể thay đổi trạng thái nhân sự.")),
  });

  const staff = staffQuery.data ?? EMPTY_STAFF;
  const preparedStaff = useMemo(
    () => prepareStaffRecords(staff, canViewPrivate),
    [canViewPrivate, staff],
  );
  const filteredStaff = useMemo(
    () =>
      filterAndSortStaff(preparedStaff, {
        search: deferredSearch,
        staffType,
        status,
      }),
    [deferredSearch, preparedStaff, staffType, status],
  );
  const activeStaffTotal = useMemo(() => countActiveStaff(staff), [staff]);
  const hasData = staffQuery.data !== undefined;
  const hasBlockingError = staffQuery.isError && !hasData;
  const hasCachedError = staffQuery.isError && hasData;
  const isInitialLoading = staffQuery.isPending && !hasData;
  const hasFilters = Boolean(search.trim() || staffType || status !== "ACTIVE");
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function clearFilters() {
    setSearch("");
    setStaffType("");
    setStatus("ACTIVE");
  }

  function openCreateForm() {
    setEditingRecord(null);
    setIsFormOpen(true);
  }

  function openEditForm(record: PreparedStaffRecord) {
    setEditingRecord(record);
    setIsFormOpen(true);
  }

  function requestStatusChange(record: PreparedStaffRecord) {
    if (record.staff.staff_type !== "TEACHER") return;

    if (record.staff.is_active && record.activeClasses.length > 0) {
      notify.error(
        `Hãy gỡ ${record.staff.full_name} khỏi ${formatClassList(record.activeClasses.map((class_) => class_.name))} trước khi ngừng hoạt động.`,
      );
      return;
    }
    setStatusTarget(record);
  }

  const filterControls = (
    <HeaderFilterControls
      searchPlaceholder={
        canViewPrivate
          ? "Tìm tên, Zalo, SĐT, lớp..."
          : "Tìm tên, vai trò, lớp..."
      }
      searchValue={search}
      onSearchChange={setSearch}
      onClear={clearFilters}
      filters={[
        {
          label: "Vai trò",
          value: staffType,
          onChange: (value) => setStaffType(value as StaffType | ""),
          options: [
            { label: "Giáo viên", value: "TEACHER" },
            { label: "Trợ giảng", value: "ASSISTANT" },
          ],
        },
        {
          label: "Trạng thái",
          value: status,
          defaultValue: "ACTIVE",
          allowDeselect: false,
          onChange: (value) => setStatus(value as StaffStatusFilter),
          options: [
            { label: "Đang hoạt động", value: "ACTIVE" },
            { label: "Đã ngừng", value: "INACTIVE" },
          ],
        },
      ]}
    />
  );
  const countStatus = (
    <StaffListStatus
      activeCount={activeStaffTotal}
      isRefreshing={staffQuery.isFetching && hasData}
    />
  );
  const addButton = canManage ? <AddStaffButton onClick={openCreateForm} /> : null;

  return (
    <div className="flex min-h-0 flex-col gap-3 md:h-full md:overflow-hidden">
      <HeaderControlsPortal>
        <div className="flex min-w-0 items-center gap-3">
          {filterControls}
          {countStatus}
          {addButton}
        </div>
      </HeaderControlsPortal>

      <div className="flex min-w-0 flex-wrap items-center gap-2 md:hidden">
        {filterControls}
        {countStatus}
        {addButton}
      </div>

      {hasCachedError ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <span>Chưa cập nhật được dữ liệu mới nhất; danh sách đã lưu vẫn đang được hiển thị.</span>
          <button
            type="button"
            disabled={staffQuery.isFetching}
            onClick={() => void staffQuery.refetch()}
            className="shrink-0 font-medium underline underline-offset-2 disabled:opacity-50"
          >
            {staffQuery.isFetching ? <LoadingLabel label="Đang thử lại" /> : "Thử lại"}
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
              staffQuery.error,
              "Kết nối dữ liệu đang gián đoạn. Vui lòng thử lại.",
            )}
            isRetrying={staffQuery.isFetching}
            onRetry={() => void staffQuery.refetch()}
          />
        ) : null}

        {!isInitialLoading && !hasBlockingError && staff.length === 0 ? (
          <DataSectionEmpty
            className="md:h-full"
            icon={IdCardLanyard}
            title="Chưa có nhân sự"
            description={
              canManage
                ? "Thêm nhân sự đầu tiên để phân công giáo viên và quản lý liên hệ."
                : "Danh sách sẽ xuất hiện khi người quản lý thêm nhân sự."
            }
            actionLabel={canManage ? "Thêm nhân sự" : undefined}
            onAction={canManage ? openCreateForm : undefined}
          />
        ) : null}

        {!isInitialLoading && !hasBlockingError && staff.length > 0 && filteredStaff.length === 0 ? (
          <DataSectionEmpty
            className="md:h-full"
            icon={SearchX}
            title="Không tìm thấy nhân sự phù hợp"
            description="Thử từ khóa khác hoặc xóa các bộ lọc đang áp dụng."
            actionLabel={hasFilters ? "Xóa tìm kiếm và bộ lọc" : undefined}
            onAction={hasFilters ? clearFilters : undefined}
          />
        ) : null}

        {!isInitialLoading && !hasBlockingError && filteredStaff.length > 0 ? (
          <StaffTable
            canManage={canManage}
            canViewPrivate={canViewPrivate}
            records={filteredStaff}
            onEdit={openEditForm}
            onToggleStatus={requestStatusChange}
          />
        ) : null}
      </div>

      {isFormOpen && canManage ? (
        <StaffFormDialog
          assignedClassNames={editingRecord?.assignedClasses.map((class_) => class_.name) ?? []}
          isSaving={isSaving}
          staff={editingRecord?.staff ?? null}
          onClose={closeForm}
          onSubmit={async (payload) => {
            if (editingRecord) {
              await updateMutation.mutateAsync({ id: editingRecord.staff.id, values: payload });
            } else {
              await createMutation.mutateAsync(payload as StaffCreate);
            }
          }}
        />
      ) : null}

      <ConfirmationDialog
        open={Boolean(statusTarget)}
        title={statusTarget?.staff.is_active ? "Ngừng hoạt động nhân sự" : "Kích hoạt lại nhân sự"}
        description={
          statusTarget ? (
            statusTarget.staff.is_active ? (
              <>
                Nhân sự <strong className="font-semibold text-gray-800">{statusTarget.staff.full_name}</strong> sẽ được ẩn khỏi danh sách đang hoạt động. Hồ sơ vẫn được giữ và có thể kích hoạt lại.
              </>
            ) : (
              <>
                Kích hoạt lại <strong className="font-semibold text-gray-800">{statusTarget.staff.full_name}</strong> để tiếp tục phân công vào lớp học.
              </>
            )
          ) : null
        }
        confirmLabel={statusTarget?.staff.is_active ? "Ngừng hoạt động" : "Kích hoạt lại"}
        tone={statusTarget?.staff.is_active ? "danger" : "default"}
        isPending={statusMutation.isPending}
        onCancel={() => setStatusTarget(null)}
        onConfirm={() => {
          if (statusTarget) {
            statusMutation.mutate({
              id: statusTarget.staff.id,
              isActive: !statusTarget.staff.is_active,
            });
          }
        }}
      />
    </div>
  );
}

function AddStaffButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Thêm nhân sự"
      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-gray-950 px-3 text-sm font-medium text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      Thêm nhân sự
    </button>
  );
}

function StaffListStatus({
  activeCount,
  isRefreshing,
}: {
  activeCount: number;
  isRefreshing: boolean;
}) {
  return (
    <span
      aria-live="polite"
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-gray-600"
    >
      {isRefreshing ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-gray-400" aria-hidden="true" />
      ) : (
        <span
          className={`h-2 w-2 rounded-full ${activeCount > 0 ? "bg-emerald-500" : "bg-gray-300"}`}
          aria-hidden="true"
        />
      )}
      {activeCount} nhân sự hoạt động
    </span>
  );
}

function updateStaffListCache(
  queryClient: QueryClient,
  updater: (items: StaffResponse[]) => StaffResponse[],
) {
  queryClient.setQueryData<StaffResponse[]>(staffQueryKeys.list, (current = []) => updater(current));
}

function formatClassList(classNames: string[]) {
  if (classNames.length <= 3) return `các lớp ${classNames.join(", ")}`;
  return `${classNames.slice(0, 3).join(", ")} và ${classNames.length - 3} lớp khác`;
}
