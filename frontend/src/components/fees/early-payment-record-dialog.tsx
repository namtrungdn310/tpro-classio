"use client";

import { useEffect, useMemo, useState } from "react";
import { RiBankLine, RiCashLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { FormSection } from "@/components/ui/form-section";
import { LoadingLabel } from "@/components/ui/loading-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { BankAccount, FeePaymentMethod, FeeRecordResponse } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils/format";

type Props = {
  accountOptions: BankAccount[];
  isPending: boolean;
  onClose: () => void;
  onConfirm: (method: FeePaymentMethod, settlementAccountId?: string) => void;
  record: FeeRecordResponse;
};

const METHOD_OPTIONS = [
  { value: "bank_transfer", label: "Chuyển khoản" },
  { value: "cash", label: "Tiền mặt" },
];

export function EarlyPaymentRecordDialog({
  accountOptions,
  isPending,
  onClose,
  onConfirm,
  record,
}: Props) {
  const defaultAccountId = useMemo(
    () => accountOptions.find((account) => account.is_default)?.id ?? accountOptions[0]?.id ?? "",
    [accountOptions],
  );
  const [method, setMethod] = useState<FeePaymentMethod>(
    accountOptions.length > 0 ? "bank_transfer" : "cash",
  );
  const [accountId, setAccountId] = useState(defaultAccountId);

  useEffect(() => setAccountId(defaultAccountId), [defaultAccountId]);

  const dueDate = record.adjusted_due_date ?? record.due_date;
  const canSubmit = method === "cash" || Boolean(accountId);

  return (
    <FormDialogShell
      title="Ghi nhận học phí sớm"
      subtitle="Xác nhận số tiền đã thực nhận trước ngày đến hạn."
      width="sm"
      isBusy={isPending}
      onClose={onClose}
    >
      <FormDialogBody>
        <FormSection label="Khoản học phí" order={1}>
          <div className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="truncate font-semibold text-gray-950">{record.student_name}</p>
              <p className="mt-1 truncate text-gray-600">{record.class_name}</p>
              {dueDate ? (
                <p className="mt-1 text-xs text-gray-500">Đến hạn {formatDate(dueDate)}</p>
              ) : null}
            </div>
            <p className="self-center whitespace-nowrap font-semibold tabular-nums text-gray-950">
              {formatCurrency(record.final_amount)}
            </p>
          </div>
        </FormSection>

        <FormSection label="Hình thức nhận tiền" order={2}>
          <span id="early-payment-method-label" className="sr-only">
            Hình thức nhận tiền
          </span>
          <SegmentedControl
            ariaLabelledBy="early-payment-method-label"
            disabled={isPending}
            onSelect={(value) => setMethod(value as FeePaymentMethod)}
            options={METHOD_OPTIONS}
            selected={method}
          />

          {method === "bank_transfer" ? (
            <div>
              <label htmlFor="early-payment-account" className="form-label-text block text-gray-700">
                Tài khoản đã nhận tiền
              </label>
              <div className="relative mt-1.5">
                <RiBankLine
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                />
                <select
                  id="early-payment-account"
                  value={accountId}
                  disabled={isPending || accountOptions.length === 0}
                  onChange={(event) => setAccountId(event.target.value)}
                  className="form-input-text h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-gray-900 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-gray-50"
                >
                  {accountOptions.length === 0 ? (
                    <option value="">Chưa có tài khoản nhận tiền</option>
                  ) : null}
                  {accountOptions.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label} · {account.bank_name} · {account.account_number}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-gray-500">
                Chọn đúng tài khoản thực tế đã nhận tiền để báo cáo và đối soát không bị sai.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
              <RiCashLine className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
              Hệ thống sẽ ghi nhận đây là khoản tiền mặt do admin xác nhận.
            </div>
          )}
        </FormSection>
      </FormDialogBody>

      <FormDialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={onClose}>
          Huỷ
        </Button>
        <Button
          type="button"
          disabled={isPending || !canSubmit}
          onClick={() => onConfirm(method, method === "bank_transfer" ? accountId : undefined)}
        >
          {isPending ? <LoadingLabel label="Đang ghi nhận" /> : "Ghi nhận đã thu"}
        </Button>
      </FormDialogFooter>
    </FormDialogShell>
  );
}
