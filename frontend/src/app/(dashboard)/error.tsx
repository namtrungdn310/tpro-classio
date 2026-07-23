"use client";

import { DataSectionError } from "@/components/ui/data-section-state";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <DataSectionError
      className="min-h-[360px]"
      title="Trang chưa thể hiển thị"
      description="Hệ thống gặp lỗi khi dựng nội dung. Dữ liệu của bạn không bị thay đổi; hãy thử tải lại trang."
      onRetry={reset}
    />
  );
}
