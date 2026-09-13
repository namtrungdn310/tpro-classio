"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PendingActionButton } from "@/components/ui/pending-action-button";
import type { ClassResponse } from "@/lib/types";

/** Shared class cancel content used by the standalone dialog and the workspace. */
export function ClassCancelContent({
  class_,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  class_: ClassResponse;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 3;
  return (
    <>
      <p className="text-sm font-normal leading-6 text-gray-600">
        Lớp <strong className="font-semibold text-gray-800">{class_.display_name}</strong> sẽ ngừng
        hoạt động từ hôm nay. Lịch sử học tập và các khoản đã nộp hoặc đã thông báo vẫn được giữ.
      </p>
      <p className="mt-2 flex items-start gap-2 text-sm leading-5 text-gray-600">
        <span aria-hidden="true" className="font-bold text-primary">!</span>
        Kỳ cuối của từng học viên sẽ được giữ tại Học phí → Chưa báo để bạn gửi thông báo đầy đủ.
      </p>
      <label htmlFor="class-stop-reason" className="form-label-text mt-4 block select-none text-gray-800">
        Lý do
      </label>
      <textarea
        id="class-stop-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        maxLength={500}
        autoComplete="off"
        disabled={isDeleting}
        aria-describedby="class-stop-reason-help"
        className="mt-2 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/20"
      />
      <p id="class-stop-reason-help" className="mt-1 text-xs text-gray-500">
        Nhập ít nhất 3 ký tự để lưu vào lịch sử lớp.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-8 rounded-md px-3 text-sm"
          disabled={isDeleting}
          onClick={onCancel}
        >
          Huỷ
        </Button>
        <PendingActionButton
          type="button"
          variant="destructive"
          isPending={isDeleting}
          pendingLabel="Đang ngừng"
          disabled={!valid}
          onClick={() => onConfirm(reason.trim())}
          className="h-8 w-fit rounded-md bg-destructive px-3 text-sm text-destructive-foreground hover:bg-destructive/90"
        >
          Ngừng hoạt động
        </PendingActionButton>
      </div>
    </>
  );
}
