"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  RiDownload2Line as Download,
  RiMessage2Line as MessageSquareText,
} from "react-icons/ri";
import { FeeMessageTemplateDialog } from "@/components/fees/fee-message-template-dialog";
import { FeeRefundPanel } from "@/components/fees/fee-refund-dialog";
import { FeePaymentRequestDialog } from "@/components/fees/fee-payment-request-dialog";
import { FeeReportPanel } from "@/components/fees/fee-report-panel";
import { EarlyPaymentPanel } from "@/components/fees/early-payment-panel";
import { FeesPageSkeleton } from "@/components/fees/fees-skeleton";
import { FeesTable } from "@/components/fees/fees-table";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderLoadingStatus } from "@/components/layout/header-loading-status";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { getClasses } from "@/lib/api/classes";
import { getBankingOverview } from "@/lib/api/banking";
import { classQueryKeys } from "@/lib/classes/query-keys";
import {
  getFeeRecords,
  getOutstandingFeeRecords,
  getUpcomingFeeRecords,
  getFeeTransactionBatch,
  getFeePeriods,
  getFeeMessageTemplates,
  getFeeMessageDraft,
  getFeePaymentCapabilities,
  getPaymentRequests,
  getBillingReviews,
  notifyFeeRecords,
  payFeeRecords,
  refundFeeRecords,
  reverseFeeRefund,
  resetFeeMessageTemplates,
  saveFeeMessageDraft,
  syncFeeRecords,
  unnotifyFeeRecords,
  unpayFeeRecords,
  resolveBillingReview,
  updateFeeMessageTemplates,
} from "@/lib/api/fees";
import { BillingReviewNotice } from "@/components/fees/billing-review-notice";
import { useAuth } from "@/lib/hooks/useAuth";
import { isManagementUser } from "@/lib/auth/permissions";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import {
  formatFeeGroupSubject,
  getGroupCopyMessage,
  type StudentFeeGroup,
} from "@/lib/fees/view-model";
import { mergeFeeBatchActionResult } from "@/lib/fees/cache";
import { copyText } from "@/lib/fees/clipboard";
import { buildRefundReceiptMessage } from "@/lib/fees/refund";
import {
  deriveFeeViewModel,
  indexFeeRecords,
} from "@/lib/fees/dashboard-view-model";
import {
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
import { formatPeriod } from "@/lib/utils/format";
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

type FeeWorkspaceView = "records" | "outstanding" | "early";

export default function FeesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = isManagementUser(user);
  const [search, setSearch] = usePersistentState("tpro:fees:search", "");
  const deferredSearch = useDeferredValue(search);
  const [period, setPeriod] = usePersistentState("tpro:fees:period", getCurrentFeePeriod());
  const [activeTab, setActiveTab] = usePersistentState<FeeTab>("tpro:fees:activeTab", "unpaid");
  const [unpaidStage, setUnpaidStage] = usePersistentState<UnpaidStage>("tpro:fees:unpaidStage", "unnotified");
  const [workspaceView, setWorkspaceView] = usePersistentState<FeeWorkspaceView>(
    "tpro:fees:view",
    "records",
  );
  const [classId, setClassId] = useState("");
  const [confirmationTarget, setConfirmationTarget] =
    useState<FeeConfirmationTarget | null>(null);
  const [paymentMethod, setPaymentMethod] =
    useState<FeePaymentMethod>("bank_transfer");
  const [settlementAccountId, setSettlementAccountId] = useState("");
  const [unpayTargetState, setUnpayTargetState] =
    useState<FeeUnpayTargetState>("NOTIFIED_UNPAID");
  const [refundTarget, setRefundTarget] = useState<StudentFeeGroup | null>(null);
  const [paymentRequestTarget, setPaymentRequestTarget] =
    useState<StudentFeeGroup | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [refundReceipt, setRefundReceipt] = useState<FeeRefundReceipt | null>(null);
  const [isMessageTemplateDialogOpen, setIsMessageTemplateDialogOpen] =
    useState(false);
  const deferredClassId = useDeferredValue(classId);
  const lastAutoSyncPeriodRef = useRef<string | null>(null);
  const notify = useToast();
  const matchesFeeSearch = useMemo(
    () => createPreparedSearchMatcher(deferredSearch),
    [deferredSearch],
  );

  const classesQuery = useQuery({
    queryKey: classQueryKeys.list("active"),
    queryFn: () => getClasses({ scope: "active" }),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
    initialData: () => queryClient.getQueryData(classQueryKeys.list("active")),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(classQueryKeys.list("active"))?.dataUpdatedAt,
  });

  const bankingQuery = useQuery({
    queryKey: ["banking-overview"],
    queryFn: () => getBankingOverview(),
    enabled: Boolean(user) && isAdmin,
    staleTime: 60_000,
  });
  const activeBankAccounts = useMemo(
    () => (bankingQuery.data?.accounts ?? []).filter((account) => account.is_active),
    [bankingQuery.data?.accounts],
  );

  const feePeriodsQuery = useQuery({
    queryKey: ["fee-periods"],
    queryFn: getFeePeriods,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });

  const paymentCapabilitiesQuery = useQuery({
    queryKey: ["fee-payment-capabilities"],
    queryFn: getFeePaymentCapabilities,
    enabled: Boolean(user) && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const paymentRequestsQuery = useQuery({
    queryKey: ["payment-requests"],
    queryFn: () => getPaymentRequests(),
    enabled: Boolean(user) && isAdmin,
    staleTime: 30_000,
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

  const billingReviewsQuery = useQuery({
    queryKey: ["fees", "billing-reviews", "pending"],
    queryFn: getBillingReviews,
    enabled: Boolean(user) && isAdmin,
    staleTime: 60_000,
  });

  const resolveBillingReviewMutation = useMutation({
    mutationFn: async ({
      reviewId,
      decision,
      feeRecordIds,
      reason,
    }: {
      reviewId: string;
      decision: "CONFIRM" | "WAIVE_CHARGE";
      feeRecordIds?: string[];
      reason?: string;
    }) =>
      resolveBillingReview(reviewId, {
        decision,
        fee_record_ids: feeRecordIds,
        reason,
      }),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      notify.success(
        variables.decision === "CONFIRM"
          ? "Đã xác nhận lịch thu mới. Khoản học phí có thể được báo và thu."
          : "Đã hủy khoản thu. Hệ thống sẽ không tự tạo lại khoản này.",
      );
    },
    onError: (error) =>
      notify.error(getApiErrorMessage(error, "Không thể xử lý thay đổi học phí.")),
  });

  const [periodYear, periodMonth] = period.split("-");
  const isInvalidPeriod = !/^\d{4}-(0[1-9]|1[0-2])$/.test(period);

  const feesQuery = useQuery({
    queryKey: ["fees", { period }],
    queryFn: () => getFeeRecords({ period }),
    enabled: Boolean(user) && !isInvalidPeriod,
    staleTime: 2 * 60_000,
    initialData: () => queryClient.getQueryData(["fees", { period }]),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(["fees", { period }])?.dataUpdatedAt,
  });

  const outstandingFeesQuery = useQuery({
    queryKey: ["fees", "outstanding"],
    queryFn: getOutstandingFeeRecords,
    enabled: Boolean(user),
    staleTime: 2 * 60_000,
  });

  const upcomingFeesQuery = useQuery({
    queryKey: ["fees", "upcoming", { class_id: classId ?? null }],
    queryFn: () => getUpcomingFeeRecords(classId || undefined),
    enabled: Boolean(user),
    staleTime: 2 * 60_000,
  });

  const isOutstandingView = workspaceView === "outstanding";
  const isLedgerView = workspaceView !== "early";
  const hasInvalidActivePeriod = !isOutstandingView && isInvalidPeriod;
  const displayActiveTab: FeeTab = isOutstandingView ? "unpaid" : activeTab;
  const activeFeeData = isOutstandingView
    ? outstandingFeesQuery.data
    : feesQuery.data;
  const activeFeesPending = isOutstandingView
    ? outstandingFeesQuery.isPending
    : feesQuery.isPending;
  const activeFeesFetching = isOutstandingView
    ? outstandingFeesQuery.isFetching
    : feesQuery.isFetching;
  const activeFeesError = isOutstandingView
    ? outstandingFeesQuery.isError
    : feesQuery.isError;

  const refundFeeRecordIds = useMemo(
    () =>
      Array.from(
        new Set((refundTarget?.records ?? []).map((record) => record.id)),
      ).sort(),
    [refundTarget],
  );

  const feeTransactionsQuery = useQuery({
    queryKey: [
      "fee-transactions",
      "refund-workspace",
      { period, groupKey: refundTarget?.group_key ?? null, refundFeeRecordIds },
    ],
    queryFn: () => loadFeeTransactionHistories(refundFeeRecordIds),
    // Start this detail request when the operator opens the action workspace,
    // but only for that student's fee records. The refund panel can then open
    // from warm cache without scanning every fee in the selected period.
    enabled:
      Boolean(user) &&
      !hasInvalidActivePeriod &&
      activeFeeData !== undefined &&
      refundTarget !== null &&
      refundFeeRecordIds.length > 0,
    staleTime: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: syncFeeRecords,
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: (data) => {
      queryClient.setQueryData(["fees", { period: data.period }], data);
      void queryClient.invalidateQueries({ queryKey: ["fees", "outstanding"] });
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
      const recordIds = records.map((record) => record.id);
      const draft = await getFeeMessageDraft(recordIds, "reminder");
      return await notifyFeeRecords(recordIds, draft);
    },
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: (result, group) => {
      updateFeeRecordsInCache(queryClient, result);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      notify.success(
        `Đã báo học phí cho phụ huynh ${formatFeeGroupSubject(group)}.`,
      );
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

  const saveMessageDraftMutation = useMutation({
    mutationFn: async ({
      group,
      kind,
      message,
    }: {
      group: StudentFeeGroup;
      kind: "reminder" | "received";
      message: string;
    }) =>
      saveFeeMessageDraft(
        group.records.map((record) => record.id),
        kind,
        message,
      ),
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["fee-message-draft"] });
      notify.success(
        `Đã lưu nội dung Zalo riêng cho ${formatFeeGroupSubject(variables.group)}.`,
      );
    },
    onError: (error) => {
      recoverFeeMutationData(queryClient);
      notify.error(
        getApiErrorMessage(
          error,
          "Không thể lưu nội dung Zalo riêng. Nội dung đang nhập vẫn được giữ nguyên.",
        ),
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

  const resetMessageTemplatesMutation = useMutation({
    mutationFn: resetFeeMessageTemplates,
    onSuccess: (templates) => {
      queryClient.setQueryData(["fee-message-templates"], templates);
      setIsMessageTemplateDialogOpen(false);
      notify.success("Đã khôi phục nội dung mặc định.");
    },
    onError: (error) => {
      void messageTemplatesQuery.refetch();
      notify.error(getApiErrorMessage(error, "Không thể khôi phục nội dung mặc định."));
    },
  });

  const payGroupMutation = useMutation({
    mutationFn: async ({
      group,
      method,
      settlementAccountId: selectedSettlementAccountId,
    }: {
      group: StudentFeeGroup;
      method: FeePaymentMethod;
      settlementAccountId?: string;
    }) => {
      return await payFeeRecords(
        group.records.map((record) => record.id),
        method,
        selectedSettlementAccountId || undefined,
      );
    },
    onMutate: () => cancelFeeQueries(queryClient),
    onSuccess: (result, variables) => {
      updateFeeRecordsInCache(queryClient, result);
      notify.success(
        `Đã ghi nhận học phí của ${formatFeeGroupSubject(variables.group)}.`,
      );
      invalidateSuccessfulFeeMutation(queryClient, { transactions: true });
    },
    onError: (error) => {
      recoverFeeMutationData(queryClient);
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
    onSuccess: (result, variables) => {
      updateFeeRecordsInCache(queryClient, result);
      const subject = formatFeeGroupSubject(variables.group);
      notify.success(
        variables.targetNotificationState === "UNNOTIFIED"
          ? `Đã hoàn tác ghi nhận học phí của ${subject} và chuyển về trạng thái chưa báo.`
          : `Đã hoàn tác ghi nhận học phí của ${subject} về trạng thái đã báo, chưa nộp.`,
      );
      invalidateSuccessfulFeeMutation(queryClient, { transactions: true });
    },
    onError: (error) => {
      recoverFeeMutationData(queryClient);
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
    onSuccess: (result, variables) => {
      updateFeeRecordsInCache(queryClient, result);
      setRefundReceipt(result.receipt);
      notify.success(
        `Đã ghi nhận hoàn phí cho ${formatFeeGroupSubject(variables.group)} và lưu lịch sử đối soát.`,
      );
      invalidateSuccessfulFeeMutation(queryClient, { transactions: true });
    },
    onError: (error) => {
      recoverFeeMutationData(queryClient);
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
    onSuccess: (result, variables) => {
      updateFeeRecordsInCache(queryClient, result);
      notify.success(
        `Đã hoàn tác khoản hoàn phí của ${formatFeeGroupSubject(variables.group)} và lưu bút toán sửa sai.`,
      );
      invalidateSuccessfulFeeMutation(queryClient, { transactions: true });
    },
    onError: (error) => {
      recoverFeeMutationData(queryClient);
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
    onSuccess: (result, group) => {
      updateFeeRecordsInCache(queryClient, result);
      notify.success(
        `Đã chuyển học phí của ${formatFeeGroupSubject(group)} về trạng thái chưa báo.`,
      );
      invalidateSuccessfulFeeMutation(queryClient);
    },
    onError: (error) => {
      recoverFeeMutationData(queryClient);
      notify.error(getApiErrorMessage(error, "Không thể hoàn tác thông báo."));
    },
  });

  useEffect(() => {
    if (
      !isAdmin ||
      period !== getCurrentFeePeriod() ||
      !feesQuery.isSuccess ||
      feesQuery.isFetching ||
      feesQuery.data.records.length > 0 ||
      lastAutoSyncPeriodRef.current === period
    ) {
      return;
    }

    // Student/class/enrollment mutations already reconcile current fees.
    // Generate the period only when it is genuinely empty instead of locking
    // and rescanning the whole ledger on every visit to the page.
    lastAutoSyncPeriodRef.current = period;
    syncMutation.mutate(period);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    feesQuery.data?.records.length,
    feesQuery.isFetching,
    feesQuery.isSuccess,
    isAdmin,
    period,
  ]);

  const indexedRecords = useMemo(
    () => indexFeeRecords(activeFeeData?.records ?? []),
    [activeFeeData?.records],
  );

  const { classFeeSummaries, summary, visibleGroups } = useMemo(
    () =>
      deriveFeeViewModel({
        activeTab: displayActiveTab,
        classId: deferredClassId,
        indexedRecords,
        matchesFeeSearch,
        unpaidStage,
        classes: classesQuery.data ?? [],
        separatePeriods: isOutstandingView,
      }),
    [
      displayActiveTab,
      deferredClassId,
      indexedRecords,
      isOutstandingView,
      matchesFeeSearch,
      unpaidStage,
      classesQuery.data,
    ],
  );

  const activeRefundTarget = useMemo(() => {
    if (!refundTarget) return null;
    return (
      visibleGroups.find(
        (group) => group.group_key === refundTarget.group_key,
      ) ?? refundTarget
    );
  }, [refundTarget, visibleGroups]);

  const closeRefundWorkspace = () => {
    if (refundGroupMutation.isPending || refundReversalMutation.isPending) return;
    setRefundTarget(null);
    setRefundReceipt(null);
    refundGroupMutation.reset();
    refundReversalMutation.reset();
  };

  const isBusy =
    notifyGroupMutation.isPending ||
    saveMessageDraftMutation.isPending ||
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
  const pendingGroupKey =
    notifyGroupMutation.variables?.group_key ??
    saveMessageDraftMutation.variables?.group.group_key ??
    payGroupMutation.variables?.group.group_key ??
    refundGroupMutation.variables?.group.group_key ??
    refundReversalMutation.variables?.group.group_key ??
    unpayGroupMutation.variables?.group.group_key ??
    unnotifyGroupMutation.variables?.group_key ??
    null;
  const hasFeeData = activeFeeData !== undefined;
  const hasClassData = classesQuery.data !== undefined;
  const isTabCountInitialLoading = Boolean(
    (outstandingFeesQuery.isPending && outstandingFeesQuery.data === undefined) ||
      (upcomingFeesQuery.isPending && upcomingFeesQuery.data === undefined),
  );
  const isEarlyPaymentInitialLoading = Boolean(
    workspaceView === "early" &&
      isAdmin &&
      ((paymentCapabilitiesQuery.isPending &&
        paymentCapabilitiesQuery.data === undefined) ||
        (paymentRequestsQuery.isPending &&
          paymentRequestsQuery.data === undefined) ||
        (bankingQuery.isPending && bankingQuery.data === undefined)),
  );
  const isInitialLoading =
    Boolean(user) &&
    !hasInvalidActivePeriod &&
    (
      isEarlyPaymentInitialLoading ||
      (isLedgerView &&
        ((!hasFeeData &&
          (activeFeesPending ||
            activeFeesFetching ||
            (!isOutstandingView && syncMutation.isPending))) ||
          (!hasClassData && classesQuery.isPending)))
    );
  const hasBlockingFeeError =
    isLedgerView &&
    activeFeesError &&
    !hasFeeData &&
    !activeFeesFetching &&
    (isOutstandingView || !syncMutation.isPending);
  const hasBlockingLoadError = hasBlockingFeeError;
  const hasRefreshError =
    isLedgerView && activeFeesError && hasFeeData;

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
  const hasFeeListFilters = Boolean(search.trim() || classId);

  const filterControls = isLedgerView ? (
    <HeaderFilterControls
      searchPlaceholder="Tìm học viên, lớp, SĐT..."
      searchValue={search}
      onSearchChange={setSearch}
      onClear={
        workspaceView === "records"
          ? () => setPeriod(getCurrentFeePeriod())
          : undefined
      }
      filters={workspaceView === "records" ? [
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
      ] : []}
    />
  ) : null;
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
          activeTab: displayActiveTab,
          className: classFeeSummaries.find((class_) => class_.id === classId)
            ?.name,
          period: isOutstandingView ? "outstanding" : period,
          unpaidStage,
        },
        transactionHistories,
      );
      notify.success("Đã xuất danh sách học phí kèm lịch sử giao dịch ra file Excel.");
    } catch {
      notify.error("Không thể xuất file Excel. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  }

  const exportButton = isLedgerView ? (
    <Button
      type="button"
      disabled={visibleGroups.length === 0 || isInitialLoading || isExporting}
      onClick={() => void handleExport()}
      className="bg-[#217346] text-white hover:bg-[#1b5f3a]"
    >
      {!isExporting ? (
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
      ) : null}
      {isExporting ? <LoadingLabel label="Đang xuất" /> : "Excel"}
    </Button>
  ) : null;
  const messageTemplateButton = isLedgerView && isAdmin ? (
    <Button
      type="button"
      variant="outline"
      disabled={!messageTemplatesQuery.data || updateMessageTemplatesMutation.isPending}
      onClick={() => setIsMessageTemplateDialogOpen(true)}
    >
      <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
      Nội dung Zalo
    </Button>
  ) : null;
  const confirmationContent = getFeeConfirmationContent(
    confirmationTarget,
    unpayTargetState,
  );
  // Keep both reversal targets visible. The selected target is written to the
  // fee record by the backend as one atomic, audited state transition.
  const visibleUnpayTargetOptions = UNPAY_TARGET_OPTIONS;
  const isConfirmationMutationPending = Boolean(
    confirmationTarget &&
    pendingAction === confirmationTarget.action &&
    pendingGroupKey === confirmationTarget.group.group_key,
  );

  return (
    <div className="flex flex-col gap-4 md:h-full md:overflow-hidden">
      <HeaderControlsPortal>
        <div className="flex min-w-0 items-center gap-2">
          {filterControls}
          {messageTemplateButton}
          {exportButton}
          <HeaderLoadingStatus
            isLoading={Boolean(isLedgerView && (isInitialLoading || activeFeesFetching || classesQuery.isFetching))}
          />
        </div>
      </HeaderControlsPortal>

      <div className="flex min-w-0 items-center gap-2 md:hidden">
        {filterControls}
        {messageTemplateButton}
        {exportButton}
      </div>

      <FeeWorkspaceTabs
        activeView={workspaceView}
        onChange={(nextView) => {
          setWorkspaceView(nextView);
          setClassId("");
          if (nextView === "outstanding") {
            setActiveTab("unpaid");
          }
        }}
        outstandingCount={
          new Set(
            (outstandingFeesQuery.data?.records ?? []).map(
              (record) => `${record.student_id}:${record.period}`,
            ),
          ).size
        }
        upcomingCount={upcomingFeesQuery.data?.records.length ?? 0}
        isLoading={isTabCountInitialLoading}
      />

      <div
        id={`fees-panel-${workspaceView}`}
        role="tabpanel"
        aria-labelledby={`fees-tab-${workspaceView}`}
        className="flex min-h-0 flex-col gap-3 md:flex-1 md:overflow-hidden"
      >
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
            {isLedgerView && isAdmin ? (
              <BillingReviewNotice
                reviews={billingReviewsQuery.data?.reviews ?? []}
                isLoading={billingReviewsQuery.isPending}
                isResolving={resolveBillingReviewMutation.isPending}
                onConfirm={(review) =>
                  resolveBillingReviewMutation.mutate({
                    reviewId: review.id,
                    decision: "CONFIRM",
                  })
                }
                onWaive={(review, fee, reason) =>
                  resolveBillingReviewMutation.mutate({
                    reviewId: review.id,
                    decision: "WAIVE_CHARGE",
                    feeRecordIds: [fee.id],
                    reason,
                  })
                }
              />
            ) : null}

            {isLedgerView && hasFeeData && !hasInvalidActivePeriod && !hasBlockingLoadError ? (
              <FeeReportPanel
                activeClassId={classId}
                activeTab={displayActiveTab}
                classItems={classFeeSummaries}
                embedded
                outstandingView={isOutstandingView}
                scopeLabel={isOutstandingView ? "Tất cả kỳ" : formatPeriod(period)}
                summary={summary}
                unpaidStage={unpaidStage}
                onChangeClass={setClassId}
                onChangeTab={setActiveTab}
                onChangeUnpaidStage={setUnpaidStage}
              />
            ) : null}

            {workspaceView === "early" && isAdmin && !isInvalidPeriod && !hasBlockingLoadError ? (
              <EarlyPaymentPanel
                records={upcomingFeesQuery.data?.records ?? []}
                isLoading={upcomingFeesQuery.isPending}
                isError={upcomingFeesQuery.isError}
                isRetrying={upcomingFeesQuery.isFetching}
                qrEnabled={paymentCapabilitiesQuery.data?.qr_creation_enabled ?? false}
                pay2sReady={paymentCapabilitiesQuery.data?.automatic_recording_ready ?? false}
                requests={paymentRequestsQuery.data?.requests ?? []}
                accountOptions={activeBankAccounts}
                onRetry={() => void upcomingFeesQuery.refetch()}
                onChanged={() => {
                  void queryClient.invalidateQueries({ queryKey: ["fees"] });
                  void queryClient.invalidateQueries({ queryKey: ["reports"] });
                  void queryClient.invalidateQueries({ queryKey: ["payment-requests"] });
                }}
              />
            ) : null}

            {workspaceView === "early" && !isAdmin ? (
              <div
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                role="status"
              >
                Chỉ quản trị viên mới có thể tạo yêu cầu thanh toán sớm hoặc ghi nhận tiền mặt.
              </div>
            ) : null}

            {isLedgerView ? <div className="min-h-0 md:flex md:flex-1 md:flex-col md:overflow-hidden xl:-mt-3">
              {hasRefreshError ? (
                <div
                  role="status"
                  className="mb-2 flex shrink-0 items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                >
                  <span>Không thể cập nhật đầy đủ dữ liệu mới nhất. Đang hiển thị dữ liệu đã tải gần nhất.</span>
                  <button
                    type="button"
                    disabled={activeFeesFetching || feeTransactionsQuery.isFetching}
                    className="shrink-0 font-semibold underline underline-offset-2 hover:text-amber-950 disabled:cursor-wait disabled:opacity-60"
                    onClick={() => {
                      if (isOutstandingView) {
                        void outstandingFeesQuery.refetch();
                      } else {
                        void feesQuery.refetch();
                      }
                    }}
                  >
                    {activeFeesFetching
                      ? <LoadingLabel label="Đang tải" />
                      : "Cập nhật lại"}
                  </button>
                </div>
              ) : null}

              <div className="min-h-0 md:flex-1 md:overflow-hidden">
                {hasBlockingLoadError && !hasInvalidActivePeriod ? (
                  <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-destructive/15 bg-destructive-soft px-4 text-center md:h-full">
                    <p className="font-semibold text-destructive">
                      Không thể tải đầy đủ dữ liệu học phí
                    </p>
                    <button
                      type="button"
                      disabled={activeFeesFetching}
                      className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground shadow-sm hover:bg-destructive/90 disabled:cursor-wait disabled:opacity-60"
                      onClick={() => {
                        if (hasBlockingFeeError) {
                          if (isOutstandingView) {
                            void outstandingFeesQuery.refetch();
                          } else {
                            void feesQuery.refetch();
                          }
                        }
                      }}
                    >
                      {activeFeesFetching
                        ? <LoadingLabel label="Đang thử lại" />
                        : "Thử lại"}
                    </button>
                  </div>
                ) : null}

                {hasInvalidActivePeriod ||
                (hasFeeData && !hasBlockingLoadError && visibleGroups.length === 0) ? (
                  <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-md border border-gray-100 bg-gray-50 px-4 text-center md:h-full">
                    <p className="text-[13px] text-gray-500">
                      {isOutstandingView
                        ? "Không có khoản còn phải thu phù hợp."
                        : "Không có khoản học phí phù hợp."}
                    </p>
                    {hasFeeListFilters ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch("");
                          setClassId("");
                        }}
                        className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        Xóa tìm kiếm và lọc lớp
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {hasFeeData &&
                !hasInvalidActivePeriod &&
                !hasBlockingLoadError &&
                visibleGroups.length > 0 ? (
                  <FeesTable
                    activeTab={displayActiveTab}
                    embedded
                    unpaidStage={unpaidStage}
                    isAdmin={isAdmin}
                    isBusy={isBusy}
                    isMessageUnavailable={!messageTemplatesQuery.data}
                    canCreatePaymentRequest={activeBankAccounts.length > 0}
                    pendingAction={pendingAction}
                    pendingGroupKey={pendingGroupKey}
                    groups={visibleGroups}
                    showPeriod={isOutstandingView}
                    onCopy={(group, message) => {
                      const templates = messageTemplatesQuery.data;
                      if (!templates) {
                        notify.warning("Chưa tải được nội dung Zalo. Vui lòng thử lại.");
                        return;
                      }
                      const isPaidMessage = displayActiveTab === "paid";
                      void copyText(message)
                        .then(() =>
                          notify.success(
                            isPaidMessage
                              ? "Đã sao chép tin nhắn nhận học phí."
                              : "Đã sao chép tin nhắn đóng học phí.",
                          ),
                        )
                        .catch((error: unknown) =>
                          notify.error(
                            error instanceof Error
                              ? error.message
                              : "Không thể sao chép tin nhắn. Vui lòng thử lại.",
                          ),
                        );
                    }}
                    onSaveCopy={async (group, message) => {
                      const saved = await saveMessageDraftMutation.mutateAsync({
                        group,
                        message,
                        kind: displayActiveTab === "paid" ? "received" : "reminder",
                      });
                      return saved.message;
                    }}
                    isSavingCopy={saveMessageDraftMutation.isPending}
                    onNotify={(group) => notifyGroupMutation.mutate(group)}
                    onCreatePaymentRequest={(group) =>
                      setPaymentRequestTarget(group)
                    }
                    onPay={(group) => {
                      setPaymentMethod("bank_transfer");
                      setSettlementAccountId(
                        activeBankAccounts.find((account) => account.is_default)?.id ??
                          activeBankAccounts[0]?.id ??
                          "",
                      );
                      setConfirmationTarget({ action: "pay", group });
                    }}
                    onPrepareRefundHistory={(group) => {
                      setRefundTarget(group);
                      setRefundReceipt(null);
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
                    getCopyMessage={(group) => {
                      const templates = messageTemplatesQuery.data;
                      if (!templates) return null;
                      return getGroupCopyMessage(
                        group,
                        displayActiveTab === "paid",
                        templates.active,
                      );
                    }}
                    loadCopyMessage={async (group) => {
                      const draft = await getFeeMessageDraft(
                        group.records.map((record) => record.id),
                        displayActiveTab === "paid" ? "received" : "reminder",
                      );
                      if (draft.is_stale) {
                        notify.warning(
                          "Dữ liệu khoản thu đã thay đổi. Hãy rà soát rồi lưu lại nội dung trước khi sử dụng.",
                        );
                      }
                      return draft.message;
                    }}
                    refundPanel={(closeWorkspace) =>
                      activeRefundTarget ? (
                        <FeeRefundPanel
                          bankAccounts={activeBankAccounts}
                          group={activeRefundTarget}
                          transactionHistories={feeTransactionsQuery.data ?? []}
                          isHistoryLoading={feeTransactionsQuery.isFetching}
                          hasHistoryError={feeTransactionsQuery.isError}
                          onRetryHistory={() => void feeTransactionsQuery.refetch()}
                          idempotencyScope={`${user?.id ?? "anonymous"}:${activeRefundTarget.group_key}`}
                          receipt={refundReceipt}
                          isPending={refundGroupMutation.isPending}
                          isReversalPending={refundReversalMutation.isPending}
                          onClose={() => {
                            closeRefundWorkspace();
                            closeWorkspace();
                          }}
                          onSubmit={(payload) => {
                            refundGroupMutation.mutate({
                              group: activeRefundTarget,
                              payload,
                            });
                          }}
                          onReverseRefund={async (payload) => {
                            await refundReversalMutation.mutateAsync({
                              group: activeRefundTarget,
                              payload,
                            });
                          }}
                          onCopyReceipt={() => {
                            if (!refundReceipt) return;
                            void copyText(
                              buildRefundReceiptMessage(
                                activeRefundTarget,
                                refundReceipt,
                              ),
                            )
                              .then(() =>
                                notify.success("Đã sao chép xác nhận hoàn phí."),
                              )
                              .catch(() =>
                                notify.error(
                                  "Không thể sao chép xác nhận. Vui lòng thử lại.",
                                ),
                              );
                          }}
                        />
                      ) : null
                    }
                    onCloseRefund={closeRefundWorkspace}
                  />
                ) : null}
              </div>
            </div> : null}
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
                      className={`form-input-text flex h-full min-w-0 select-none cursor-pointer items-center justify-center whitespace-nowrap rounded-[5px] px-1 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary ${
                        paymentMethod === option.value
                          ? "bg-primary text-primary-foreground"
                          : "text-gray-600 hover:bg-primary-soft hover:text-primary"
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
                {paymentMethod === "bank_transfer" ? (
                  <div className="mt-3">
                    <label
                      htmlFor="fee-settlement-account"
                      className="text-sm font-medium text-gray-900"
                    >
                      Tài khoản đã nhận tiền
                    </label>
                    <select
                      id="fee-settlement-account"
                      value={settlementAccountId}
                      onChange={(event) => setSettlementAccountId(event.target.value)}
                      disabled={isConfirmationMutationPending}
                      className="form-input-text mt-1 h-9 w-full rounded-md border border-gray-200 bg-white px-2.5 text-sm text-gray-900 outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:cursor-wait disabled:opacity-60"
                    >
                      <option value="">Chọn tài khoản đã nhận tiền</option>
                      {activeBankAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.label} · {account.bank_name} · ****{account.account_number.slice(-4)}
                          {account.connection_type === "pay2s" ? " · Pay2S" : " · Thủ công"}
                        </option>
                      ))}
                    </select>
                    {activeBankAccounts.length === 0 ? (
                      <p className="mt-1 text-xs text-amber-700">
                        Chưa có tài khoản nhận tiền. Hãy thêm tài khoản ở trang Ngân hàng trước.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-gray-500">
                        Chọn đúng tài khoản thực tế đã nhận khoản chuyển khoản;
                        thông tin này được lưu trong lịch sử thanh toán.
                      </p>
                    )}
                  </div>
                ) : null}
              </fieldset>
            ) : null}
            {confirmationTarget?.action === "unpay" ? (
              <fieldset className="mt-4" disabled={isConfirmationMutationPending}>
                <legend className="text-sm font-medium text-gray-900">
                  Trạng thái sau hoàn tác
                </legend>
                <div
                  role="group"
                  aria-label="Trạng thái chuyển về"
                  className="mt-2 grid h-8 w-full select-none grid-cols-2 overflow-hidden rounded-md border border-gray-200 bg-white p-0.5"
                >
                  {visibleUnpayTargetOptions.map((option) => {
                    const selected = unpayTargetState === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={isConfirmationMutationPending}
                        onClick={() => setUnpayTargetState(option.value)}
                        className={`form-input-text h-full min-w-0 rounded-[5px] px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40 ${
                          selected
                            ? "bg-primary text-primary-foreground"
                            : "text-gray-600 hover:bg-primary-soft hover:text-primary"
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
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
          </>
        }
        confirmLabel={confirmationContent.confirmLabel}
        pendingLabel={confirmationContent.pendingLabel}
        tone={confirmationContent.tone}
        isPending={isConfirmationMutationPending}
        onCancel={() => setConfirmationTarget(null)}
        onConfirm={() => {
          if (!confirmationTarget) {
            return;
          }

          const options = { onSuccess: () => setConfirmationTarget(null) };
          if (confirmationTarget.action === "pay") {
            if (paymentMethod === "bank_transfer" && !settlementAccountId) {
              notify.error("Hãy chọn tài khoản ngân hàng đã nhận khoản chuyển khoản.");
              return;
            }
            payGroupMutation.mutate(
              {
                group: confirmationTarget.group,
                method: paymentMethod,
                settlementAccountId,
              },
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

      <FeePaymentRequestDialog
        group={paymentRequestTarget}
        existingRequest={paymentRequestsQuery.data?.requests.find(
          (request) => {
            if (!paymentRequestTarget) return false;
            if (request.status !== "OPEN" && request.status !== "REVIEW") {
              return false;
            }
            const recordIds = new Set(
              paymentRequestTarget.records.map((record) => record.id),
            );
            return (
              request.items.length === recordIds.size &&
              request.items.every((item) => recordIds.has(item.fee_record_id))
            );
          },
        )}
        pay2sReady={
          paymentCapabilitiesQuery.data?.automatic_recording_ready ?? false
        }
        onClose={() => setPaymentRequestTarget(null)}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["fees"] });
          void queryClient.invalidateQueries({ queryKey: ["reports"] });
          void queryClient.invalidateQueries({
            queryKey: ["payment-requests"],
          });
        }}
      />

      {messageTemplatesQuery.data ? (
        <FeeMessageTemplateDialog
          open={isMessageTemplateDialogOpen}
          templates={messageTemplatesQuery.data}
          isSaving={updateMessageTemplatesMutation.isPending || resetMessageTemplatesMutation.isPending}
          onClose={() => {
            setIsMessageTemplateDialogOpen(false);
            updateMessageTemplatesMutation.reset();
          }}
          onSave={(payload) => updateMessageTemplatesMutation.mutate(payload)}
          onReset={(version) => resetMessageTemplatesMutation.mutate(version)}
        />
      ) : null}
    </div>
  );
}

function FeeWorkspaceTabs({
  activeView,
  onChange,
  outstandingCount,
  upcomingCount,
  isLoading,
}: {
  activeView: FeeWorkspaceView;
  onChange: (view: FeeWorkspaceView) => void;
  outstandingCount: number;
  upcomingCount: number;
  isLoading: boolean;
}) {
  const tabs = [
    {
      id: "records" as const,
      label: "Khoản thu kỳ hiện tại",
    },
    {
      id: "outstanding" as const,
      label: "Khoản thu kỳ trước trễ hạn",
      count: outstandingCount,
    },
    {
      id: "early" as const,
      label: "Khoản thu sớm kỳ sau",
      count: upcomingCount,
    },
  ];

  return (
    <div
      role="tablist"
      aria-label="Khu vực học phí"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
        );
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (currentIndex < 0) return;
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        buttons[(currentIndex + direction + buttons.length) % buttons.length]?.focus();
      }}
      className="grid shrink-0 grid-cols-3 gap-1 rounded-xl border border-gray-200 bg-white p-1.5"
    >
      {tabs.map((tab) => {
        const selected = activeView === tab.id;
        return (
          <button
            key={tab.id}
            id={`fees-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`fees-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:gap-1.5 sm:px-3 sm:text-sm md:min-h-9 ${
              selected
                ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20"
                : "text-gray-600 hover:bg-primary-soft/60 hover:text-primary"
            }`}
          >
            <span className="min-w-0 whitespace-nowrap leading-5">
              {tab.label}
            </span>
            {tab.count !== undefined ? (
              <span className={`inline-flex min-w-4 shrink-0 items-center justify-center text-xs font-semibold tabular-nums ${selected ? "text-primary" : "text-gray-500"}`}>
                {isLoading ? (
                  <span className="h-3 w-4 animate-pulse rounded bg-gray-200" aria-hidden="true" />
                ) : tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
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

      const merged = mergeFeeBatchActionResult(current, result);
      return current.period === "outstanding"
        ? {
            ...merged,
            records: merged.records.filter((record) => record.status === "UNPAID"),
          }
        : merged;
    },
  );
}

async function cancelFeeQueries(queryClient: QueryClient) {
  await queryClient.cancelQueries({ queryKey: ["fees"] });
}

function invalidateSuccessfulFeeMutation(
  queryClient: QueryClient,
  options: { transactions?: boolean } = {},
) {
  void queryClient.invalidateQueries({ queryKey: ["reports"] });
  void queryClient.invalidateQueries({ queryKey: ["classes"] });
  void queryClient.invalidateQueries({ queryKey: ["fees", "outstanding"] });
  if (options.transactions) {
    void queryClient.invalidateQueries({ queryKey: ["fee-transactions"] });
  }
}

function recoverFeeMutationData(queryClient: QueryClient) {
  void Promise.all([
    queryClient.invalidateQueries({ queryKey: ["fees"] }),
    queryClient.invalidateQueries({ queryKey: ["fee-transactions"] }),
    queryClient.invalidateQueries({ queryKey: ["reports"] }),
    queryClient.invalidateQueries({ queryKey: ["classes"] }),
  ]);
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
