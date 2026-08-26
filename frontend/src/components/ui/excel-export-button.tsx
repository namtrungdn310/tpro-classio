"use client";

import { RiDownloadLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";

export function ExcelExportButton({
  disabled,
  isExporting,
  onClick,
}: {
  disabled?: boolean;
  isExporting: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      disabled={disabled || isExporting}
      onClick={onClick}
      className="shrink-0 bg-[#217346] text-white hover:bg-[#1b5f3a] focus-visible:ring-[#217346]/30"
      aria-label="Xuất danh sách đang xem ra Excel"
    >
      {!isExporting ? <RiDownloadLine className="h-4 w-4" aria-hidden="true" /> : null}
      {isExporting ? <LoadingLabel label="Đang xuất" /> : "Excel"}
    </Button>
  );
}
