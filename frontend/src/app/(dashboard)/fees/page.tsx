"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { Download, MessageSquareText } from "lucide-react";
import { FeeMessageTemplateDialog } from "@/components/fees/fee-message-template-dialog";
import { FeeRefundDialog } from "@/components/fees/fee-refund-dialog";
import { FeeReportPanel } from "@/components/fees/fee-report-panel";
import { FeesPageSkeleton } from "@/components/fees/fees-skeleton";
import { FeesTable } from "@/components/fees/fees-table";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { InlineFieldDivider } from "@/components/ui/inline-field-divider";
import { LoadingLabel } from "@/components/ui/loading-label";
import { getClasses } from "@/lib/api/classes";
import {
  getFeeRecords,
  getFeeTransactionBatch,
  getFeePeriods,
  getFeeMessageTemplates,
  notifyFeeRecords,
  payFeeRecords,
  refundFeeRecords,
  reverseFeeRefund,
  syncFeeRecords,
  unnotifyFeeRecords,
  unpayFeeRecords,
  updateFeeMessageTemplates,
} from "@/lib/api/fees";
import { useAuth } from "@/lib/hooks/useAuth";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import {
  renderGroupFeeMessage,
  type StudentFeeGroup,
} from "@/lib/fees/view-model";
import { mergeFeeBatchActionResult } from "@/lib/fees/cache";
import { copyFeeMessage, copyText } from "@/lib/fees/clipboard";
import { buildRefundReceiptMessage } from "@/lib/fees/refund";
import {
  deriveFeeViewModel,
  indexFeeRecords,
} from "@/lib/fees/dashboard-view-model";
import {
  canRestoreNotifiedFeeState,
  getDefaultUnpayTargetState,
  getFeeConfirmationContent,
  type FeeConfirmationTarget,
} from "@/lib/fees/confirmation";
import { exportFeeGroups } from "@/lib/fees/export";
import {
  changeFeePeriodMonth,
  changeFeePeriodYear,
  getAscendingFeeYears,
  getCurrentFeePeriod,
  getFeeMonthLimit,
} from "@/lib/fees/period";
import type {
  FeeMutationAction,
  FeeTab,
  UnpaidStage,
} from "@/lib/fees/types";
import type {
  FeeBatchActionResponse,
  FeePaymentMethod,
  FeeRecordListResponse,
  FeeRefundReceipt,
  FeeRefundRequest,
  FeeRefundReversalRequest,
  FeeTransactionListResponse,
  FeeUnpayTargetState,
} from "@/lib/types";
import { createPreparedSearchMatcher } from "@/lib/utils/search";
import { useToast } from "@/components/providers/toast-provider";
import { getApiErrorMessage } from "@/lib/api/errors";

const PAYMENT_METHOD_OPTIONS = [
  { value: "bank_transfer", label: "Chuyển khoản" },
  { value: "cash", label: "Tiền mặt" },
] satisfies ReadonlyArray<{ value: FeePaymentMethod; label: string }>;

const UNPAY_TARGET_OPTIONS = [
  { value: "NOTIFIED_UNPAID", label: "Đã báo" },
  { value: "UNNOTIFIED", label: "Chưa báo" },
] satisfies ReadonlyArray<{ value: FeeUnpayTargetState; label: string }>;

export default function FeesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = usePersistentState("tpro:fees:search", "");
  const deferredSearch = useDeferredValue(search);
  const [period, setPeriod] = usePersistentState("tpro:fees:period", getCurrentFeePeriod());
  const [activeTab, setActiveTab] = usePersistentState<FeeTab>("tpro:fees:activeTab", "unpaid");
  const [unpaidStage, setUnpaidStage] = usePersistentState<UnpaidStage>("tpro:fees:unpaidStage", "unnotified");
  const [classId, setClassId] = useState("");
  const [confirmationTarget, setConfirmationTarget] =
    useState<FeeConfirmationTarget | null>(null);
  const [paymentMethod, setPaymentMethod] =
    useState<FeePaymentMethod>("bank_transfer");
  const [unpayTargetState, setUnpayTargetState] =
    useState<FeeUnpayTargetState>("NOTIFIED_UNPAID");
  const [refundTarget, setRefundTarget] = useState<StudentFeeGroup | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [refundReceipt, setRefundReceipt] = useState<FeeRefundReceipt | null>(null);
  const [isMessageTemplateDialogOpen, setIsMessageTemplateDialogOpen] =
    useState(false);
  const deferredClassId = useDeferredValue(classId);
  const notify = useToast();
  const matchesFeeSearch = useMemo(
    () => createPreparedSearchMatcher(deferredSearch),
    [deferredSearch],
  );

  const classesQuery = useQuery({
    queryKey: ["classes", { is_active: true }],
    queryFn: () => getClasses({ is_active: true }),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
    initialData: () => queryClient.getQueryData(["classes", { is_active: true }]),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(["classes", { is_active: true }])?.dataUpdatedAt,
  });

  const feePeriodsQuery = useQuery({
    queryKey: ["fee-periods"],
    queryFn: getFeePeriods,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });

  const messageTemplatesQuery = useQuery({
    queryKey: ["fee-message-templates"],
    queryFn: getFeeMessageTemplates,
    enabled: Boolean(user) && isAdmin,
    staleTime: 5 * 60 * 1000,
    initialData: () => queryClient.getQueryData(["fee-message-templates"]),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(["fee-message-templates"])?.dataUpdatedAt,
  });

  const [periodYear, periodMonth] = period.split("-");
  const isInvalidPeriod = !/^\d{4}-(0[1-9]|1[0-2])$/.test(period);

  const feesQuery = useQuery({
    queryKey: ["fees", { period }],
    queryFn: () => getFeeRecords({ period }),
    enabled: Boolean(user) && !isInvalidPeriod,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    initialData: () => queryClient.getQueryData(["fees", { period }]),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(["fees", { period }])?.dataUpdatedAt,
  });

  const feeRecordIds = useMemo(
    () =>
      Array.from(
        new Set((feesQuery.data?.records ?? []).map((record) => record.id)),
      ).sort(),
    [feesQuery.data?.records],
  );

  const feeTransactionsQuery = useQuery({
    queryKey: ["fee-transactions", "period", { period, feeRecordIds }],
    queryFn: () => loadFeeTransactionHistories(feeRecordIds),
    enabled:
      Boolean(user) &&
      !isInvalidPeriod &&
      feesQuery.data !== undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
  });

  const syncMutation = useMutation({
    mutationFn: syncFeeRecords,
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: (data) => {
      queryClient.setQueryData(["fees", { period: data.period }], data);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      notify.error(
        getApiErrorMessage(
          error,
          "Không thể đồng bộ dữ liệu học phí. Dữ liệu gần nhất vẫn được giữ nguyên.",
        ),
      );
    },
  });

  const notifyGroupMutation = useMutation({
    mutationFn: async (group: StudentFeeGroup) => {
      const records = group.records.filter((record) => record.notification_state === "UNNOTIFIED");
      const templates = messageTemplatesQuery.data;
      if (!templates) {
        throw new Error("Chưa tải được nội dung thông báo Zalo.");
      }
      const message = renderGroupFeeMessage(
        group,
        false,
        templates.payment_reminder_template,
      );
      return await notifyFeeRecords(records.map((record) => record.id), message);
    },
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: (result) => {
      updateFeeRecordsInCache(queryClient, result);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      notify.success("Đã đánh dấu đã báo phụ huynh.");
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      notify.error(
        error instanceof Error && error.message.includes("nội dung")
          ? error.message
          : getApiErrorMessage(error, "Không thể cập nhật trạng thái thông báo."),
      );
    },
  });

  const updateMessageTemplatesMutation = useMutation({
    mutationFn: updateFeeMessageTemplates,
    onSuccess: (templates) => {
      queryClient.setQueryData(["fee-message-templates"], templates);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      setIsMessageTemplateDialogOpen(false);
      notify.success("Đã lưu nội dung tin nhắn Zalo.");
    },
    onError: (error) => {
      void messageTemplatesQuery.refetch();
      notify.error(
        getApiErrorMessage(
          error,
          "Không thể lưu nội dung tin nhắn Zalo. Vui lòng thử lại.",
        ),
      );
    },
  });

  const payGroupMutation = useMutation({
    mutationFn: async ({
      group,
      method,
    }: {
      group: StudentFeeGroup;
      method: FeePaymentMethod;
    }) => {
      return await payFeeRecords(
        group.records.map((record) => record.id),
        method,
      );
    },
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: async (result) => {
      updateFeeRecordsInCache(queryClient, result);
      notify.success("Đã ghi nhận học phí.");
      void invalidateFeeDependencies(queryClient);
    },
    onError: (error) => {
      void invalidateFeeDependencies(queryClient);
      notify.error(getApiErrorMessage(error, "Không thể ghi nhận học phí."));
    },
  });

  const unpayGroupMutation = useMutation({
    mutationFn: async ({
      group,
      targetNotificationState,
    }: {
      group: StudentFeeGroup;
      targetNotificationState: FeeUnpayTargetState;
    }) => {
      return await unpayFeeRecords(
        group.records.map((record) => record.id),
        targetNotificationState,
      );
    },
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: async (result, variables) => {
      updateFeeRecordsInCache(queryClient, result);
      notify.success(
        variables.targetNotificationState === "UNNOTIFIED"
          ? "Đã hoàn tác ghi nhận nộp và chuyển khoản học phí về trạng thái chưa báo."
          : "Đã hoàn tác ghi nhận nộp. Khoản học phí trở về trạng thái đã báo, chưa nộp.",
      );
      void invalidateFeeDependencies(queryClient);
    },
    onError: (error) => {
      void invalidateFeeDependencies(queryClient);
      notify.error(getApiErrorMessage(error, "Không thể hoàn tác học phí."));
    },
  });

  const refundGroupMutation = useMutation({
    mutationFn: async ({
      payload,
    }: {
      group: StudentFeeGroup;
      payload: FeeRefundRequest;
    }) => await refundFeeRecords(payload),
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: async (result) => {
      updateFeeRecordsInCache(queryClient, result);
      setRefundReceipt(result.receipt);
      await invalidateFeeTransactionQueries(queryClient);
      notify.success("Đã ghi nhận hoàn phí và lưu lịch sử đối soát.");
      void invalidateFeeDependencies(queryClient);
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ["fee-transactions"] });
      void invalidateFeeDependencies(queryClient);
      notify.error(
        getApiErrorMessage(
          error,
          "Không thể hoàn phí. Dữ liệu trong biểu mẫu vẫn được giữ để bạn kiểm tra lại.",
        ),
      );
    },
  });

  const refundReversalMutation = useMutation({
    mutationFn: async ({
      payload,
    }: {
      group: StudentFeeGroup;
      payload: FeeRefundReversalRequest;
    }) => await reverseFeeRefund(payload),
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: async (result) => {
      updateFeeRecordsInCache(queryClient, result);
      await invalidateFeeTransactionQueries(queryClient);
      notify.success("Đã hoàn tác khoản hoàn phí nhập nhầm và lưu bút toán sửa sai.");
      void invalidateFeeDependencies(queryClient);
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ["fee-transactions"] });
      void invalidateFeeDependencies(queryClient);
      notify.error(
        getApiErrorMessage(error, "Không thể hoàn tác khoản hoàn phí."),
      );
    },
  });

  const unnotifyGroupMutation = useMutation({
    mutationFn: async (group: StudentFeeGroup) => {
      return await unnotifyFeeRecords(group.records.map((record) => record.id));
    },
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: async (result) => {
      updateFeeRecordsInCache(queryClient, result);
      notify.success("Đã chuyển học phí về trạng thái chưa báo.");
      void invalidateFeeDependencies(queryClient);
    },
    onError: (error) => {
      void invalidateFeeDependencies(queryClient);
      notify.error(getApiErrorMessage(error, "Không thể hoàn tác thông báo."));
    },
  });

  useEffect(() => {
    if (!isAdmin || period !== getCurrentFeePeriod()) {
      return;
    }

    // Enrollment mutations reconcile current fees on the backend. This is a
    // current-period fallback only; opening historical reports must stay read-only.
    syncMutation.mutate(period);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, period]);

  const indexedRecords = useMemo(
    () => indexFeeRecords(feesQuery.data?.records ?? []),
    [feesQuery.data?.records],
  );

  const { classFeeSummaries, summary, visibleGroups } = useMemo(
    () =>
      deriveFeeViewModel({
        activeTab,
        classId: deferredClassId,
        indexedRecords,
        matchesFeeSearch,
        unpaidStage,
        classes: classesQuery.data ?? [],
      }),
    [activeTab, deferredClassId, indexedRecords, matchesFeeSearch, unpaidStage, classesQuery.data],
  );

  const activeRefundTarget = useMemo(() => {
    if (!refundTarget) return null;
    return (
      visibleGroups.find(
        (group) => group.student_id === refundTarget.student_id,
      ) ?? refundTarget
    );
  }, [refundTarget, visibleGroups]);

  const isBusy =
    notifyGroupMutation.isPending ||
    payGroupMutation.isPending ||
    refundGroupMutation.isPending ||
    refundReversalMutation.isPending ||
    unpayGroupMutation.isPending ||
    unnotifyGroupMutation.isPending;
  const pendingAction: FeeMutationAction | null = notifyGroupMutation.isPending
    ? "notify"
    : payGroupMutation.isPending
      ? "pay"
      : refundGroupMutation.isPending
        ? "refund"
        : refundReversalMutation.isPending
          ? "refund"
        : unpayGroupMutation.isPending
          ? "unpay"
          : unnotifyGroupMutation.isPending
            ? "unnotify"
            : null;
  const pendingStudentId =
    notifyGroupMutation.variables?.student_id ??
    payGroupMutation.variables?.group.student_id ??
    refundGroupMutation.variables?.group.student_id ??
    refundReversalMutation.variables?.group.student_id ??
    unpayGroupMutation.variables?.group.student_id ??
    unnotifyGroupMutation.variables?.student_id ??
    null;
  const hasFeeData = feesQuery.data !== undefined;
  const hasClassData = classesQuery.data !== undefined;
  const hasMessageTemplateData = messageTemplatesQuery.data !== undefined;
  const hasFeeTransactionData = feeTransactionsQuery.data !== undefined;
  const isInitialLoading =
    Boolean(user) &&
    !isInvalidPeriod &&
    (
      (!hasFeeData &&
        (feesQuery.isPending || feesQuery.isFetching || syncMutation.isPending)) ||
      (!hasClassData && classesQuery.isPending) ||
      (isAdmin && !hasMessageTemplateData && messageTemplatesQuery.isPending) ||
      (hasFeeData &&
        !hasFeeTransactionData &&
        feeTransactionsQuery.isPending)
    );
  const hasBlockingFeeError =
    feesQuery.isError && !hasFeeData && !feesQuery.isFetching && !syncMutation.isPending;
  const hasBlockingTransactionError =
    hasFeeData &&
    feeTransactionsQuery.isError &&
    !hasFeeTransactionData &&
    !feeTransactionsQuery.isFetching;
  const hasBlockingLoadError =
    hasBlockingFeeError || hasBlockingTransactionError;
  const hasRefreshError =
    (feesQuery.isError && hasFeeData) ||
    (feeTransactionsQuery.isError && hasFeeTransactionData);

  const [currentYearText, currentMonthText] = getCurrentFeePeriod().split("-");
  const currentYear = Number(currentYearText);
  const currentMonth = Number(currentMonthText);

  const availableYears = new Set<number>([currentYear, currentYear - 1]);
  for (const availablePeriod of feePeriodsQuery.data?.periods ?? []) {
    const availableYear = Number(availablePeriod.slice(0, 4));
    if (Number.isInteger(availableYear) && availableYear >= 2000 && availableYear <= currentYear) {
      availableYears.add(availableYear);
    }
  }
  const selectedYear = Number(periodYear);
  if (Number.isInteger(selectedYear) && selectedYear >= 2000 && selectedYear <= currentYear) {
    availableYears.add(selectedYear);
  }
  const yearOptions = getAscendingFeeYears(availableYears)
    .map((year) => ({ label: `Năm ${year}`, value: String(year) }));

  const maxMonth = getFeeMonthLimit(periodYear, `${currentYearText}-${currentMonthText}`);
  const monthOptions = Array.from({ length: maxMonth }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    return { label: `Tháng ${i + 1}`, value: m };
  });

  const filterControls = (
    <HeaderFilterControls
      searchPlaceholder="Tìm học viên, lớp, SĐT..."
      searchValue={search}
      onSearchChange={setSearch}
      onClear={() => setPeriod(getCurrentFeePeriod())}
      filters={[
        {
          label: "Năm",
          value: periodYear,
          defaultValue: String(currentYear),
          allowDeselect: false,
          onChange: (newYear) => {
            setPeriod((selectedPeriod) =>
              changeFeePeriodYear(
                selectedPeriod,
                newYear,
                `${currentYearText}-${currentMonthText}`,
              ),
            );
          },
          options: yearOptions,
        },
        {
          label: "Tháng",
          value: periodMonth,
          defaultValue: String(currentMonth).padStart(2, "0"),
          allowDeselect: false,
          onChange: (newMonth) => {
            setPeriod((selectedPeriod) =>
              changeFeePeriodMonth(
                selectedPeriod,
                newMonth,
                `${currentYearText}-${currentMonthText}`,
              ),
            );
          },
          options: monthOptions,
        },
      ]}
    />
  );
  async function handleExport() {
    setIsExporting(true);
    try {
      const recordIds = Array.from(
        new Set(
          visibleGroups.flatMap((group) =>
            group.records.map((record) => record.id),
          ),
        ),
      );
      const visibleRecordIds = new Set(recordIds);
      const transactionHistories = (
        feeTransactionsQuery.data ?? await loadFeeTransactionHistories(recordIds)
      ).filter((history) => visibleRecordIds.has(history.fee_record_id));
      await exportFeeGroups(
        visibleGroups,
        {
          activeTab,
          className: classFeeSummaries.find((class_) => class_.id === classId)
            ?.name,
          period,
          unpaidStage,
        },
        transactionHistories,
      );
      notify.success("Đã xuất file Excel kèm lịch sử giao dịch.");
    } catch {
      notify.error("Không thể xuất file Excel. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  }

  const exportButton = (
    <button
      type="button"
      disabled={visibleGroups.length === 0 || isInitialLoading || isExporting}
      onClick={() => void handleExport()}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[#217346] px-3 text-sm font-medium text-white transition hover:bg-[#1b5f3a] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {!isExporting ? (
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
      ) : null}
      {isExporting ? <LoadingLabel label="Đang xuất" /> : "Excel"}
    </button>
  );
  const messageTemplateButton = isAdmin ? (
    <button
      type="button"
      disabled={!messageTemplatesQuery.data || updateMessageTemplatesMutation.isPending}
      onClick={() => setIsMessageTemplateDialogOpen(true)}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
      Nội dung Zalo
    </button>
  ) : null;
  const confirmationContent = getFeeConfirmationContent(
    confirmationTarget,
    unpayTargetState,
  );
  const canRestoreNotifiedState =
    confirmationTarget?.action === "unpay" &&
    canRestoreNotifiedFeeState(confirmationTarget.group);
  const visibleUnpayTargetOptions = canRestoreNotifiedState
    ? UNPAY_TARGET_OPTIONS
    : UNPAY_TARGET_OPTIONS.filter((option) => option.value === "UNNOTIFIED");
  const isConfirmationMutationPending = Boolean(
    confirmationTarget &&
    pendingAction === confirmationTarget.action &&
    pendingStudentId === confirmationTarget.group.student_id,
  );

  return (
    <div className="flex flex-col gap-4 md:h-full md:overflow-hidden">
      <HeaderControlsPortal>
        <div className="flex min-w-0 items-center gap-2">
          {filterControls}
          {messageTemplateButton}
          {exportButton}
        </div>
      </HeaderControlsPortal>

      <div className="flex min-w-0 items-center gap-2 md:hidden">
        {filterControls}
        {messageTemplateButton}
        {exportButton}
      </div>

      <div className="flex min-h-0 flex-col gap-3 md:flex-1 md:overflow-hidden">
        {feePeriodsQuery.isError ? (
          <div
            role="status"
            className="flex shrink-0 items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <span>Chưa tải được toàn bộ kỳ học phí cũ. Kỳ đang chọn vẫn có thể sử dụng.</span>
            <button
              type="button"
              disabled={feePeriodsQuery.isFetching}
              className="shrink-0 font-semibold underline underline-offset-2 disabled:cursor-wait disabled:opacity-60"
              onClick={() => void feePeriodsQuery.refetch()}
            >
              {feePeriodsQuery.isFetching ? <LoadingLabel label="Đang tải" /> : "Thử lại"}
            </button>
          </div>
        ) : null}

        {messageTemplatesQuery.isError ? (
          <div
            role="status"
            className="flex shrink-0 items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <span>
              {messageTemplatesQuery.data
                ? "Không thể cập nhật mẫu Zalo mới nhất. Hệ thống đang dùng nội dung đã tải gần nhất."
                : "Chưa tải được nội dung Zalo. Sao chép và đánh dấu đã báo đang tạm khoá để tránh gửi sai mẫu."}
            </span>
            <button
              type="button"
              disabled={messageTemplatesQuery.isFetching}
              className="shrink-0 font-semibold underline underline-offset-2 disabled:cursor-wait disabled:opacity-60"
              onClick={() => void messageTemplatesQuery.refetch()}
            >
              {messageTemplatesQuery.isFetching ? <LoadingLabel label="Đang tải" /> : "Thử lại"}
            </button>
          </div>
        ) : null}

        {isInitialLoading ? (
          <FeesPageSkeleton isAdmin={isAdmin} />
        ) : (
          <>
            {hasFeeData && !isInvalidPeriod && !hasBlockingLoadError ? (
              <FeeReportPanel
                activeClassId={classId}
                activeTab={activeTab}
                classItems={classFeeSummaries}
                summary={summary}
                unpaidStage={unpaidStage}
                onChangeClass={setClassId}
                onChangeTab={setActiveTab}
                onChangeUnpaidStage={setUnpaidStage}
              />
            ) : null}

            <div className="min-h-0 md:flex md:flex-1 md:flex-col md:overflow-hidden">
              {hasRefreshError ? (
                <div
                  role="status"
                  className="mb-2 flex shrink-0 items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                >
                  <span>Không thể cập nhật đầy đủ dữ liệu mới nhất. Đang hiển thị dữ liệu đã tải gần nhất.</span>
                  <button
                    type="button"
                    disabled={feesQuery.isFetching || feeTransactionsQuery.isFetching}
                    className="shrink-0 font-semibold underline underline-offset-2 hover:text-amber-950 disabled:cursor-wait disabled:opacity-60"
                    onClick={() => {
                      void feesQuery.refetch();
                      void feeTransactionsQuery.refetch();
                    }}
                  >
                    {feesQuery.isFetching || feeTransactionsQuery.isFetching
                      ? <LoadingLabel label="Đang cập nhật" />
                      : "Cập nhật lại"}
                  </button>
                </div>
              ) : null}

              <div className="min-h-0 md:flex-1 md:overflow-hidden">
                {hasBlockingLoadError && !isInvalidPeriod ? (
                  <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-red-100 bg-red-50 px-4 text-center md:h-full">
                    <p className="font-semibold text-red-800">
                      Không thể tải đầy đủ dữ liệu học phí
                    </p>
                    <button
                      type="button"
                      disabled={feesQuery.isFetching || feeTransactionsQuery.isFetching}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-500 disabled:cursor-wait disabled:opacity-60"
                      onClick={() => {
                        if (hasBlockingFeeError) void feesQuery.refetch();
                        if (hasBlockingTransactionError) {
                          void feeTransactionsQuery.refetch();
                        }
                      }}
                    >
                      {feesQuery.isFetching || feeTransactionsQuery.isFetching
                        ? <LoadingLabel label="Đang thử lại" />
                        : "Thử lại"}
                    </button>
                  </div>
                ) : null}

                {isInvalidPeriod ||
                (hasFeeData && !hasBlockingLoadError && visibleGroups.length === 0) ? (
                  <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-md border border-gray-100 bg-gray-50 text-center md:h-full">
                    <p className="text-[13px] text-gray-500">
                      Không có khoản học phí phù hợp.
                    </p>
                  </div>
                ) : null}

                {hasFeeData &&
                !isInvalidPeriod &&
                !hasBlockingLoadError &&
                visibleGroups.length > 0 ? (
                  <FeesTable
                    activeTab={activeTab}
                    unpaidStage={unpaidStage}
                    isAdmin={isAdmin}
                    isBusy={isBusy}
                    isMessageUnavailable={!messageTemplatesQuery.data}
                    pendingAction={pendingAction}
                    pendingStudentId={pendingStudentId}
                    groups={visibleGroups}
                    onCopy={(group) => {
                      const templates = messageTemplatesQuery.data;
                      if (!templates) {
                        notify.warning("Chưa tải được nội dung Zalo. Vui lòng thử lại.");
                        return;
                      }
                      void copyFeeMessage(group, activeTab === "paid", templates)
                        .then(() => notify.success("Đã sao chép tin nhắn Zalo."))
                        .catch((error: unknown) =>
                          notify.error(
                            error instanceof Error
                              ? error.message
                              : "Không thể sao chép tin nhắn. Vui lòng thử lại.",
                          ),
                        );
                    }}
                    onNotify={(group) => notifyGroupMutation.mutate(group)}
                    onPay={(group) => {
                      setPaymentMethod("bank_transfer");
                      setConfirmationTarget({ action: "pay", group });
                    }}
                    onRefund={(group) => {
                      setRefundTarget(group);
                      setRefundReceipt(null);
                      refundGroupMutation.reset();
                    }}
                    onUnpay={(group) => {
                      setUnpayTargetState(getDefaultUnpayTargetState(group));
                      setConfirmationTarget({ action: "unpay", group });
                    }}
                    onUnnotify={(group) => setConfirmationTarget({ action: "unnotify", group })}
                  />
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      <ConfirmationDialog
        open={confirmationTarget !== null}
        title={confirmationContent.title}
        description={
          <>
            <p>{confirmationContent.description}</p>
            {confirmationTarget?.action === "pay" ? (
              <fieldset className="mt-4" disabled={isConfirmationMutationPending}>
                <legend className="text-sm font-medium text-gray-900">
                  Hình thức thanh toán
                </legend>
                <div className="mt-2 grid h-8 grid-cols-2 items-center overflow-hidden rounded-md border border-gray-200 bg-white p-0.5">
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`form-input-text flex h-full min-w-0 select-none cursor-pointer items-center justify-center whitespace-nowrap rounded-[5px] px-1 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-gray-950 ${
                        paymentMethod === option.value
                          ? "bg-gray-950 text-white"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      } ${isConfirmationMutationPending ? "cursor-wait opacity-60" : ""}`}
                    >
                      <input
                        type="radio"
                        name="fee-payment-method"
                        value={option.value}
                        checked={paymentMethod === option.value}
                        onChange={() => setPaymentMethod(option.value)}
                        className="sr-only"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <div className="hidden" aria-hidden="true">
                  <InlineFieldDivider />
                </div>
              </fieldset>
            ) : null}
            {confirmationTarget?.action === "unpay" ? (
              <fieldset className="mt-4" disabled={isConfirmationMutationPending}>
                <legend className="text-sm font-medium text-gray-900">
                  Chuyển khoản học phí về
                </legend>
                <div
                  className={`mt-2 grid h-9 gap-1.5 ${
                    visibleUnpayTargetOptions.length === 1
                      ? "grid-cols-1"
                      : "grid-cols-2"
                  }`}
                >
                  {visibleUnpayTargetOptions.map((option) => {
                    const selected = unpayTargetState === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex h-full select-none cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-gray-950 focus-within:ring-offset-2 ${
                          selected
                            ? "border-gray-950 bg-gray-950 text-white"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
                        } ${isConfirmationMutationPending ? "cursor-wait opacity-60" : ""}`}
                      >
                        <input
                          type="radio"
                          name="fee-unpay-target-state"
                          value={option.value}
                          checked={selected}
                          onChange={() => setUnpayTargetState(option.value)}
                          className="sr-only"
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
          </>
        }
        confirmLabel={confirmationContent.confirmLabel}
        tone={confirmationContent.tone}
        isPending={isConfirmationMutationPending}
        onCancel={() => setConfirmationTarget(null)}
        onConfirm={() => {
          if (!confirmationTarget) {
            return;
          }

          const options = { onSuccess: () => setConfirmationTarget(null) };
          if (confirmationTarget.action === "pay") {
            payGroupMutation.mutate(
              { group: confirmationTarget.group, method: paymentMethod },
              options,
            );
          } else if (confirmationTarget.action === "unpay") {
            unpayGroupMutation.mutate(
              {
                group: confirmationTarget.group,
                targetNotificationState: unpayTargetState,
              },
              options,
            );
          } else {
            unnotifyGroupMutation.mutate(confirmationTarget.group, options);
          }
        }}
      />

      <FeeRefundDialog
        open={activeRefundTarget !== null}
        group={activeRefundTarget}
        transactionHistories={feeTransactionsQuery.data ?? []}
        isHistoryLoading={feeTransactionsQuery.isFetching}
        hasHistoryError={feeTransactionsQuery.isError}
        onRetryHistory={() => void feeTransactionsQuery.refetch()}
        idempotencyScope={`${user?.id ?? "anonymous"}:${period}:${activeRefundTarget?.student_id ?? "none"}`}
        receipt={refundReceipt}
        isPending={refundGroupMutation.isPending}
        isReversalPending={refundReversalMutation.isPending}
        onClose={() => {
          if (refundGroupMutation.isPending || refundReversalMutation.isPending) return;
          setRefundTarget(null);
          setRefundReceipt(null);
          refundGroupMutation.reset();
          refundReversalMutation.reset();
        }}
        onSubmit={(payload) => {
          if (!activeRefundTarget) return;
          refundGroupMutation.mutate({ group: activeRefundTarget, payload });
        }}
        onReverseRefund={async (payload) => {
          if (!activeRefundTarget) return;
          await refundReversalMutation.mutateAsync({
            group: activeRefundTarget,
            payload,
          });
        }}
        onCopyReceipt={() => {
          if (!activeRefundTarget || !refundReceipt) return;
          void copyText(buildRefundReceiptMessage(activeRefundTarget, refundReceipt))
            .then(() => notify.success("Đã sao chép xác nhận hoàn phí."))
            .catch(() =>
              notify.error("Không thể sao chép xác nhận. Vui lòng thử lại."),
            );
        }}
      />

      {messageTemplatesQuery.data ? (
        <FeeMessageTemplateDialog
          open={isMessageTemplateDialogOpen}
          templates={messageTemplatesQuery.data}
          isSaving={updateMessageTemplatesMutation.isPending}
          onClose={() => {
            setIsMessageTemplateDialogOpen(false);
            updateMessageTemplatesMutation.reset();
          }}
          onSave={(payload) => updateMessageTemplatesMutation.mutate(payload)}
        />
      ) : null}
    </div>
  );
}

function updateFeeRecordsInCache(
  queryClient: QueryClient,
  result: FeeBatchActionResponse,
) {
  queryClient.setQueriesData<FeeRecordListResponse>(
    { queryKey: ["fees"] },
    (current) => {
      if (!current) {
        return current;
      }

      return mergeFeeBatchActionResult(current, result);
    },
  );
}

async function cancelFeeQueries(queryClient: QueryClient) {
  await queryClient.cancelQueries({ queryKey: ["fees"] });
}

async function invalidateFeeDependencies(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["fees"] }),
    queryClient.invalidateQueries({ queryKey: ["reports"] }),
  ]);
}

async function invalidateFeeTransactionQueries(
  queryClient: QueryClient,
) {
  await queryClient.invalidateQueries({ queryKey: ["fee-transactions"] });
}

async function loadFeeTransactionHistories(
  recordIds: string[],
): Promise<FeeTransactionListResponse[]> {
  if (recordIds.length === 0) return [];

  const batches = Array.from(
    { length: Math.ceil(recordIds.length / 100) },
    (_, index) => recordIds.slice(index * 100, index * 100 + 100),
  );
  const responses = await Promise.all(
    batches.map((batch) => getFeeTransactionBatch(batch)),
  );
  return responses.flatMap((response) => response.histories);
}
