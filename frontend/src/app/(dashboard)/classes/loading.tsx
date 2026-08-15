"use client";

import { ClassesSkeleton } from "@/components/classes/classes-table";

export default function ClassesLoading() {
  return (
    <div className="h-full min-h-0">
      <ClassesSkeleton />
    </div>
  );
}
