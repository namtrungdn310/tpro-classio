"use client";

import { ClassesSkeleton } from "@/components/classes/classes-table";
import { useAuth } from "@/lib/hooks/useAuth";

export default function ClassesLoading() {
  const { user } = useAuth();
  return (
    <div className="h-full min-h-0">
      <ClassesSkeleton isAdmin={user?.role === "admin"} />
    </div>
  );
}
