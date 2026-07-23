"use client";

import { StaffSkeleton } from "@/components/staff/staff-skeleton";
import { useAuth } from "@/lib/hooks/useAuth";

export default function StaffLoading() {
  const { user } = useAuth();
  return (
    <div className="h-full min-h-0">
      <StaffSkeleton
        canManage={Boolean(user?.is_owner)}
        canViewPrivate={user?.role === "admin"}
      />
    </div>
  );
}
