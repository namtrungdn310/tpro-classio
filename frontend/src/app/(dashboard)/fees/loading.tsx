"use client";

import { FeesPageSkeleton } from "@/components/fees/fees-skeleton";
import { useAuth } from "@/lib/hooks/useAuth";
import { isManagementUser } from "@/lib/auth/permissions";

export default function FeesLoading() {
  const { user } = useAuth();
  return (
    <div className="h-full min-h-0">
      <FeesPageSkeleton isAdmin={isManagementUser(user)} />
    </div>
  );
}