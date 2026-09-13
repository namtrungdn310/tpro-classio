"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  RiFileCopyLine,
  RiQrCodeLine,
  RiShareLine,
} from "react-icons/ri";

import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { LoadingLabel } from "@/components/ui/loading-label";
import {
  createEarlyPaymentRequest,
  createPay2SCollectionLink,
  revokePaymentRequest,
  sharePaymentRequest,
} from "@/lib/api/fees";
import type { StudentFeeGroup } from "@/lib/fees/view-model";
import type { PaymentRequestResponse } from "@/lib/types";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatCurrency } from "@/lib/utils/format";

type FeePaymentRequestDialogProps = {
  group: StudentFeeGroup | null;
  existingRequest?: PaymentRequestResponse;
  pay2sReady: boolean;
  onClose: () => void;
  onChanged: () => void;
};

export function FeePaymentRequestDialog({
  group,
  existingRequest,
  pay2sReady,
  onClose,
  onChanged,
}: FeePaymentRequestDialogProps) {
  const notify = useToast();
  const [request, setRequest] = useState<PaymentRequestResponse | null>(
    existingRequest ?? null,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);

  useEffect(() => {
    setRequest(existingRequest ?? null);
  }, [existingRequest, group?.student_id]);

  const qrCode = useMemo(
    () =>
      request?.qr_payload?.qr_list?.find(
        (item) => typeof item.qrCode === "string",
      )?.qrCode,
    [request],
  );
  const qrImage =
    typeof qrCode === "string"
      ? qrCode
      : request?.qr_payload?.manual_qr_url ?? null;
  const receivingAccount = request?.qr_payload?.receiving_account;

  if (!group) return null;

  const targetGroup = group;
  const classNames = targetGroup.classes.map((item) => item.name).join(", ");
  const isBusy = isCreating || isSharing || isRevoking;

  async function createRequest() {
    setIsCreating(true);
    try {
      let next =
        request ??
        (await createEarlyPaymentRequest(
          targetGroup.records.map((record) => record.id),
        ));
      if (pay2sReady && !next.qr_payload?.payment_url) {
        next = await createPay2SCollectionLink(next.id);
      }
      setRequest(next);
      onChanged();
      notify.success(
        pay2sReady
          ? "Đã tạo QR Pay2S cho khoản học phí."
          : "Đã tạo thông tin chuyển khoản để gửi phụ huynh.",
      );
    } catch (error) {
      notify.error(getApiErrorMessage(error, "Không thể tạo yêu cầu thanh toán."));
    } finally {
      setIsCreating(false);
    }
  }

  function buildMessage(current: PaymentRequestResponse) {
    return [
      `TPRO English - ${targetGroup.student_name}`,
      `Lớp: ${classNames}`,
      `Học phí: ${formatCurrency(current.expected_amount)}`,
      current.qr_payload?.receiving_account
        ? `Ngân hàng: ${current.qr_payload.receiving_account.bank_name}`
        : null,
      current.qr_payload?.receiving_account
        ? `Số tài khoản: ${current.qr_payload.receiving_account.account_number}`
        : null,
      current.qr_payload?.receiving_account
        ? `Chủ tài khoản: ${current.qr_payload.receiving_account.account_name}`
        : null,
      `Nội dung chuyển khoản: ${current.payment_reference}`,
      current.qr_payload?.payment_url
        ? `Mã thanh toán: ${current.qr_payload.payment_url}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function shareRequest(channel: "copy_message" | "share_link") {
    if (!request) return;
    setIsSharing(true);
    try {
      const message = buildMessage(request);
      let recordedChannel = channel;
      if (channel === "share_link" && navigator.share) {
        await navigator.share({
          title: `Học phí của ${targetGroup.student_name}`,
          text: message,
          url: request.qr_payload?.payment_url ?? undefined,
        });
      } else {
        await navigator.clipboard.writeText(message);
        recordedChannel = "copy_message";
      }
      const updated = await sharePaymentRequest(request.id, recordedChannel);
      setRequest(updated);
      onChanged();
      notify.success(
        recordedChannel === "copy_message"
          ? "Đã sao chép nội dung gửi phụ huynh."
          : "Đã mở bảng chia sẻ.",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify.error(
        getApiErrorMessage(error, "Không thể chuẩn bị nội dung chia sẻ."),
      );
    } finally {
      setIsSharing(false);
    }
  }

  async function revokeRequest() {
    if (!request) return;
    setIsRevoking(true);
    try {
      await revokePaymentRequest(request.id);
      setRequest(null);
      setConfirmRevokeOpen(false);
      onChanged();
      notify.success("Đã hủy yêu cầu thanh toán. Bạn có thể tạo QR mới.");
    } catch (error) {
      notify.error(getApiErrorMessage(error, "Không thể hủy yêu cầu thanh toán."));
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <FormDialogShell
      title="Tạo QR học phí"
      subtitle={`${targetGroup.student_name} · ${classNames}`}
      width="standard"
      isBusy={isBusy}
      onClose={onClose}
    >
      <FormDialogBody className="space-y-4 bg-gray-50/60">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-sm text-gray-600">Số tiền cần thu</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-gray-950">
                {formatCurrency(targetGroup.total_amount)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Cách ghi nhận</p>
              <p className="mt-1 text-sm font-semibold text-gray-950">
                {pay2sReady
                  ? "Pay2S tự động đối soát"
                  : "Admin xác nhận thủ công"}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-gray-700">
            {pay2sReady
              ? "TPRO tạo nội dung chuyển khoản riêng. Học phí chỉ được tự động ghi nhận khi giao dịch khớp nội dung, số tiền và tài khoản nhận."
              : "TPRO chuẩn bị thông tin chuyển khoản. Sau khi nhận tiền, Admin bấm ghi nhận học phí và chọn đúng tài khoản đã nhận."}
          </p>
        </section>

        {request ? (
          <section className="rounded-xl border border-primary/20 bg-white p-4">
            <div className="flex flex-col gap-4 sm:flex-row">
              {qrImage ? (
                <Image
                  unoptimized
                  src={qrImage}
                  alt={`QR học phí của ${targetGroup.student_name}`}
                  width={176}
                  height={176}
                  className="h-44 w-44 shrink-0 rounded-lg border border-gray-200 bg-white object-contain p-2"
                />
              ) : (
                <div className="flex h-44 w-44 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-400">
                  <RiQrCodeLine className="h-8 w-8" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-600">
                  Nội dung chuyển khoản
                </p>
                <div className="mt-1 flex items-center gap-2 rounded-lg bg-primary-soft/50 px-3 py-2.5">
                  <strong className="min-w-0 flex-1 select-text break-all text-base text-primary">
                    {request.payment_reference}
                  </strong>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Sao chép nội dung chuyển khoản"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(request.payment_reference)
                        .then(
                          () => notify.success("Đã sao chép nội dung chuyển khoản."),
                          () => notify.error("Không thể sao chép nội dung chuyển khoản."),
                        );
                    }}
                  >
                    <RiFileCopyLine aria-hidden="true" />
                  </Button>
                </div>
                <p className="mt-3 text-sm leading-6 text-gray-600">
                  QR không tự gửi. Hãy dùng nút bên dưới để gửi đúng nội dung
                  này cho phụ huynh.
                </p>
                {receivingAccount ? (
                  <dl className="mt-3 grid gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-gray-500">Ngân hàng</dt>
                      <dd className="font-semibold text-gray-950">
                        {receivingAccount.bank_name}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Số tài khoản</dt>
                      <dd className="select-text font-semibold tabular-nums text-gray-950">
                        {receivingAccount.account_number}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-gray-500">Tên chủ tài khoản</dt>
                      <dd className="font-semibold text-gray-950">
                        {receivingAccount.account_name}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                {request.qr_payload?.payment_url ? (
                  <a
                    href={request.qr_payload.payment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-primary hover:bg-gray-50"
                  >
                    Mở QR Pay2S
                  </a>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-center">
            <RiQrCodeLine
              className="mx-auto h-8 w-8 text-primary"
              aria-hidden="true"
            />
            <h2 className="mt-2 text-base font-semibold text-gray-950">
              Sẵn sàng tạo thông tin thanh toán
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              Kiểm tra đúng học viên và số tiền trước khi tiếp tục.
            </p>
          </section>
        )}
      </FormDialogBody>
      <FormDialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Đóng
        </Button>
        {!request || (pay2sReady && !request.qr_payload?.payment_url) ? (
          <Button type="button" disabled={isBusy} onClick={() => void createRequest()}>
            <RiQrCodeLine aria-hidden="true" />
            {isCreating ? (
              <LoadingLabel label="Đang tạo" />
            ) : pay2sReady ? (
              "Tạo QR Pay2S"
            ) : (
              "Tạo thông tin chuyển khoản"
            )}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => setConfirmRevokeOpen(true)}
            >
              Hủy QR
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => void shareRequest("copy_message")}
            >
              <RiFileCopyLine aria-hidden="true" />
              {isSharing ? <LoadingLabel label="Đang chuẩn bị" /> : "Sao chép"}
            </Button>
            <Button
              type="button"
              disabled={isBusy}
              onClick={() => void shareRequest("share_link")}
            >
              <RiShareLine aria-hidden="true" />
              Chia sẻ
            </Button>
          </>
        )}
      </FormDialogFooter>
      <ConfirmationDialog
        open={confirmRevokeOpen}
        title="Hủy yêu cầu thanh toán?"
        description="QR và nội dung chuyển khoản này sẽ không còn được hệ thống tự động ghi nhận. Lịch sử hủy vẫn được lưu để đối soát."
        confirmLabel="Hủy yêu cầu"
        pendingLabel="Đang hủy"
        tone="danger"
        isPending={isRevoking}
        onCancel={() => setConfirmRevokeOpen(false)}
        onConfirm={() => void revokeRequest()}
      />
    </FormDialogShell>
  );
}
