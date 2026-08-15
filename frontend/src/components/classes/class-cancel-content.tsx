"use client";

import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";
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
  onConfirm: () => void;
}) {
  return (
    <>
      <p className="text-sm font-normal leading-6 text-gray-600">
        Lớp <strong className="font-semibold text-gray-800">{class_.display_name}</strong> sẽ dừng vận
        hành và chuyển vào mục Đã hủy. Học viên chỉ học lớp này sẽ được ẩn khỏi danh sách học
        viên; học viên còn học lớp khác vẫn được giữ lại. Lịch sử học phí không thay đổi.
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
        <Button
          type="button"
          variant="destructive"
          className="h-8 w-fit rounded-md bg-destructive px-3 text-sm text-destructive-foreground hover:bg-destructive/90"
          disabled={isDeleting}
          onClick={onConfirm}
        >
          {isDeleting ? <LoadingLabel label="Đang hủy" /> : "Hủy lớp"}
        </Button>
      </div>
    </>
  );
}
