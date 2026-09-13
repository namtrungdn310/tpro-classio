"use client";

import { StaffSkeleton } from "@/components/staff/staff-skeleton";
import { useAuth } from "@/lib/hooks/useAuth";
import { isManagementUser } from "@/lib/auth/permissions";
import { HeaderLoadingControls } from "@/components/layout/header-loading-status";

export default function StaffLoading() {
  const { user } = useAuth();
  const canManage = isManagementUser(user);
  return (
    <>
      <HeaderLoadingControls actionCount={canManage ? 2 : 0} />
      <div className="h-full min-h-0">
        <StaffSkeleton canManage={canManage} canViewPrivate={canManage} />
      </div>
    </>
  );
}
