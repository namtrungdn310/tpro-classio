"use client";

import { useRef } from "react";
import {
  Bell,
  Check,
  Clipboard,
  EyeOff,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { RefundIcon } from "@/components/ui/refund-icon";
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

type FeesTableProps = {
  activeTab: FeeTab;
  unpaidStage: UnpaidStage;
  groups: StudentFeeGroup[];
  isAdmin: boolean;
  isBusy: boolean;
  isMessageUnavailable: boolean;
  pendingAction: FeeMutationAction | null;
  pendingStudentId: string | null;
  onCopy: (group: StudentFeeGroup) => void;
  onNotify: (group: StudentFeeGroup) => void;
  onPay: (group: StudentFeeGroup) => void;
  onRefund: (group: StudentFeeGroup) => void;
  onUnpay: (group: StudentFeeGroup) => void;
  onUnnotify: (group: StudentFeeGroup) => void;
};

type FeeActionsProps = Pick<
  FeesTableProps,
  | "activeTab"
  | "unpaidStage"
  | "onCopy"
  | "onNotify"
  | "onPay"
  | "onRefund"
  | "onUnpay"
  | "onUnnotify"
  | "isMessageUnavailable"
> & {
  disabled: boolean;
  pendingAction: FeeMutationAction | null;
  group: StudentFeeGroup;
};

export function FeesTable({
  activeTab,
  unpaidStage,
  groups,
  isAdmin,
  isBusy,
  isMessageUnavailable,
  pendingAction,
  pendingStudentId,
  onCopy,
  onNotify,
  onPay,
  onRefund,
  onUnpay,
  onUnnotify,
}: FeesTableProps) {
  const selectionContainerRef = useRef<HTMLDivElement>(null);
  useScopedTextSelection(selectionContainerRef);
  const gridClass = getFeesTableGridClass({ isAdmin });

  const renderActions = (group: StudentFeeGroup) => (
    <FeeActions
      activeTab={activeTab}
      unpaidStage={unpaidStage}
      disabled={isBusy}
      isMessageUnavailable={isMessageUnavailable}
      pendingAction={
        pendingStudentId === group.student_id ? pendingAction : null
      }
      group={group}
      onCopy={onCopy}
      onNotify={onNotify}
      onPay={onPay}
      onRefund={onRefund}
      onUnpay={onUnpay}
      onUnnotify={onUnnotify}
    />
  );

  return (
    <div
      ref={selectionContainerRef}
      className="text-selection-container h-full min-h-0"
    >
      <div className="scrollbar-hidden grid gap-3 md:h-full md:overflow-y-auto md:overscroll-contain xl:hidden">
        {groups.map((group) => (
          <article
            key={group.student_id}
            className="rounded-md border border-gray-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-base font-medium text-gray-900">
                  <SelectableFeeValue value={group.student_name} />
                </h2>
                <MobileFeeDateSummary
                  activeTab={activeTab}
                  group={group}
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
            {isAdmin ? <div className="mt-4">{renderActions(group)}</div> : null}
          </article>
        ))}
      </div>

      <div
        role="table"
        aria-label="Danh sách học phí"
        className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white xl:flex xl:h-full xl:min-h-0 xl:flex-col"
      >
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-50">
          <div
            role="row"
            className={`${gridClass} table-heading-text select-none text-left text-gray-700`}
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
              {activeTab === "unpaid" && unpaidStage === "unnotified"
                ? "Ngày bắt đầu"
                : activeTab === "unpaid" && unpaidStage === "notified"
                  ? "Ngày đến hạn"
                  : "Ngày đã báo"}
            </div>
            <div
              role="columnheader"
              className="whitespace-nowrap px-2.5 py-3"
            >
              {activeTab === "unpaid" && unpaidStage === "unnotified"
                ? "Ngày đến hạn"
                : activeTab === "unpaid" && unpaidStage === "notified"
                  ? "Ngày đã báo"
                  : "Ngày nộp"}
            </div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">
              {activeTab === "paid" ? "Thanh toán" : "Tổng tiền"}
            </div>
            {isAdmin ? (
              <div
                role="columnheader"
                className="whitespace-nowrap px-2 py-3 text-center"
              >
                Thao tác
              </div>
            ) : null}
          </div>
        </div>

        <div
          role="rowgroup"
          tabIndex={0}
          className="scrollbar-hidden min-h-0 flex-1 touch-pan-y divide-y divide-gray-100 overflow-x-hidden overflow-y-auto overscroll-contain bg-white text-[15px] font-medium leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-200"
        >
          {groups.map((group) => (
            <div
              role="row"
              key={group.student_id}
              className={`${gridClass} cv-auto items-start hover:bg-gray-50/80`}
            >
              <div
                role="cell"
                className="min-w-0 break-words px-2.5 py-3 text-gray-900"
              >
                <SelectableFeeValue value={group.student_name} />
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
                <SelectableFeeValue
                  value={
                    activeTab === "unpaid" && unpaidStage === "unnotified"
                      ? formatGroupDateList(group.enrollment_dates)
                      : activeTab === "unpaid" && unpaidStage === "notified"
                        ? formatGroupDateList(group.due_dates)
                        : formatDate(group.notified_at)
                  }
                />
              </div>
              <div
                role="cell"
                className="min-w-0 break-words px-2.5 py-3 tabular-nums text-gray-700"
              >
                <SelectableFeeValue
                  value={
                    activeTab === "unpaid" && unpaidStage === "unnotified"
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
              {isAdmin ? (
                <div
                  role="cell"
                  className="flex self-stretch items-center justify-center px-2 py-3"
                >
                  {renderActions(group)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
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
              )}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeeActions({
  activeTab,
  unpaidStage,
  disabled,
  isMessageUnavailable,
  pendingAction,
  group,
  onCopy,
  onNotify,
  onPay,
  onRefund,
  onUnpay,
  onUnnotify,
}: FeeActionsProps) {
  const isUnpaid = activeTab === "unpaid";
  const isUnnotified = isUnpaid && unpaidStage === "unnotified";
  const isNotified = isUnpaid && unpaidStage === "notified";
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

  return (
    <div className="flex items-center justify-center gap-1.5">
      <button
        type="button"
        title={
          activeTab === "paid"
            ? "Sao chép xác nhận đã nộp"
            : "Sao chép thông báo học phí"
        }
        aria-label={
          activeTab === "paid"
            ? "Sao chép xác nhận đã nộp"
            : "Sao chép thông báo học phí"
        }
        disabled={disabled || isMessageUnavailable}
        onClick={() => onCopy(group)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
      >
        <Clipboard className="h-4 w-4" aria-hidden="true" />
      </button>
      {isUnnotified ? (
        <button
          type="button"
          title="Đánh dấu đã báo"
          aria-label="Đánh dấu đã báo phụ huynh"
          disabled={disabled || isMessageUnavailable || !canNotify}
          onClick={() => onNotify(group)}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition disabled:cursor-not-allowed ${
            canNotify
              ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              : "border-sky-100 bg-sky-50 text-sky-700 disabled:opacity-80"
          }`}
        >
          {pendingAction === "notify" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Bell className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
      {isNotified ? (
        <button
          type="button"
          title="Chuyển về chưa báo"
          aria-label="Chuyển khoản học phí về trạng thái chưa báo"
          disabled={disabled}
          onClick={() => onUnnotify(group)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
        >
          {pendingAction === "unnotify" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
      {isUnpaid ? (
        <button
          type="button"
          disabled={disabled || !canPay}
          onClick={() => onPay(group)}
          title={
            canPay
              ? "Ghi nhận đã nộp"
              : "Không thể ghi nhận đã nộp cho khoản học phí này"
          }
          aria-label={
            canPay
              ? "Ghi nhận đã nộp"
              : "Không thể ghi nhận đã nộp cho khoản học phí này"
          }
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-600 bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
        >
          {pendingAction === "pay" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
      {activeTab === "paid" ? (
        <button
          type="button"
          disabled={
            disabled ||
            (group.refundable_amount <= 0 && group.refunded_amount <= 0)
          }
          onClick={() => onRefund(group)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
          title={
            group.refundable_amount > 0
              ? group.refunded_amount > 0
                ? "Xem lịch sử hoặc hoàn thêm học phí"
                : "Hoàn phí cho phụ huynh"
              : "Xem lịch sử hoàn phí"
          }
          aria-label={
            group.refundable_amount > 0
              ? group.refunded_amount > 0
                ? "Xem lịch sử hoặc hoàn thêm học phí"
                : "Hoàn phí cho phụ huynh"
              : "Xem lịch sử hoàn phí"
          }
        >
          {pendingAction === "refund" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefundIcon />
          )}
        </button>
      ) : null}
      {activeTab === "paid" ? (
        <button
          type="button"
          disabled={disabled || group.refunded_amount > 0}
          onClick={() => onUnpay(group)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
          title={
            group.refunded_amount > 0
              ? "Không thể sửa sai thanh toán sau khi đã phát sinh hoàn phí"
              : "Hoàn tác ghi nhận đã nộp"
          }
          aria-label={
            group.refunded_amount > 0
              ? "Không thể hoàn tác ghi nhận vì đã phát sinh hoàn phí"
              : "Hoàn tác ghi nhận đã nộp"
          }
        >
          {pendingAction === "unpay" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
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
  unpaidStage,
}: Pick<FeesTableProps, "activeTab" | "unpaidStage"> & {
  group: StudentFeeGroup;
}) {
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
