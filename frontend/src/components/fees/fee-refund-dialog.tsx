"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  RiCheckboxCircleLine as CheckCircle2,
  RiClipboardLine as Clipboard,
  RiHistoryLine as History,
  RiLoader4Line as LoaderCircle,
} from "react-icons/ri";
import { RefundIcon } from "@/components/ui/refund-icon";
import { Button } from "@/components/ui/button";
import { FormDialogBody, FormDialogFooter, FormDialogShell } from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { FormSection } from "@/components/ui/form-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  formTextControlClassName,
  formTextControlErrorClassName,
} from "@/components/ui/form-text-control";
import { LoadingLabel } from "@/components/ui/loading-label";
import { SmartMoneyInput } from "@/components/ui/smart-money-input";
import {
  buildRefundAllocations,
  getRefundAmountErrors,
  getRefundableFeeRecords,
} from "@/lib/fees/refund";
import {
  clearPendingRefundRequest,
  getOrCreateRefundRequestId,
} from "@/lib/fees/refund-idempotency";
import { useFormFieldFeedback } from "@/lib/forms/use-form-field-feedback";
import { moveFocusByFormArrow } from "@/lib/forms/field-navigation";
import type { StudentFeeGroup } from "@/lib/fees/view-model";
import type {
  BankAccount,
  FeePaymentMethod,
  FeeRefundReceipt,
  FeeRefundRequest,
  FeeRefundReversalRequest,
  FeeTransactionListResponse,
  FeeTransactionResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";

type FeeRefundDialogProps = {
  bankAccounts: BankAccount[];
  group: StudentFeeGroup | null;
  idempotencyScope: string;
  isPending: boolean;
  isReversalPending: boolean;
  hasHistoryError: boolean;
  isHistoryLoading: boolean;
  onClose: () => void;
  onCopyReceipt: () => void;
  onRetryHistory: () => void;
  onReverseRefund: (payload: FeeRefundReversalRequest) => Promise<void>;
  onSubmit: (payload: FeeRefundRequest) => void;
  open: boolean;
  receipt: FeeRefundReceipt | null;
  transactionHistories: FeeTransactionListResponse[];
};

export type FeeRefundPanelProps = Omit<
  FeeRefundDialogProps,
  "group" | "open"
> & {
  group: StudentFeeGroup;
};

const REFUND_METHODS: ReadonlyArray<{
  label: string;
  value: FeePaymentMethod;
}> = [
  { label: "Chuyển khoản", value: "bank_transfer" },
  { label: "Tiền mặt", value: "cash" },
];

const REVERSAL_FEEDBACK_FIELDS = ["reason"] as const;
type RefundFeedbackField = `amount:${string}`;
type RefundAmountDraft = { rawValue: string; isComplete: boolean };

function amountFeedbackField(recordId: string): RefundFeedbackField {
  return `amount:${recordId}`;
}

function normalizeReason(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function FeeRefundDialog(props: FeeRefundDialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !props.open || !props.group) return null;
  return (
    <FeeRefundDialogContent
      key={props.idempotencyScope}
      {...props}
      group={props.group}
    />
  );
}

/**
 * The same complete refund workflow without a second modal shell. It is used
 * inside the fee workspace so the operator does not lose context or move
 * through stacked dialogs.
 */
export function FeeRefundPanel(props: FeeRefundPanelProps) {
  return (
    <FeeRefundDialogContent
      key={props.idempotencyScope}
      {...props}
      embedded
      open
    />
  );
}

function FeeRefundDialogContent({
  bankAccounts,
  group,
  idempotencyScope,
  isPending,
  isReversalPending,
  hasHistoryError,
  isHistoryLoading,
  onClose,
  onCopyReceipt,
  onRetryHistory,
  onReverseRefund,
  onSubmit,
  receipt,
  transactionHistories,
  embedded = false,
}: FeeRefundDialogProps & { group: StudentFeeGroup; embedded?: boolean }) {
  const amountErrorIdPrefix = useId();
  const settlementAccountErrorId = useId();
  const refundableRecords = useMemo(() => getRefundableFeeRecords(group), [group]);
  const feedbackFields = useMemo<readonly RefundFeedbackField[]>(
    () => refundableRecords.map((record) => amountFeedbackField(record.id)),
    [refundableRecords],
  );
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [amountDrafts, setAmountDrafts] = useState<Record<string, RefundAmountDraft>>({});
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] =
    useState<FeePaymentMethod>("bank_transfer");
  const [settlementAccountId, setSettlementAccountId] = useState(
    () => bankAccounts.find((account) => account.is_default)?.id ?? bankAccounts[0]?.id ?? "",
  );
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [reversalTarget, setReversalTarget] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [isReversalSubmitted, setIsReversalSubmitted] = useState(false);
  const {
    markBlur,
    markInput,
    markSubmitted,
    shouldShowError,
  } = useFormFieldFeedback(feedbackFields);
  const {
    markBlur: markReversalBlur,
    markInput: markReversalInput,
    markSubmitted: markReversalSubmitted,
    resetFeedback: resetReversalFeedback,
    shouldShowError: shouldShowReversalError,
  } = useFormFieldFeedback(REVERSAL_FEEDBACK_FIELDS);
  const isBusy = isPending || isReversalPending;
  const requestClose = () => {
    if (!isBusy) {
      onClose();
    }
  };

  useEffect(() => {
    if (receipt) {
      clearPendingRefundRequest(idempotencyScope, receipt.request_id);
    }
  }, [idempotencyScope, receipt]);

  useEffect(() => {
    if (refundMethod !== "bank_transfer") return;
    const selectedAccountIsActive = bankAccounts.some(
      (account) => account.id === settlementAccountId,
    );
    if (!selectedAccountIsActive) {
      setSettlementAccountId(
        bankAccounts.find((account) => account.is_default)?.id ?? bankAccounts[0]?.id ?? "",
      );
    }
  }, [bankAccounts, refundMethod, settlementAccountId]);

  const allocations = buildRefundAllocations(refundableRecords, amounts);
  const totalAmount = allocations.reduce((sum, item) => sum + item.amount, 0);
  const history = buildRefundHistory(group, transactionHistories);
  const amountValidationErrors = useMemo(() => {
    const errors = getRefundAmountErrors(refundableRecords, amounts);
    for (const record of refundableRecords) {
      const draft = amountDrafts[record.id];
      if (draft?.rawValue && !draft.isComplete) {
        errors[record.id] = "Số tiền hoàn chưa đúng định dạng.";
      }
    }
    return errors;
  }, [amountDrafts, amounts, refundableRecords]);
  const normalizedReason = normalizeReason(reason);
  const settlementAccountError =
    refundMethod === "bank_transfer" && !settlementAccountId
      ? "Hãy chọn tài khoản ngân hàng dùng để chuyển khoản hoàn phí."
      : null;
  const normalizedReversalReason = normalizeReason(reversalReason);
  const reversalValidationError =
    normalizedReversalReason.length < 3
      ? "Vui lòng nhập lý do sửa sai có ít nhất 3 ký tự."
      : null;
  const visibleReversalError = shouldShowReversalError(
    "reason",
    isReversalSubmitted,
  )
    ? reversalValidationError
    : null;

  function submitRefund() {
    setIsSubmitted(true);
    markSubmitted();
    if (Object.keys(amountValidationErrors).length > 0) {
      return;
    }
    if (settlementAccountError) {
      return;
    }

    const fingerprint = JSON.stringify({
      allocations,
      normalizedReason,
      refundMethod,
      settlementAccountId:
        refundMethod === "bank_transfer" ? settlementAccountId : null,
    });
    const requestId = getOrCreateRefundRequestId(idempotencyScope, fingerprint);
    onSubmit({
      request_id: requestId,
      items: allocations,
      reason: normalizedReason,
      refund_method: refundMethod,
      settlement_account_id:
        refundMethod === "bank_transfer" ? settlementAccountId : undefined,
    });
  }

  function updateRefundAmount(recordId: string, value: number | null) {
    setAmounts((current) => ({ ...current, [recordId]: value }));
  }

  function updateRefundDraft(
    recordId: string,
    rawValue: string,
    isComplete: boolean,
  ) {
    setAmountDrafts((current) => ({
      ...current,
      [recordId]: { rawValue, isComplete },
    }));
    markInput(amountFeedbackField(recordId), rawValue);
  }

  async function submitReversal(transaction: FeeTransactionResponse) {
    setIsReversalSubmitted(true);
    markReversalSubmitted();
    if (reversalValidationError) {
      return;
    }

    const scope = `${idempotencyScope}:reverse:${transaction.id}`;
    const fingerprint = JSON.stringify({
      refundTransactionId: transaction.id,
      reason: normalizedReversalReason,
    });
    const requestId = getOrCreateRefundRequestId(scope, fingerprint);
    try {
      await onReverseRefund({
        refund_transaction_id: transaction.id,
        reason: normalizedReversalReason,
        request_id: requestId,
      });
      clearPendingRefundRequest(scope, requestId);
      setReversalTarget(null);
      setReversalReason("");
      setIsReversalSubmitted(false);
      resetReversalFeedback();
    } catch {
      // The page-level mutation owns the user-facing API error. Keeping the
      // request ID and reason makes a retry safe after a lost response.
    }
  }

  const content = (
    <>
      {receipt ? (
        <RefundSuccess receipt={receipt} />
      ) : (
        <FormDialogBody>
            <RefundHistorySection
              error={hasHistoryError}
              history={history}
              isBusy={isBusy}
              isLoading={isHistoryLoading}
              reversalError={visibleReversalError}
              reversalReason={reversalReason}
              reversalTarget={reversalTarget}
              onCancelReversal={() => {
                setReversalTarget(null);
                setReversalReason("");
                setIsReversalSubmitted(false);
                resetReversalFeedback();
              }}
              onChangeReversalReason={(value) => {
                setReversalReason(value);
                markReversalInput("reason", value);
              }}
              onBlurReversalReason={() => markReversalBlur("reason")}
              onConfirmReversal={(transaction) => void submitReversal(transaction)}
              onRetry={onRetryHistory}
              onSelectReversal={(transactionId) => {
                setReversalTarget(transactionId);
                setReversalReason("");
                setIsReversalSubmitted(false);
                resetReversalFeedback();
              }}
            />

            {refundableRecords.length === 0 ? (
              <p className="mt-3 rounded-md bg-gray-50 px-3 py-2.5 text-sm font-normal text-gray-600">
                Không còn số tiền có thể hoàn thêm. Bạn vẫn có thể xem hoặc sửa
                một giao dịch hoàn nhập nhầm trong lịch sử phía trên.
              </p>
            ) : (
              <>
                <FormSection label="Chi tiết khoản hoàn" order={1}>
                <div className="space-y-2.5">
                  {refundableRecords.map((record, index) => {
                    const amountField = amountFeedbackField(record.id);
                    const amountError = shouldShowError(amountField, isSubmitted)
                      ? amountValidationErrors[record.id]
                      : undefined;
                    const amountErrorId = `${amountErrorIdPrefix}-${record.id}`;
                    return (
                      <div
                        key={record.id}
                        className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="select-none text-base font-semibold leading-6 text-gray-900">
                              {record.class_name}
                            </p>
                            <p className="mt-1 select-none text-sm font-normal leading-5 text-gray-500">
                              Đã nhận {formatCurrency(record.paid_amount ?? 0)} · Đã hoàn{" "}
                              {formatCurrency(record.refunded_amount)}
                            </p>
                          </div>
                          <p className="select-none text-sm font-semibold leading-5 text-emerald-700">
                            Còn có thể hoàn {formatCurrency(record.refundable_amount)}
                          </p>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <SmartMoneyInput
                            value={amounts[record.id] ?? null}
                            disabled={isBusy}
                            ariaLabel={`Số tiền hoàn cho lớp ${record.class_name}`}
                            ariaDescribedBy={amountError ? amountErrorId : undefined}
                            onChange={(value) => updateRefundAmount(record.id, value)}
                            onBlur={() => markBlur(amountField)}
                            onDraftChange={(rawValue, isComplete) =>
                              updateRefundDraft(record.id, rawValue, isComplete)
                            }
                            placeholder="Số tiền hoàn"
                            ariaInvalid={Boolean(amountError)}
                            dataRow={index}
                            dataCol={0}
                            className={cn(
                              formTextControlClassName,
                              "min-w-0 flex-1 sm:max-w-[248px]",
                              amountError && formTextControlErrorClassName,
                            )}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 shrink-0 px-3 text-sm"
                            disabled={isBusy}
                            onClick={() => {
                              updateRefundAmount(record.id, record.refundable_amount);
                              updateRefundDraft(
                                record.id,
                                String(record.refundable_amount),
                                true,
                              );
                            }}
                          >
                            Hoàn toàn bộ
                          </Button>
                        </div>
                        {amountError ? (
                          <p
                            id={amountErrorId}
                            role="alert"
                            className="mt-1.5 text-sm font-medium text-destructive"
                          >
                            {amountError}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                </FormSection>

                <FormSection label="Thông tin hoàn phí" order={2}>
                <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                  <FormField label="Hình thức hoàn" labelId="refund-method-label">
                    <SegmentedControl
                      ariaLabelledBy="refund-method-label"
                      disabled={isBusy}
                      options={[...REFUND_METHODS]}
                      selected={refundMethod}
                      onSelect={(value) => setRefundMethod(value as FeePaymentMethod)}
                    />
                  </FormField>

                  {refundMethod === "bank_transfer" ? (
                    <FormField
                      controlId="refund-settlement-account"
                      error={isSubmitted ? settlementAccountError ?? undefined : undefined}
                      errorId={settlementAccountErrorId}
                      hint={
                        isSubmitted && settlementAccountError ? undefined : bankAccounts.length === 0 ? (
                          <span className="text-amber-700">
                            Chưa có tài khoản. Hãy thêm tại trang Ngân hàng trước khi hoàn phí.
                          </span>
                        ) : (
                          "Chọn tài khoản thực tế dùng để chuyển tiền hoàn."
                        )
                      }
                      label="Tài khoản dùng để hoàn"
                    >
                      <select
                        id="refund-settlement-account"
                        value={settlementAccountId}
                        disabled={isBusy}
                        aria-invalid={Boolean(isSubmitted && settlementAccountError)}
                        aria-describedby={
                          isSubmitted && settlementAccountError
                            ? settlementAccountErrorId
                            : undefined
                        }
                        onChange={(event) => setSettlementAccountId(event.currentTarget.value)}
                        className={cn(
                          formTextControlClassName,
                          isSubmitted && settlementAccountError && formTextControlErrorClassName,
                        )}
                      >
                        <option value="">Chọn tài khoản ngân hàng</option>
                        {bankAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.bank_name} · {account.label} · ****
                            {account.account_number.slice(-4)}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  ) : null}

                  <label className="block min-w-0 sm:col-span-2">
                    <span className="form-label-text select-none text-gray-800">
                      Lý do hoàn phí
                    </span>
                    <textarea
                      autoComplete={savedInfoAutocomplete.disabled}
                      value={reason}
                      maxLength={500}
                      rows={2}
                      disabled={isBusy}
                      onChange={(event) => {
                        setReason(event.currentTarget.value);
                      }}
                      data-row={refundableRecords.length}
                      data-col={0}
                      className={cn(
                        formTextControlClassName,
                        "mt-1 block h-16 min-h-16 w-full resize-none py-2 leading-5",
                      )}
                    />
                  </label>
                </div>
                </FormSection>
              </>
            )}
          </FormDialogBody>
        )}

        <FormDialogFooter
          right={
            receipt ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 gap-1.5 px-3 text-sm"
                  onClick={onCopyReceipt}
                >
                  <Clipboard className="h-4 w-4" aria-hidden="true" />
                  Tin nhắn Zalo
                </Button>
                <Button type="button" className="h-8 px-3 text-sm" onClick={onClose}>
                  Đóng
                </Button>
              </>
            ) : refundableRecords.length === 0 ? (
              <Button
                type="button"
                className="h-8 px-3 text-sm"
                disabled={isBusy}
                onClick={requestClose}
              >
                Đóng
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-sm"
                  disabled={isBusy}
                  onClick={requestClose}
                >
                  Huỷ
                </Button>
                <Button
                  type="button"
                  className="h-8 bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90"
                  disabled={isBusy}
                  onClick={submitRefund}
                  data-dialog-autofocus
                >
                  {isPending ? (
                    <LoadingLabel label="Đang hoàn phí" />
                  ) : (
                    <>
                      <RefundIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Xác nhận hoàn {formatCurrency(totalAmount)}
                    </>
                  )}
                </Button>
              </>
            )
          }
        />
    </>
  );

  if (embedded) {
    return (
      <div className="contents" onKeyDown={moveFocusByFormArrow}>
        {content}
      </div>
    );
  }

  return (
    <FormDialogShell
      title="Hoàn phí học viên"
      subtitle={`${group.student_name} · Phân bổ chính xác số tiền cần hoàn theo từng lớp.`}
      width="md"
      isBusy={isBusy}
      onClose={requestClose}
      frameProps={{ onKeyDown: moveFocusByFormArrow }}
    >
      {content}
    </FormDialogShell>
  );
}

function RefundSuccess({ receipt }: { receipt: FeeRefundReceipt }) {
  return (
    <div className="flex min-h-56 flex-1 flex-col items-center justify-center px-5 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className="mt-3 text-base font-semibold text-gray-950">Đã ghi nhận hoàn phí</p>
      <p className="metric-money mt-1 text-2xl text-gray-950">
        {formatCurrency(receipt.total_amount)}
      </p>
      <p className="mt-2 select-none text-sm font-normal text-gray-500">
        Ngày {formatDate(receipt.refund_date)} ·{" "}
        {receipt.refund_method === "cash" ? "Tiền mặt" : "Chuyển khoản"}
      </p>
      {receipt.reason ? (
        <p className="mt-1 max-w-md text-sm font-normal text-gray-600">
          {receipt.reason}
        </p>
      ) : null}
    </div>
  );
}

type RefundHistoryItem = {
  className: string;
  reversed: boolean;
  transaction: FeeTransactionResponse;
};

function buildRefundHistory(
  group: StudentFeeGroup,
  histories: FeeTransactionListResponse[],
): RefundHistoryItem[] {
  const recordIds = new Set(group.records.map((record) => record.id));
  const groupHistories = histories.filter((history) =>
    recordIds.has(history.fee_record_id),
  );
  const transactions = groupHistories.flatMap((history) => history.transactions);
  const reversedIds = new Set(
    transactions
      .filter((entry) => entry.entry_type === "refund_reversal")
      .map((entry) => entry.related_payment_id)
      .filter((id): id is string => Boolean(id)),
  );
  const classNames = new Map(
    group.records.map((record) => [record.id, record.class_name]),
  );

  return groupHistories
    .flatMap((history) => {
      const className = classNames.get(history.fee_record_id) ?? "Lớp học";
      return history.transactions
        .filter((entry) => entry.entry_type === "refund")
        .map((transaction) => ({
          className,
          reversed: reversedIds.has(transaction.id),
          transaction,
        }));
    })
    .sort((first, second) =>
      second.transaction.created_at.localeCompare(first.transaction.created_at),
    );
}

function RefundHistorySection({
  error,
  history,
  isBusy,
  isLoading,
  onBlurReversalReason,
  onCancelReversal,
  onChangeReversalReason,
  onConfirmReversal,
  onRetry,
  onSelectReversal,
  reversalError,
  reversalReason,
  reversalTarget,
}: {
  error: boolean;
  history: RefundHistoryItem[];
  isBusy: boolean;
  isLoading: boolean;
  onBlurReversalReason: () => void;
  onCancelReversal: () => void;
  onChangeReversalReason: (value: string) => void;
  onConfirmReversal: (transaction: FeeTransactionResponse) => void;
  onRetry: () => void;
  onSelectReversal: (transactionId: string) => void;
  reversalError: string | null;
  reversalReason: string;
  reversalTarget: string | null;
}) {
  const reversalErrorId = useId();
  if (!isLoading && !error && history.length === 0) return null;

  return (
    <section className="mb-4 rounded-lg border border-gray-200 bg-white">
      <div className="flex h-10 items-center gap-2 border-b border-gray-200 px-3">
        <History className="h-4 w-4 text-gray-500" aria-hidden="true" />
        <h3 className="select-none text-sm font-semibold text-gray-900">
          Lịch sử hoàn phí
        </h3>
      </div>
      {isLoading && history.length === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500"><LoadingLabel label="Đang tải lịch sử" /></p>
      ) : null}
      {error ? (
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <p role="alert" className="text-sm font-medium text-destructive">
            Chưa tải được đầy đủ lịch sử giao dịch.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-8 shrink-0 px-2.5 text-xs"
            disabled={isBusy || isLoading}
            onClick={onRetry}
          >
            Thử lại
          </Button>
        </div>
      ) : null}
      <div className="divide-y divide-gray-100">
        {history.map(({ className, reversed, transaction }) => {
          const isEditing = reversalTarget === transaction.id;
          return (
            <div key={transaction.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {className} · {formatCurrency(Math.abs(transaction.amount))}
                  </p>
                  <p className="mt-0.5 text-xs font-normal text-gray-500">
                    {formatDate(transaction.transaction_date)} ·{" "}
                    {transaction.payment_method === "cash"
                      ? "Tiền mặt"
                      : "Chuyển khoản"}
                    {transaction.created_by_name
                      ? ` · ${transaction.created_by_name}`
                      : ""}
                    {transaction.settlement_bank_name
                      ? ` · ${transaction.settlement_bank_name} · ****${
                          transaction.settlement_account_number?.slice(-4) ?? ""
                        }`
                      : ""}
                  </p>
                  {transaction.note ? (
                    <p className="mt-1 text-sm font-normal text-gray-600">
                      {transaction.note}
                    </p>
                  ) : null}
                </div>
                {reversed ? (
                  <span className="select-none rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500">
                    Đã hoàn tác
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 shrink-0 px-2.5 text-xs"
                    disabled={isBusy}
                    onClick={() => onSelectReversal(transaction.id)}
                  >
                    Sửa giao dịch
                  </Button>
                )}
              </div>

              {isEditing && !reversed ? (
                <div className="mt-2.5 rounded-md bg-gray-50 p-2.5">
                  <label className="block">
                    <span className="select-none text-xs font-semibold text-gray-700">
                      Lý do hoàn tác khoản hoàn
                    </span>
                    <input
                      type="text"
                      autoComplete={savedInfoAutocomplete.disabled}
                      value={reversalReason}
                      maxLength={500}
                      disabled={isBusy}
                      onChange={(event) =>
                        onChangeReversalReason(event.target.value)
                      }
                      onBlur={onBlurReversalReason}
                      aria-invalid={Boolean(reversalError)}
                      aria-describedby={reversalError ? reversalErrorId : undefined}
                      placeholder="Ví dụ: Nhập nhầm số tiền hoàn"
                      className={cn(formTextControlClassName, "mt-1.5")}
                    />
                  </label>
                  <p
                    id={reversalErrorId}
                    role={reversalError ? "alert" : undefined}
                    className="mt-1.5 min-h-5 text-sm font-medium text-destructive"
                  >
                    {reversalError ?? ""}
                  </p>
                  <div className="mt-1 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2.5 text-xs"
                      disabled={isBusy}
                      onClick={onCancelReversal}
                    >
                      Huỷ
                    </Button>
                    <Button
                      type="button"
                      className="h-8 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
                      disabled={isBusy}
                      onClick={() => onConfirmReversal(transaction)}
                    >
                      {isBusy ? (
                        <LoaderCircle
                          className="mr-1 h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      Xác nhận hoàn tác
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
