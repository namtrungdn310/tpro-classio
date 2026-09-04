"use client";

import { useEffect, useState } from "react";
import { RiAlertLine, RiCheckLine, RiCloseCircleLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { PendingActionButton } from "@/components/ui/pending-action-button";
import type { BillingReview, BillingReviewFee } from "@/lib/types";

type Props = {
  reviews: BillingReview[];
  isLoading: boolean;
  isResolving: boolean;
  onConfirm: (review: BillingReview) => void;
  onWaive: (review: BillingReview, fee: BillingReviewFee, reason: string) => void;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

export function BillingReviewNotice({
  reviews,
  isLoading,
  isResolving,
  onConfirm,
  onWaive,
}: Props) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [waiveFee, setWaiveFee] = useState<BillingReviewFee | null>(null);
  const [reason, setReason] = useState("");
  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0];

  useEffect(() => {
    if (reviews.length === 0) {
      setOpen(false);
      setSelectedId(null);
      return;
    }
    if (!selectedId || !reviews.some((review) => review.id === selectedId)) {
      setSelectedId(reviews[0].id);
    }
  }, [reviews, selectedId]);

  if (!isLoading && reviews.length === 0) return null;

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-1 py-1.5 text-sm"
      >
        <span className="flex min-w-0 items-center gap-2 font-medium text-gray-700">
          <RiAlertLine aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-primary" />
          {isLoading ? "Đang kiểm tra thay đổi học phí" : `Cần kiểm tra ${reviews.length} lịch thu vừa thay đổi`}
        </span>
        {!isLoading ? (
          <button
            type="button"
            className="min-h-9 shrink-0 rounded-md px-3 font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
            onClick={() => setOpen(true)}
          >
            Kiểm tra
          </button>
        ) : null}
      </div>

      {open && selected ? (
        <FormDialogShell
          title="Kiểm tra lịch thu mới"
          subtitle={`${selected.student_name} · ${selected.class_name}`}
          width="lg"
          isBusy={isResolving}
          onClose={() => setOpen(false)}
        >
          <FormDialogBody>
            {reviews.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Các thay đổi cần kiểm tra">
                {reviews.map((review) => (
                  <button
                    type="button"
                    key={review.id}
                    onClick={() => {
                      setSelectedId(review.id);
                      setWaiveFee(null);
                      setReason("");
                    }}
                    className={`min-h-9 shrink-0 rounded-md border px-3 text-sm font-semibold ${
                      review.id === selected.id
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {review.student_name}
                  </button>
                ))}
              </div>
            ) : null}

            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {selected.change_kind === "PACKAGE_DURATION_CHANGE"
                      ? "Thời lượng gói"
                      : selected.change_kind === "CLASS_START_DATE_CHANGE"
                      ? "Dời ngày bắt đầu lớp"
                      : "Ngày bắt đầu học"}
                  </p>
                  <p className="mt-1 text-base font-semibold tabular-nums text-gray-900">
                    {selected.change_kind === "PACKAGE_DURATION_CHANGE"
                      ? `${selected.previous_weeks} → ${selected.next_weeks} tuần`
                      : `${formatDate(selected.previous_date)} → ${formatDate(selected.next_date)}`}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hạn cần xử lý</p>
                  <p className="mt-1 text-base font-semibold tabular-nums text-gray-900">
                    {formatDate(selected.next_due_date)}
                  </p>
                </div>
              </div>
              <p className="mt-3 border-t border-gray-100 pt-3 text-sm leading-5 text-gray-600">
                Lý do: {selected.reason}
              </p>
            </section>

            <section aria-labelledby="review-fees-title" className="space-y-2">
              <h3 id="review-fees-title" className="text-sm font-semibold text-gray-800">
                Khoản thu được tính lại
              </h3>
              {selected.fees.map((fee) => (
                <div key={fee.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">
                      {formatMoney(fee.amount)} · hạn {formatDate(fee.due_date)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Phạm vi {formatDate(fee.coverage_start)}–{formatDate(fee.coverage_end)}
                      {fee.is_final_cycle ? " · Kỳ cuối" : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!fee.cancellable || isResolving}
                    title={fee.blocked_reason ?? undefined}
                    onClick={() => {
                      setWaiveFee(fee);
                      setReason("");
                    }}
                    className="min-h-9 shrink-0"
                  >
                    <RiCloseCircleLine aria-hidden="true" className="mr-1.5 h-4 w-4" />
                    Hủy khoản thu
                  </Button>
                </div>
              ))}
            </section>

            {waiveFee ? (
              <section className="rounded-xl border border-gray-200 p-4">
                <label htmlFor="billing-waive-reason" className="form-label-text block select-none text-gray-800">
                  Lý do hủy khoản {formatMoney(waiveFee.amount)}
                </label>
                    <textarea
                      id="billing-waive-reason"
                      autoComplete="off"
                      rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="mt-2 w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/20"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Chỉ hủy khoản này; lịch thu của các kỳ tiếp theo vẫn được giữ.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setWaiveFee(null)}>
                    Quay lại
                  </Button>
                  <PendingActionButton
                    type="button"
                    variant="destructive"
                    isPending={isResolving}
                    pendingLabel="Đang hủy"
                    disabled={reason.trim().length < 3}
                    onClick={() => onWaive(selected, waiveFee, reason.trim())}
                  >
                    Hủy khoản thu
                  </PendingActionButton>
                </div>
              </section>
            ) : null}
          </FormDialogBody>
          <FormDialogFooter
            left={<span className="text-xs text-gray-500">Khoản này chưa thể báo hoặc thu trước khi xác nhận.</span>}
            right={
              <PendingActionButton
                type="button"
                isPending={isResolving}
                pendingLabel="Đang xác nhận"
                onClick={() => onConfirm(selected)}
              >
                <RiCheckLine aria-hidden="true" className="mr-1.5 h-4 w-4" />
                Xác nhận đúng
              </PendingActionButton>
            }
          />
        </FormDialogShell>
      ) : null}
    </>
  );
}
