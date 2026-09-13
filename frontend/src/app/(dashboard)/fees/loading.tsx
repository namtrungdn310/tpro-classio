"use client";

import { FeesPageSkeleton } from "@/components/fees/fees-skeleton";
import { useAuth } from "@/lib/hooks/useAuth";
import { isManagementUser } from "@/lib/auth/permissions";
import { HeaderLoadingControls } from "@/components/layout/header-loading-status";

export default function FeesLoading() {
  const { user } = useAuth();
  return (
    <>
      <HeaderLoadingControls actionCount={2} />
      <div className="h-full min-h-0">
        <FeesPageSkeleton isAdmin={isManagementUser(user)} />
      </div>
    </>
  );
}
