"use client";

import { ReportPageSkeleton } from "@/components/reports/report-skeleton";
import { HeaderLoadingControls } from "@/components/layout/header-loading-status";

export default function ReportLoading() {
  return (
    <>
      <HeaderLoadingControls actionCount={1} />
      <div className="h-full min-h-0"><ReportPageSkeleton /></div>
    </>
  );
}
