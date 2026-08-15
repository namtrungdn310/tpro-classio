"use client";

import { StaffSkeleton } from "@/components/staff/staff-skeleton";
import { useAuth } from "@/lib/hooks/useAuth";
import { isManagementUser } from "@/lib/auth/permissions";

export default function StaffLoading() {
  const { user } = useAuth();
  const canManage = isManagementUser(user);
  return (
    <div className="h-full min-h-0">
      <StaffSkeleton
        canManage={canManage}
        canViewPrivate={canManage}
      />
    </div>
  );
}
