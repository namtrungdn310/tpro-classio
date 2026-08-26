"use client";

import { ReportPageSkeleton } from "@/components/reports/report-skeleton";

export default function ReportLoading() {
  return (
    <div className="h-full min-h-0">
      <ReportPageSkeleton />
    </div>
  );
}