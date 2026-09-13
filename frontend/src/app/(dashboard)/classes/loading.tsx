"use client";

import { ClassesSkeleton } from "@/components/classes/classes-table";
import { HeaderLoadingControls } from "@/components/layout/header-loading-status";

export default function ClassesLoading() {
  return (
    <>
      <HeaderLoadingControls actionCount={2} />
      <div className="h-full min-h-0"><ClassesSkeleton /></div>
    </>
  );
}
