"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  RiCheckLine as Check,
  RiEyeOffLine as EyeOff,
  RiFileList3Line as FileList,
  RiLoader4Line as LoaderCircle,
  RiMessage2Line as MessageSquareText,
  RiQrCodeLine as QrCode,
  RiArrowGoBackLine as RotateCcw,
} from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { FormDialogHeader } from "@/components/ui/form-dialog-header";
import {
  FormDialogBody,
  FormDialogFooter,
} from "@/components/ui/form-dialog-shell";
import { RefundIcon } from "@/components/ui/refund-icon";
import { NotifiedBellIcon } from "@/components/ui/notified-bell-icon";
import { FeeMessageCodeEditor } from "@/components/fees/fee-message-code-editor";
import { getFeesTableGridClass } from "@/components/fees/table-layout";
import type {
  FeeMutationAction,
  FeeTab,
  UnpaidStage,
} from "@/lib/fees/types";
import { formatFeeBillingLabel } from "@/lib/fees/billing-label";
import type { StudentFeeGroup } from "@/lib/fees/view-model";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { useScopedTextSelection } from "@/lib/hooks/useScopedTextSelection";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import { useClickableRowProps } from "@/lib/ui/click-guard";
import { cn } from "@/lib/utils";

type FeesTableProps = {
  activeTab: FeeTab;
  unpaidStage: UnpaidStage;
  groups: StudentFeeGroup[];
  isAdmin: boolean;
  isBusy: boolean;
  isMessageUnavailable: boolean;
  canCreatePaymentRequest: boolean;
  pendingAction: FeeMutationAction | null;
  pendingGroupKey: string | null;
  onCopy: (group: StudentFeeGroup, message: string) => void;
  onSaveCopy: (group: StudentFeeGroup, message: string) => void | string | Promise<string>;
  isSavingCopy: boolean;
  onNotify: (group: StudentFeeGroup) => void;
  onCreatePaymentRequest: (group: StudentFeeGroup) => void;
  onPay: (group: StudentFeeGroup) => void;
  onPrepareRefundHistory: (group: StudentFeeGroup) => void;
  onRefund: (group: StudentFeeGroup) => void;
  onUnpay: (group: StudentFeeGroup) => void;
  onUnnotify: (group: StudentFeeGroup) => void;
  getCopyMessage: (group: StudentFeeGroup) => string | null;
  loadCopyMessage?: (group: StudentFeeGroup) => Promise<string>;
  refundPanel: (closeWorkspace: () => void) => React.ReactNode;
  onCloseRefund: () => void;
  embedded?: boolean;
  showPeriod?: boolean;
};

type FeeActionsProps = Pick<
  FeesTableProps,
  | "activeTab"
  | "unpaidStage"
  | "onCopy"
  | "onSaveCopy"
  | "isSavingCopy"
  | "onNotify"
  | "onCreatePaymentRequest"
  | "onPay"
  | "onRefund"
  | "onUnpay"
  | "onUnnotify"
  | "isMessageUnavailable"
  | "canCreatePaymentRequest"
> & {
  disabled: boolean;
  pendingAction: FeeMutationAction | null;
  group: StudentFeeGroup;
  getCopyMessage: (group: StudentFeeGroup) => string | null;
  loadCopyMessage?: (group: StudentFeeGroup) => Promise<string>;
  refundPanel: (closeWorkspace: () => void) => React.ReactNode;
};

type FeeWorkspaceMode =
  | "overview"
  | "copy"
  | "notify"
  | "qr"
  | "pay"
  | "unnotify"
  | "refund"
  | "unpay";

export function FeesTable({
  activeTab,
  unpaidStage,
  groups,
  isAdmin,
  isBusy,
  isMessageUnavailable,
  canCreatePaymentRequest,
  pendingAction,
  pendingGroupKey,
  onCopy,
  onSaveCopy,
  isSavingCopy,
  onNotify,
  onCreatePaymentRequest,
  onPay,
  onPrepareRefundHistory,
  onRefund,
  onUnpay,
  onUnnotify,
  getCopyMessage,
  loadCopyMessage,
  refundPanel,
  onCloseRefund,
  embedded = false,
  showPeriod = false,
}: FeesTableProps) {
  const selectionContainerRef = useRef<HTMLDivElement>(null);
  const [actionGroup, setActionGroup] = useState<StudentFeeGroup | null>(null);
  useScopedTextSelection(selectionContainerRef);
  const gridClass = getFeesTableGridClass({ isAdmin });
  const openActionWorkspace = (group: StudentFeeGroup) => {
    setActionGroup(group);
    if (activeTab === "paid") {
      onPrepareRefundHistory(group);
    }
  };

  return (
    <div
      ref={selectionContainerRef}
      className="text-selection-container h-full min-h-0"
    >
      <div className="scrollbar-hidden grid gap-3 md:h-full md:overflow-y-auto md:overscroll-contain xl:hidden">
        {groups.map((group) => (
          <FeeClickableCard
            key={group.group_key}
            onClick={isAdmin ? () => openActionWorkspace(group) : undefined}
            className="rounded-md border border-gray-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-base font-semibold text-gray-900">
                  <SelectableFeeValue value={group.student_name} />
                </h2>
                {group.student_status === "archived" ? <StudentStoppedBadge /> : null}
                <MobileFeeDateSummary
                  activeTab={activeTab}
                  group={group}
                  showPeriod={showPeriod}
                  unpaidStage={unpaidStage}
                />
                <div className="mt-2 text-sm text-gray-700">
                  <FeeClassDetails group={group} />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="inline-flex whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-1 text-sm font-medium text-gray-900">
                  <SelectableFeeValue
                    inline
                    value={formatCurrency(
                      activeTab === "paid"
                        ? group.net_collected_amount
                        : group.total_amount,
                    )}
                  />
                </span>
                {activeTab === "paid" && group.refunded_amount > 0 ? (
                  <p className="mt-1 select-none text-xs font-medium text-amber-700">
                    Đã hoàn {formatCurrency(group.refunded_amount)}
                  </p>
                ) : null}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-[15px]">
              <div>
                <dt className="table-heading-text select-none text-gray-500">
                  Thông tin học viên
                </dt>
                <dd className="mt-1 text-gray-900">
                  <FeeContactDetails
                    zalo={group.student_zalo}
                    phone={group.student_phone}
                    isHidden={group.student_contact_hidden}
                  />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="table-heading-text select-none text-gray-500">
                  Thông tin phụ huynh
                </dt>
                <dd className="mt-1 text-gray-900">
                  <FeeContactDetails
                    zalo={group.parent_zalo}
                    phone={group.parent_phone}
                    isHidden={group.parent_contact_hidden}
                  />
                </dd>
              </div>
            </dl>
          </FeeClickableCard>
        ))}
      </div>

      <div
        role="table"
        aria-label="Danh sách học phí"
        className={cn(
          "hidden overflow-hidden bg-white xl:flex xl:h-full xl:min-h-0 xl:flex-col",
          embedded
            ? "xl:rounded-b-xl xl:rounded-t-none xl:border xl:border-t-0 xl:border-gray-200"
            : "rounded-lg border border-gray-200",
        )}
      >
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-100">
          <div
            role="row"
            className={`${gridClass} table-heading-text select-none text-left text-gray-800`}
          >
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">
              Học viên
            </div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">
              Lớp
            </div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">
              Thông tin học viên
            </div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">
              Thông tin phụ huynh
            </div>
            <div
              role="columnheader"
              className="whitespace-nowrap px-2.5 py-3"
            >
              {showPeriod
                ? "Kỳ thu"
                : activeTab === "unpaid" && unpaidStage === "unnotified"
                ? "Ngày bắt đầu"
                : activeTab === "unpaid" && unpaidStage === "notified"
                  ? "Ngày đến hạn"
                  : "Ngày đã báo"}
            </div>
            <div
              role="columnheader"
              className="whitespace-nowrap px-2.5 py-3"
            >
              {showPeriod
                ? "Ngày đến hạn"
                : activeTab === "unpaid" && unpaidStage === "unnotified"
                ? "Ngày đến hạn"
                : activeTab === "unpaid" && unpaidStage === "notified"
                  ? "Ngày đã báo"
                  : "Ngày nộp"}
            </div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">
              {activeTab === "paid" ? "Thanh toán" : "Tổng tiền"}
            </div>
          </div>
        </div>

        <div
          role="rowgroup"
          tabIndex={0}
          className="scrollbar-hidden min-h-0 flex-1 touch-pan-y divide-y divide-gray-200 overflow-x-hidden overflow-y-auto overscroll-contain bg-white text-[15px] font-medium leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-200"
        >
          {groups.map((group) => (
            <FeeClickableRow
              key={group.group_key}
              gridClass={gridClass}
              onClick={isAdmin ? () => openActionWorkspace(group) : undefined}
            >
              <div
                role="cell"
                className="min-w-0 break-words px-2.5 py-3 text-gray-900"
              >
                <SelectableFeeValue value={group.student_name} />
                {group.student_status === "archived" ? <StudentStoppedBadge /> : null}
              </div>
              <div
                role="cell"
                className="min-w-0 break-words px-2.5 py-3 text-gray-700"
              >
                <FeeClassDetails group={group} />
              </div>
              <div
                role="cell"
                className="min-w-0 break-words px-2.5 py-3 text-gray-700"
              >
                <FeeContactDetails
                  zalo={group.student_zalo}
                  phone={group.student_phone}
                  isHidden={group.student_contact_hidden}
                />
              </div>
              <div
                role="cell"
                className="min-w-0 px-2.5 py-3 text-gray-700"
              >
                <FeeContactDetails
                  zalo={group.parent_zalo}
                  phone={group.parent_phone}
                  isHidden={group.parent_contact_hidden}
                />
              </div>
              <div
                role="cell"
                className="min-w-0 break-words px-2.5 py-3 tabular-nums text-gray-700"
              >
                {showPeriod ? (
                  <FeeGroupPeriodStatus group={group} />
                ) : (
                  <SelectableFeeValue
                    value={
                      activeTab === "unpaid" && unpaidStage === "unnotified"
                        ? formatGroupDateList(group.enrollment_dates)
                        : activeTab === "unpaid" && unpaidStage === "notified"
                          ? formatGroupDateList(group.due_dates)
                          : formatDate(group.notified_at)
                    }
                  />
                )}
              </div>
              <div
                role="cell"
                className="min-w-0 break-words px-2.5 py-3 tabular-nums text-gray-700"
              >
                <SelectableFeeValue
                  value={
                    showPeriod
                      ? formatGroupDateList(group.due_dates)
                      : activeTab === "unpaid" && unpaidStage === "unnotified"
                      ? formatGroupDateList(group.due_dates)
                      : activeTab === "unpaid" && unpaidStage === "notified"
                        ? formatDate(group.notified_at)
                        : formatDate(group.paid_date)
                  }
                />
              </div>
              <div
                role="cell"
                className="min-w-0 whitespace-nowrap px-2.5 py-3 tabular-nums text-gray-900"
              >
                <FeePaymentAmount activeTab={activeTab} group={group} />
              </div>
            </FeeClickableRow>
          ))}
        </div>
      </div>
      {isAdmin ? (
        <FeeActionWorkspace
          group={actionGroup}
          activeTab={activeTab}
          unpaidStage={unpaidStage}
          disabled={isBusy}
          isMessageUnavailable={isMessageUnavailable}
          canCreatePaymentRequest={canCreatePaymentRequest}
          pendingAction={
            actionGroup && pendingGroupKey === actionGroup.group_key
              ? pendingAction
              : null
          }
          onClose={() => {
            setActionGroup(null);
            onCloseRefund();
          }}
        getCopyMessage={getCopyMessage}
        loadCopyMessage={loadCopyMessage}
          refundPanel={refundPanel}
          onCopy={onCopy}
          onSaveCopy={onSaveCopy}
          isSavingCopy={isSavingCopy}
          onNotify={onNotify}
          onCreatePaymentRequest={onCreatePaymentRequest}
          onPay={onPay}
          onRefund={onRefund}
          onUnpay={onUnpay}
          onUnnotify={onUnnotify}
        />
      ) : null}
    </div>
  );
}

function FeeClickableRow({
  children,
  gridClass,
  onClick,
}: {
  children: React.ReactNode;
  gridClass: string;
  onClick?: () => void;
}) {
  const rowProps = useClickableRowProps(onClick);

  return (
    <div
      role="row"
      tabIndex={onClick ? 0 : undefined}
      {...rowProps}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        gridClass,
        "cv-auto items-start transition-colors hover:bg-gray-100/60",
        onClick &&
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
      )}
    >
      {children}
    </div>
  );
}

function StudentStoppedBadge() {
  return (
    <span className="mt-1 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[12px] font-medium text-gray-600">
      Ngừng học
    </span>
  );
}

function FeeClickableCard({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const cardProps = useClickableRowProps(onClick);

  return (
    <article
      tabIndex={onClick ? 0 : undefined}
      {...cardProps}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        className,
        onClick &&
          "cursor-pointer transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
      )}
    >
      {children}
    </article>
  );
}

function FeePaymentAmount({
  activeTab,
  group,
}: Pick<FeesTableProps, "activeTab"> & { group: StudentFeeGroup }) {
  if (activeTab !== "paid") {
    return (
      <span className="metric-money">
        <SelectableFeeValue value={formatCurrency(group.total_amount)} />
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <span className="metric-money">
        <SelectableFeeValue value={formatCurrency(group.net_collected_amount)} />
      </span>
      {group.refunded_amount > 0 ? (
        <p
          className={`select-none text-[12px] font-medium leading-4 ${
            group.refundable_amount === 0 ? "text-amber-700" : "text-gray-500"
          }`}
        >
          {group.refundable_amount === 0 ? "Đã hoàn toàn bộ" : "Đã hoàn"}{" "}
          <SelectableFeeValue
            inline
            value={formatCurrency(group.refunded_amount)}
          />
        </p>
      ) : null}
    </div>
  );
}

function FeeClassDetails({ group }: { group: StudentFeeGroup }) {
  const classRecords = Array.from(
    new Map(
      group.records.map((record) => [record.class_id, record] as const),
    ).values(),
  );

  if (classRecords.length === 0) {
    return (
      <div className="space-y-1.5">
        {group.classes.map((class_) => (
          <SelectableFeeValue key={class_.id} value={class_.name} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {classRecords.map((record) => (
        <div key={record.class_id} className="min-w-0">
          <div className="break-words text-gray-800">
            <SelectableFeeValue value={record.class_name} />
          </div>
          <div className="mt-0.5 break-words text-[13px] font-normal leading-4 text-gray-500">
            <SelectableFeeValue
              value={formatFeeBillingLabel(
                record.class_type,
                record.billing_cycle_months,
                record.billing_cycle_weeks,
              )}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeeActionWorkspace({
  group,
  onClose,
  ...actionProps
}: Omit<FeeActionsProps, "group"> & {
  group: StudentFeeGroup | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<FeeWorkspaceMode>("overview");
  const [copyDraft, setCopyDraft] = useState("");
  const [copyBase, setCopyBase] = useState("");
  const [isCopyLoading, setIsCopyLoading] = useState(false);
  const { backdropPointerDownRef, dialogRef, requestClose } = useModalDialog({
    isBusy: actionProps.disabled,
    onClose,
  });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setMode("overview");
    setCopyDraft("");
    setCopyBase("");
  }, [group?.student_id]);

  if (!mounted || !group) return null;

  const isUnpaid = actionProps.activeTab === "unpaid";
  const isUnnotified = isUnpaid && actionProps.unpaidStage === "unnotified";
  const isNotified = isUnpaid && actionProps.unpaidStage === "notified";
  const canNotify =
    isUnnotified &&
    group.records.some(
      (record) => record.notification_state === "UNNOTIFIED",
    );
  const canPay =
    isUnpaid &&
    group.records.length > 0 &&
    group.records.every(
      (record) =>
        record.status === "UNPAID" &&
        (record.notification_state === "UNNOTIFIED" ||
          record.notification_state === "NOTIFIED_UNPAID"),
    );
  const isUnpayDisabled = actionProps.disabled || group.refunded_amount > 0;

  const items: FeeWorkspaceItem[] = [
    {
      mode: "overview",
      label: "Xem khoản thu",
      title: "Thông tin khoản thu",
      description: "Kiểm tra học viên, lớp và số tiền trước khi thao tác.",
      icon: <FileList className="h-[18px] w-[18px]" aria-hidden="true" />,
    },
    {
      mode: "copy",
      label: actionProps.activeTab === "paid" ? "Tin nhắn Zalo" : "Sao chép tin nhắn",
      title: actionProps.activeTab === "paid" ? "Tin nhắn Zalo đã nộp" : "Sao chép thông báo học phí",
      description:
        actionProps.activeTab === "paid"
          ? "Chỉnh sửa nội dung xác nhận rồi lưu hoặc sao chép để gửi cho phụ huynh qua Zalo."
          : "Sao chép nội dung học phí để gửi cho phụ huynh qua Zalo.",
      icon: <MessageSquareText className="h-[18px] w-[18px]" aria-hidden="true" />,
      disabled: actionProps.disabled || actionProps.isMessageUnavailable,
      disabledReason: "Mẫu tin nhắn hiện chưa sẵn sàng.",
      confirmLabel: "Sao chép",
    },
  ];

  if (isUnnotified) {
    items.push({
      mode: "notify",
      label: "Đánh dấu đã báo",
      title: "Đánh dấu đã báo phụ huynh",
      description: "Ghi nhận rằng thông báo học phí đã được gửi cho phụ huynh.",
      icon:
        actionProps.pendingAction === "notify" ? (
          <LoaderCircle className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <NotifiedBellIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        ),
      disabled:
        actionProps.disabled || actionProps.isMessageUnavailable || !canNotify,
      disabledReason: "Khoản thu này không thể chuyển sang trạng thái đã báo.",
      confirmLabel: "Đánh dấu đã báo",
      execute: () => actionProps.onNotify(group),
    });
  }

  if (isUnpaid) {
    items.push({
      mode: "qr",
      label: "Tạo QR",
      title: "Tạo QR thanh toán",
      description: "Tạo yêu cầu thanh toán với nội dung chuyển khoản riêng để gửi cho phụ huynh.",
      icon: <QrCode className="h-[18px] w-[18px]" aria-hidden="true" />,
      disabled:
        actionProps.disabled || !canPay || !actionProps.canCreatePaymentRequest,
      disabledReason: actionProps.canCreatePaymentRequest
        ? "Khoản thu này chưa đủ điều kiện tạo QR."
        : "Hãy thêm tài khoản nhận tiền ở trang Ngân hàng trước.",
      confirmLabel: "Tạo QR",
      execute: () => actionProps.onCreatePaymentRequest(group),
    });
    items.push({
      mode: "pay",
      label: "Ghi nhận đã nộp",
      title: "Ghi nhận học phí đã nộp",
      description: "Xác nhận số tiền đã nhận và chọn tài khoản ngân hàng nhận tiền.",
      icon:
        actionProps.pendingAction === "pay" ? (
          <LoaderCircle className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <Check className="h-[18px] w-[18px]" aria-hidden="true" />
        ),
      disabled: actionProps.disabled || !canPay,
      disabledReason: "Khoản thu này không thể ghi nhận đã nộp.",
      confirmLabel: "Tiếp tục",
      execute: () => actionProps.onPay(group),
    });
  }

  if (isNotified) {
    items.push({
      mode: "unnotify",
      label: "Chuyển về chưa báo",
      title: "Chuyển về trạng thái chưa báo",
      description: "Dùng khi trạng thái đã báo được ghi nhận nhầm.",
      icon: <RotateCcw className="h-[18px] w-[18px]" aria-hidden="true" />,
      disabled: actionProps.disabled,
      confirmLabel: "Chuyển về chưa báo",
      execute: () => actionProps.onUnnotify(group),
    });
  }

  if (actionProps.activeTab === "paid") {
    items.push({
      mode: "refund",
      label: group.refundable_amount > 0 ? "Hoàn phí" : "Xem hoàn phí",
      title: group.refundable_amount > 0 ? "Hoàn phí" : "Lịch sử hoàn phí",
      description:
        group.refundable_amount > 0
          ? "Ghi nhận khoản tiền hoàn lại cho phụ huynh."
          : "Xem các khoản hoàn phí đã được ghi nhận.",
      icon:
        actionProps.pendingAction === "refund" ? (
          <LoaderCircle className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <RefundIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        ),
      disabled:
        actionProps.disabled ||
        (group.refundable_amount <= 0 && group.refunded_amount <= 0),
      disabledReason: "Khoản thu này chưa có giao dịch hoàn phí.",
    });
    items.push({
      mode: "unpay",
      label: "Hoàn tác đã nộp",
      title: "Hoàn tác ghi nhận đã nộp",
      description: "Dùng khi khoản học phí được ghi nhận đã nộp nhầm.",
      icon:
        actionProps.pendingAction === "unpay" ? (
          <LoaderCircle className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="h-[18px] w-[18px]" aria-hidden="true" />
        ),
      danger: true,
      disabled: isUnpayDisabled,
      disabledReason:
        group.refunded_amount > 0
          ? "Không thể hoàn tác vì khoản thu đã phát sinh hoàn phí."
          : "Thao tác hiện chưa sẵn sàng.",
      confirmLabel: "Hoàn tác đã nộp",
      execute: () => actionProps.onUnpay(group),
    });
  }

  const activeItem = items.find((item) => item.mode === mode) ?? items[0];
  let copyPreview: string | null = null;
  try {
    copyPreview = actionProps.getCopyMessage(group);
  } catch {
    copyPreview = null;
  }
  const headerSubtitle = `${group.student_name} · ${formatCurrency(
    actionProps.activeTab === "paid"
      ? group.net_collected_amount
      : group.total_amount,
  )}`;

  const selectMode = (nextMode: FeeWorkspaceMode) => {
    const nextItem = items.find((item) => item.mode === nextMode);
    if (!nextItem?.disabled) {
      if (nextMode === "copy") {
        setCopyDraft(copyPreview ?? "");
        setCopyBase(copyPreview ?? "");
        if (actionProps.loadCopyMessage) {
          setIsCopyLoading(true);
          void actionProps.loadCopyMessage(group)
            .then((message) => {
              setCopyDraft(message);
              setCopyBase(message);
            })
            .catch(() => undefined)
            .finally(() => setIsCopyLoading(false));
        }
      }
      if (nextMode === "refund") {
        actionProps.onRefund(group);
      }
      setMode(nextMode);
    }
  };

  const executeActiveItem = async () => {
    if (activeItem.disabled) return;
    if (mode === "copy") {
      if (!copyDraft.trim()) return;
      let canonicalMessage = copyDraft;
      if (copyDraft !== copyBase) {
        try {
          const savedMessage = await actionProps.onSaveCopy(group, copyDraft);
          canonicalMessage = savedMessage || copyDraft;
          setCopyDraft(canonicalMessage);
          setCopyBase(canonicalMessage);
        } catch {
          return;
        }
      }
      actionProps.onCopy(group, canonicalMessage);
    } else {
      if (!activeItem.execute) return;
      activeItem.execute();
    }
    onClose();
  };

  const saveCopyDraft = () => {
    if (mode !== "copy" || !copyDraft.trim() || actionProps.isSavingCopy) return;
    void Promise.resolve(actionProps.onSaveCopy(group, copyDraft)).then((message) => {
      if (message) {
        setCopyDraft(message);
        setCopyBase(message);
      }
    });
  };

  const rail = (
    <FeeWorkspaceRail
      items={items}
      mode={mode}
      onSelect={selectMode}
    />
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      onPointerDown={(event) => {
        backdropPointerDownRef.current =
          event.target === event.currentTarget ||
          (event.target instanceof HTMLElement &&
            event.target.dataset.workspaceDismissSurface === "true");
      }}
      onPointerUp={(event) => {
        const endedOutside =
          event.target === event.currentTarget ||
          (event.target instanceof HTMLElement &&
            event.target.dataset.workspaceDismissSurface === "true");
        if (backdropPointerDownRef.current && endedOutside) {
          requestClose();
        }
        backdropPointerDownRef.current = false;
      }}
      onPointerCancel={() => {
        backdropPointerDownRef.current = false;
      }}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/35" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fee-workspace-title"
        aria-busy={actionProps.disabled || undefined}
        tabIndex={-1}
        data-workspace-dismiss-surface="true"
        className="relative z-10 flex h-full min-h-0 w-full items-stretch justify-center sm:items-center sm:p-4"
      >
        <div className="relative h-full min-h-0 w-full sm:h-[min(680px,calc(100dvh-2rem))] sm:max-w-[640px]">
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl outline-none sm:rounded-xl sm:border sm:border-gray-200">
            <FormDialogHeader
              title={activeItem.title}
              subtitle={headerSubtitle}
              titleId="fee-workspace-title"
              onClose={requestClose}
              closeDisabled={actionProps.disabled}
            />
            <FeeMobileWorkspaceRail
              items={items}
              mode={mode}
              onSelect={selectMode}
            />
            <div
              id="fee-workspace-panel"
              role="tabpanel"
              aria-label={activeItem.title}
              className="relative min-h-0 flex-1"
            >
              <div className="workspace-panel-in absolute inset-0 flex min-h-0 flex-col">
                {mode === "overview" ? (
                  <FeeOverviewPanel
                    activeTab={actionProps.activeTab}
                    group={group}
                    onClose={requestClose}
                  />
                ) : mode === "refund" ? (
                  actionProps.refundPanel(onClose) ?? (
                    <div className="flex flex-1 items-center justify-center text-sm font-medium text-gray-500">
                      <LoadingLabel label="Đang chuẩn bị thông tin hoàn phí" />
                    </div>
                  )
                ) : (
                  <FeeCommandPanel
                    item={activeItem}
                    activeTab={actionProps.activeTab}
                    group={group}
                    previewText={copyDraft}
                    onChangePreviewText={setCopyDraft}
                    onSave={saveCopyDraft}
                    isSaving={actionProps.isSavingCopy || isCopyLoading}
                    onConfirm={executeActiveItem}
                  />
                )}
              </div>
            </div>
          </div>
          <div className="workspace-action-rail-in absolute left-full top-0 z-20 ml-3 hidden min-[900px]:block">
            {rail}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type FeeWorkspaceItem = {
  mode: FeeWorkspaceMode;
  label: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  confirmLabel?: string;
  execute?: () => void;
};

function FeeWorkspaceRail({
  items,
  mode,
  onSelect,
}: {
  items: FeeWorkspaceItem[];
  mode: FeeWorkspaceMode;
  onSelect: (mode: FeeWorkspaceMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Thao tác khoản thu"
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="tab"]:not([aria-disabled="true"])',
          ),
        );
        const currentIndex = buttons.findIndex(
          (button) => button === document.activeElement,
        );
        if (currentIndex === -1) return;
        const direction = event.key === "ArrowUp" ? -1 : 1;
        buttons[(currentIndex + direction + buttons.length) % buttons.length]?.focus();
      }}
      className="flex w-[184px] shrink-0 flex-col gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-xl shadow-gray-900/15"
    >
      {items.map((item) => (
        <FeeRailTabButton
          key={item.mode}
          item={item}
          active={mode === item.mode}
          onSelect={() => onSelect(item.mode)}
        />
      ))}
    </div>
  );
}

function FeeMobileWorkspaceRail({
  items,
  mode,
  onSelect,
}: {
  items: FeeWorkspaceItem[];
  mode: FeeWorkspaceMode;
  onSelect: (mode: FeeWorkspaceMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Thao tác khoản thu"
      className="scrollbar-hidden flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-gray-200 bg-gray-100/60 px-3 py-1.5 min-[900px]:hidden"
    >
      {items.map((item) => (
        <FeeMobileRailTabButton
          key={item.mode}
          item={item}
          active={mode === item.mode}
          onSelect={() => onSelect(item.mode)}
        />
      ))}
    </div>
  );
}

function FeeRailTabButton({
  item,
  active,
  onSelect,
}: {
  item: FeeWorkspaceItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-disabled={item.disabled || undefined}
      aria-controls="fee-workspace-panel"
      title={item.disabled ? item.disabledReason : item.label}
      aria-label={item.label}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "font-ui relative flex h-11 min-h-11 w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] font-semibold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        active
          ? "bg-primary-soft text-primary"
          : "text-gray-600 hover:bg-primary-soft/70 hover:text-primary",
        item.disabled && "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-gray-600",
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-2 left-0.5 w-0.5 rounded-full",
            "bg-primary",
          )}
        />
      ) : null}
      {item.icon}
      <span className="min-w-0 flex-1 whitespace-nowrap">{item.label}</span>
    </button>
  );
}

function FeeMobileRailTabButton({
  item,
  active,
  onSelect,
}: {
  item: FeeWorkspaceItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-disabled={item.disabled || undefined}
      aria-controls="fee-workspace-panel"
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "font-ui relative inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        active
          ? "bg-primary text-primary-foreground"
          : "text-gray-600 hover:bg-primary-soft/70 hover:text-primary",
        item.disabled && "cursor-not-allowed opacity-45",
      )}
    >
      {item.icon}
      {item.label}
    </button>
  );
}

function FeeOverviewPanel({
  activeTab,
  group,
  onClose,
}: {
  activeTab: FeeTab;
  group: StudentFeeGroup;
  onClose: () => void;
}) {
  return (
    <>
      <FormDialogBody>
        <section className="rounded-lg border border-gray-200 bg-gray-50/60 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-ui text-base font-semibold text-gray-900">Lớp học</p>
              <div className="mt-2 text-base leading-6 text-gray-700">
                <FeeClassDetails group={group} />
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="table-heading-text text-sm text-gray-500">
                {activeTab === "paid" ? "Đã thu" : "Cần thu"}
              </p>
              <p className="metric-money mt-1 text-2xl font-semibold leading-8 text-gray-950">
                {formatCurrency(
                  activeTab === "paid"
                    ? group.net_collected_amount
                    : group.total_amount,
                )}
              </p>
              {group.refunded_amount > 0 ? (
                <p className="mt-1 text-xs font-medium text-amber-700">
                  Đã hoàn {formatCurrency(group.refunded_amount)}
                </p>
              ) : null}
            </div>
          </div>
        </section>
        <section className="grid grid-cols-1 gap-5 rounded-lg border border-gray-200 p-5 text-base sm:grid-cols-2">
          <div>
            <p className="table-heading-text text-sm text-gray-500">Học viên</p>
            <div className="mt-2 leading-6 text-gray-800">
              <FeeContactDetails
                zalo={group.student_zalo}
                phone={group.student_phone}
                isHidden={group.student_contact_hidden}
              />
            </div>
          </div>
          <div>
            <p className="table-heading-text text-sm text-gray-500">Phụ huynh</p>
            <div className="mt-2 leading-6 text-gray-800">
              <FeeContactDetails
                zalo={group.parent_zalo}
                phone={group.parent_phone}
                isHidden={group.parent_contact_hidden}
              />
            </div>
          </div>
        </section>
        <section className="grid grid-cols-2 gap-5 rounded-lg border border-gray-200 p-5 text-base">
          <div>
            <p className="table-heading-text text-sm text-gray-500">Ngày đến hạn</p>
            <p className="mt-2 text-base font-medium leading-6 tabular-nums text-gray-900">
              {formatGroupDateList(group.due_dates)}
            </p>
          </div>
          <div>
            <p className="table-heading-text text-sm text-gray-500">
              {activeTab === "paid" ? "Ngày nộp" : "Ngày đã báo"}
            </p>
            <p className="mt-2 text-base font-medium leading-6 tabular-nums text-gray-900">
              {formatDate(activeTab === "paid" ? group.paid_date : group.notified_at)}
            </p>
          </div>
        </section>
      </FormDialogBody>
      <FormDialogFooter
        left={
          <p className="text-sm font-medium text-gray-500">
            Chọn thao tác ở khung bên phải.
          </p>
        }
        right={
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Đóng
          </Button>
        }
      />
    </>
  );
}

function FeeCommandPanel({
  item,
  activeTab,
  group,
  previewText,
  onChangePreviewText,
  onSave,
  isSaving,
  onConfirm,
}: {
  item: FeeWorkspaceItem;
  activeTab: FeeTab;
  group: StudentFeeGroup;
  previewText: string | null;
  onChangePreviewText: (value: string) => void;
  onSave: () => void;
  isSaving: boolean;
  onConfirm: () => void;
}) {
  return (
    <>
      <FormDialogBody className="flex flex-col justify-between gap-4 sm:py-5">
        <div className="space-y-4">
          {item.mode === "copy" ? (
            <section className="rounded-lg border border-gray-200 bg-gray-50/60 p-4 sm:p-5">
              <p className="font-ui text-sm font-semibold text-gray-950">
                Nội dung Zalo dành cho {group.student_name}
              </p>
              <p className="helper-text mt-1 text-gray-500">
                Enter để xuống dòng · Backspace ở đầu dòng để nối.
              </p>
              {previewText !== null ? (
                <FeeLineNumberedTextarea
                  ariaLabel={`Nội dung Zalo dành cho ${group.student_name}`}
                  value={previewText}
                  onChange={onChangePreviewText}
                />
              ) : (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                  Chưa thể tạo nội dung Zalo. Hãy tải lại mẫu tin nhắn rồi thử lại.
                </p>
              )}
            </section>
          ) : (
          <>
          <section className="rounded-lg border border-gray-200 bg-gray-50/60 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"
              >
                {item.icon}
              </span>
              <div className="min-w-0">
                <h3 className="font-ui text-base font-semibold text-gray-950">
                  {item.title}
                </h3>
                <p className="mt-1 text-sm font-medium leading-6 text-gray-600">
                  {item.description}
                </p>
              </div>
            </div>
          </section>
          <section className="rounded-lg border border-gray-200 p-4 sm:p-5">
            <p className="table-heading-text text-gray-500">Áp dụng cho</p>
            <div className="mt-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-gray-950">{group.student_name}</p>
                <div className="mt-1 text-sm text-gray-600">
                  <FeeClassDetails group={group} />
                </div>
              </div>
              <p className="metric-money shrink-0 text-base text-gray-950">
                {formatCurrency(
                  activeTab === "paid"
                    ? group.net_collected_amount
                    : group.total_amount,
                )}
              </p>
            </div>
          </section>
          </>
          )}
          {item.disabled ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium leading-5 text-amber-800">
              {item.disabledReason}
            </p>
          ) : null}
        </div>
      </FormDialogBody>
      <FormDialogFooter
        right={
          <div className="flex items-center gap-2">
            {item.mode === "copy" ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={item.disabled || isSaving || !previewText?.trim()}
                onClick={onSave}
              >
                {isSaving ? <LoadingLabel label="Đang lưu" /> : "Lưu"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={item.danger ? "destructive" : "default"}
              size="lg"
              disabled={
                item.disabled ||
                isSaving ||
                (item.mode === "copy" && !previewText?.trim())
              }
              onClick={onConfirm}
              className={item.danger ? "bg-red-600 text-white hover:bg-red-700" : undefined}
            >
              {item.confirmLabel}
            </Button>
          </div>
        }
      />
    </>
  );
}

function FeeLineNumberedTextarea({
  ariaLabel,
  value,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FeeMessageCodeEditor
      id="fee-group-zalo-message"
      ariaLabel={ariaLabel}
      ariaInvalid={false}
      disabled={false}
      value={value}
      onChange={onChange}
    />
  );
}

function FeeContactDetails({
  zalo,
  phone,
  isHidden,
}: {
  zalo: string | null;
  phone: string | null;
  isHidden: boolean;
}) {
  if (isHidden) {
    return (
      <span className="inline-flex select-none items-center gap-1 text-[13px] font-medium text-gray-400">
        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
        Đã ẩn
      </span>
    );
  }

  if (!zalo || !phone) {
    return <EmptyFeeValue />;
  }

  return (
    <div className="space-y-1">
      <p className="text-selection-scope break-words" data-text-selection-scope="true">
        <span className="select-none font-normal text-gray-500">Zalo:</span>{" "}
        <span className="text-selection-value" data-text-selection-value="true">
          {zalo}
        </span>
      </p>
      <p className="text-selection-scope break-all" data-text-selection-scope="true">
        <span className="select-none font-normal text-gray-500">SĐT:</span>{" "}
        <span className="text-selection-value" data-text-selection-value="true">
          {phone}
        </span>
      </p>
    </div>
  );
}

function SelectableFeeValue({
  inline = false,
  value,
}: {
  inline?: boolean;
  value: string;
}) {
  if (!value || value === "—") {
    return <EmptyFeeValue />;
  }

  return (
    <span
      className={`text-selection-scope${inline ? " text-selection-scope--inline" : ""}`}
      data-text-selection-scope="true"
    >
      <span className="text-selection-value" data-text-selection-value="true">
        {value}
      </span>
    </span>
  );
}

function MobileFeeDateSummary({
  activeTab,
  group,
  showPeriod = false,
  unpaidStage,
}: Pick<FeesTableProps, "activeTab" | "unpaidStage"> & {
  group: StudentFeeGroup;
  showPeriod?: boolean;
}) {
  if (showPeriod) {
    const period = group.records[0]?.period;
    return (
      <p className="mt-1 select-none text-sm text-gray-600">
        <span className="font-semibold text-rose-700">
          {getOutstandingDueLabel(group)}
        </span>
        {" · Kỳ "}
        <SelectableFeeValue inline value={formatFeePeriodLabel(period)} />
        {" · Hạn "}
        <SelectableFeeValue inline value={formatGroupDateList(group.due_dates)} />
      </p>
    );
  }

  if (activeTab === "unpaid" && unpaidStage === "unnotified") {
    return (
      <p className="mt-1 select-none text-sm text-gray-600">
        Bắt đầu{" "}
        <SelectableFeeValue inline value={formatGroupDateList(group.enrollment_dates)} />
        {" · Hạn "}
        <SelectableFeeValue inline value={formatGroupDateList(group.due_dates)} />
      </p>
    );
  }

  if (activeTab === "unpaid" && unpaidStage === "notified") {
    return (
      <p className="mt-1 select-none text-sm text-gray-600">
        Hạn <SelectableFeeValue inline value={formatGroupDateList(group.due_dates)} />
        {" · Đã báo "}
        <SelectableFeeValue inline value={formatDate(group.notified_at)} />
      </p>
    );
  }

  return (
    <p className="mt-1 select-none text-sm text-gray-600">
      Đã báo{" "}
      <SelectableFeeValue inline value={formatDate(group.notified_at)} />
      {" · Nộp "}
      <SelectableFeeValue inline value={formatDate(group.paid_date)} />
    </p>
  );
}

function FeeGroupPeriodStatus({ group }: { group: StudentFeeGroup }) {
  const period = group.records[0]?.period;
  const dueLabel = getOutstandingDueLabel(group);
  const isOverdue = dueLabel === "Quá hạn";

  return (
    <div className="space-y-1">
      <SelectableFeeValue value={formatFeePeriodLabel(period)} />
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
          isOverdue
            ? "bg-rose-50 text-rose-700"
            : "bg-amber-50 text-amber-800"
        }`}
      >
        {dueLabel}
      </span>
    </div>
  );
}

function EmptyFeeValue() {
  return (
    <span
      aria-label="Chưa có thông tin"
      className="select-none font-normal text-gray-400"
    >
      —
    </span>
  );
}

function formatGroupDateList(values: string[]) {
  if (values.length === 0) {
    return "—";
  }

  return values.map((value) => formatDate(value)).join(", ");
}

function formatFeePeriodLabel(period: string | undefined) {
  if (!period || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) {
    return "—";
  }
  const [year, month] = period.split("-");
  return `${Number(month)}/${year}`;
}

function getOutstandingDueLabel(group: StudentFeeGroup) {
  const dueDate = group.due_dates[0];
  return dueDate && dueDate < getBusinessDateKey()
    ? "Quá hạn"
    : "Đến hạn hôm nay";
}

function getBusinessDateKey() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "9999-12-31";
}
