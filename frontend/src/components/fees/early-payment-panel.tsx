"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  RiBankCardLine,
  RiFileCopyLine,
  RiQrCodeLine,
  RiShareLine,
} from "react-icons/ri";
import { EarlyPaymentRecordDialog } from "@/components/fees/early-payment-record-dialog";
import {
  createEarlyPaymentRequest,
  createPay2SCollectionLink,
  payFeeRecordsEarly,
  sharePaymentRequest,
} from "@/lib/api/fees";
import type {
  BankAccount,
  FeePaymentMethod,
  FeeRecordResponse,
  PaymentRequestResponse,
} from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { LoadingLabel } from "@/components/ui/loading-label";
import { useToast } from "@/components/providers/toast-provider";
import { getApiErrorMessage } from "@/lib/api/errors";

type Props = {
  records: FeeRecordResponse[];
  isLoading: boolean;
  isError?: boolean;
  isRetrying?: boolean;
  qrEnabled: boolean;
  pay2sReady: boolean;
  requests?: PaymentRequestResponse[];
  accountOptions: BankAccount[];
  onChanged: () => void;
  onRetry?: () => void;
};

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function EarlyPaymentPanel({
  records,
  isLoading,
  isError = false,
  isRetrying = false,
  qrEnabled,
  pay2sReady,
  requests = [],
  accountOptions,
  onChanged,
  onRetry,
}: Props) {
  const notify = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<FeeRecordResponse | null>(null);
  const [requestByRecord, setRequestByRecord] = useState<
    Record<string, PaymentRequestResponse>
  >({});
  useEffect(() => {
    if (requests.length === 0) return;
    setRequestByRecord((current) => {
      const next = { ...current };
      for (const request of requests) {
        if (request.status !== "OPEN" && request.status !== "REVIEW") {
          continue;
        }
        for (const item of request.items) {
          next[item.fee_record_id] = request;
        }
      }
      return next;
    });
  }, [requests]);
  const upcoming = records.filter(
    (record) =>
      record.status === "UNPAID" &&
      (record.adjusted_due_date ?? record.due_date) !== null &&
      (record.adjusted_due_date ?? record.due_date)! > todayIso(),
  );

  async function createQr(record: FeeRecordResponse) {
    setPendingId(`${record.id}:qr`);
    try {
      let request = await createEarlyPaymentRequest([record.id]);
      if (pay2sReady) {
        try {
          request = await createPay2SCollectionLink(request.id);
        } catch (error) {
          setRequestByRecord((current) => ({
            ...current,
            [record.id]: request,
          }));
          onChanged();
          notify.error(
            getApiErrorMessage(
              error,
              "Đã tạo yêu cầu nhưng không thể tạo QR Pay2S.",
            ),
          );
          return;
        }
      }
      setRequestByRecord((current) => ({ ...current, [record.id]: request }));
      onChanged();
      notify.success(
        request.qr_payload?.payment_url
          ? "Đã tạo mã thanh toán Pay2S."
          : "Đã tạo yêu cầu chuyển khoản thủ công.",
      );
    } catch (error) {
      notify.error(getApiErrorMessage(error, "Không thể tạo mã thanh toán."));
    } finally {
      setPendingId(null);
    }
  }

  async function recordPayment(
    record: FeeRecordResponse,
    method: FeePaymentMethod,
    settlementAccountId?: string,
  ) {
    setPendingId(`${record.id}:payment`);
    try {
      await payFeeRecordsEarly([record.id], method, settlementAccountId);
      notify.success(`Đã ghi nhận học phí sớm cho ${record.student_name}.`);
      setRecordingTarget(null);
      onChanged();
    } catch (error) {
      notify.error(getApiErrorMessage(error, "Không thể ghi nhận học phí."));
    } finally {
      setPendingId(null);
    }
  }

  function paymentMessage(
    record: FeeRecordResponse,
    request: PaymentRequestResponse,
  ) {
    return `TPRO English - ${record.student_name}\nHọc phí: ${formatCurrency(request.expected_amount)}\nNội dung chuyển khoản: ${request.payment_reference}\nVui lòng gửi ảnh xác nhận sau khi chuyển khoản.`;
  }

  async function shareRequest(
    record: FeeRecordResponse,
    request: PaymentRequestResponse,
    channel: "copy_message" | "share_link" | "zalo_manual",
  ) {
    setSharingId(request.id);
    try {
      const message = paymentMessage(record, request);
      if (channel === "share_link" && navigator.share) {
        await navigator.share({
          title: "Yêu cầu thanh toán TPRO English",
          text: message,
          url: request.qr_payload?.payment_url ?? undefined,
        });
      } else {
        await navigator.clipboard.writeText(message);
        if (channel === "share_link") channel = "copy_message";
      }
      const updated = await sharePaymentRequest(request.id, channel);
      setRequestByRecord((current) => ({ ...current, [record.id]: updated }));
      onChanged();
      notify.success(
        channel === "zalo_manual"
          ? "Đã ghi nhận Admin đã gửi QR cho phụ huynh."
          : "Đã chuẩn bị nội dung gửi phụ huynh.",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify.error(
        getApiErrorMessage(error, "Không thể ghi nhận thao tác gửi QR."),
      );
    } finally {
      setSharingId(null);
    }
  }

  if (!isLoading && !isError && upcoming.length === 0) return null;

  return (
    <>
    <section
      aria-labelledby="early-payment-heading"
      className="shrink-0 rounded-lg border border-primary/15 bg-primary-soft/30 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="early-payment-heading"
            className="text-sm font-semibold text-gray-900"
          >
            Yêu cầu thanh toán
          </h2>
          <p className="mt-0.5 text-xs text-gray-600">
            Admin tạo yêu cầu rồi gửi QR cho phụ huynh. Tạo QR không tự gửi và
            không tự ghi nhận đã thanh toán.
          </p>
        </div>
        <RiBankCardLine
          className="mt-0.5 h-5 w-5 shrink-0 text-primary"
          aria-hidden="true"
        />
      </div>
      {isError ? (
        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
          role="alert"
        >
          <span>Không tải được các kỳ sắp đến hạn.</span>
          {onRetry ? (
            <button
              type="button"
              className="shrink-0 font-semibold underline underline-offset-2 disabled:cursor-wait disabled:opacity-60"
              disabled={isRetrying}
              onClick={onRetry}
            >
              {isRetrying ? <LoadingLabel label="Đang thử lại" /> : "Thử lại"}
            </button>
          ) : null}
        </div>
      ) : isLoading ? (
        <div className="mt-3 text-xs text-gray-600" role="status">
          <LoadingLabel label="Đang tải kỳ sắp đến hạn" />
        </div>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {upcoming.map((record) => {
            const request = requestByRecord[record.id];
            const isQrPending = pendingId === `${record.id}:qr`;
            const isPaymentPending = pendingId === `${record.id}:payment`;
            const qrCode = request?.qr_payload?.qr_list?.find(
              (item) => typeof item.qrCode === "string",
            )?.qrCode;
            const manualQrUrl = request?.qr_payload?.manual_qr_url;
            return (
              <article
                key={record.id}
                className="rounded-md border border-gray-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {record.student_name}
                    </p>
                    <p className="truncate text-xs text-gray-600">
                      {record.class_name}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900">
                    {formatCurrency(record.final_amount)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Đến hạn{" "}
                  {formatDate(record.adjusted_due_date ?? record.due_date)}
                </p>
                {request ? (
                  <div className="mt-2 rounded border border-primary/20 bg-primary-soft/40 px-2 py-1.5 text-xs">
                    <span className="text-gray-600">Mã tham chiếu: </span>
                    <strong className="select-text font-semibold text-primary">
                      {request.payment_reference}
                    </strong>
                    <button
                      type="button"
                      className="ml-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded text-primary hover:bg-primary/10"
                      aria-label="Sao chép mã tham chiếu"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(request.payment_reference)
                          .then(
                            () => notify.success("Đã sao chép mã tham chiếu."),
                            () =>
                              notify.error("Không thể sao chép mã tham chiếu."),
                          );
                      }}
                    >
                      <RiFileCopyLine className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                {request?.qr_payload?.payment_url ? (
                  <a
                    href={request.qr_payload.payment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                  >
                    Mở QR thanh toán
                  </a>
                ) : null}
                {typeof qrCode === "string" ? (
                  <Image
                    src={qrCode}
                    alt={`Mã QR thanh toán cho ${record.student_name}`}
                    width={128}
                    height={128}
                    unoptimized
                    className="mt-2 h-32 w-32 rounded border border-gray-200 bg-white object-contain p-1"
                  />
                ) : null}
                {typeof qrCode !== "string" && manualQrUrl ? (
                  <Image
                    src={manualQrUrl}
                    alt={`QR gốc của tài khoản nhận tiền cho ${record.student_name}`}
                    width={128}
                    height={128}
                    unoptimized
                    className="mt-2 h-32 w-32 rounded border border-gray-200 bg-white object-contain p-1"
                  />
                ) : null}
                {request ? (
                  <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2">
                    <p className="text-xs text-gray-600">
                      {request.sent_at
                        ? `Đã ghi nhận gửi ${request.send_count ? `(${request.send_count} lần)` : ""}.`
                        : "Chưa ghi nhận đã gửi cho phụ huynh."}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={sharingId !== null}
                        onClick={() =>
                          void shareRequest(record, request, "copy_message")
                        }
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                      >
                        <RiFileCopyLine aria-hidden="true" /> Sao chép tin nhắn
                      </button>
                      <button
                        type="button"
                        disabled={sharingId !== null}
                        onClick={() =>
                          void shareRequest(record, request, "share_link")
                        }
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-primary/30 bg-white px-2.5 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-60"
                      >
                        <RiShareLine aria-hidden="true" /> Chia sẻ
                      </button>
                      <button
                        type="button"
                        disabled={sharingId !== null}
                        onClick={() =>
                          void shareRequest(record, request, "zalo_manual")
                        }
                        className="inline-flex min-h-9 items-center rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        {sharingId === request.id ? (
                          <LoadingLabel label="Đang lưu" />
                        ) : (
                          "Đã gửi qua Zalo"
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {!request ? (
                    <button
                      type="button"
                      disabled={pendingId !== null}
                      onClick={() => void createQr(record)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-primary/25 bg-white px-2.5 text-xs font-semibold text-primary transition hover:bg-primary-soft disabled:cursor-wait disabled:opacity-60"
                    >
                      <RiQrCodeLine className="h-4 w-4" aria-hidden="true" />
                      {isQrPending ? (
                        <LoadingLabel label="Đang tạo" />
                      ) : pay2sReady ? (
                        "Tạo QR thanh toán"
                      ) : qrEnabled ? (
                        "Tạo yêu cầu chuyển khoản"
                      ) : (
                        "Tạo yêu cầu thanh toán"
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    onClick={() => setRecordingTarget(record)}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
                  >
                    <RiBankCardLine className="h-4 w-4" aria-hidden="true" />
                    {isPaymentPending ? <LoadingLabel label="Đang lưu" /> : "Ghi nhận đã thu"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
    {recordingTarget ? (
      <EarlyPaymentRecordDialog
        record={recordingTarget}
        accountOptions={accountOptions}
        isPending={pendingId === `${recordingTarget.id}:payment`}
        onClose={() => setRecordingTarget(null)}
        onConfirm={(method, accountId) =>
          void recordPayment(recordingTarget, method, accountId)
        }
      />
    ) : null}
    </>
  );
}
