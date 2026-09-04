"use client";

import { AccountSettingsSection } from "@/components/settings/account-settings-section";
import { SecuritySettingsSection } from "@/components/settings/security-settings-section";
import { UserAccessPanel } from "@/components/settings/user-access-panel";
import { useAuth } from "@/lib/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { authQueryKeys } from "@/lib/auth/query-keys";
import { getUsers } from "@/lib/api/auth";
import SettingsLoading from "./loading";
import Link from "next/link";
import { RiPulseLine } from "react-icons/ri";

export default function SettingsPage() {
  const { user } = useAuth();
  const canManageUsers = Boolean(user?.is_owner);
  const usersQuery = useQuery({
    queryKey: authQueryKeys.users,
    queryFn: getUsers,
    enabled: canManageUsers,
    staleTime: 2 * 60 * 1000,
  });
  const isInitialLoading =
    canManageUsers && usersQuery.isPending && usersQuery.data === undefined;

  if (!user) return <SettingsLoading />;
  if (isInitialLoading) return <SettingsLoading />;

  return (
    <div
      className={`scrollbar-hidden h-full min-h-0 overflow-x-hidden overscroll-contain ${
        canManageUsers
          ? "overflow-y-auto min-[1360px]:overflow-y-hidden"
          : "overflow-y-auto"
      }`}
    >
      <div
        className={
          canManageUsers
            ? "grid min-w-0 gap-4 min-[1360px]:h-full min-[1360px]:grid-cols-[minmax(470px,500px)_minmax(0,1fr)]"
            : "mx-auto w-full max-w-[720px]"
        }
      >
        <div className="flex min-w-0 flex-col gap-4 min-[1360px]:h-full min-[1360px]:min-h-0 min-[1360px]:overflow-hidden">
          <AccountSettingsSection user={user} />
          <SecuritySettingsSection user={user} />
        </div>

        {canManageUsers ? (
          <div className="min-h-[420px] min-w-0 min-[1360px]:min-h-0">
            <UserAccessPanel />
            {user.is_owner ? (
              <Link href="/settings/system" className="mt-4 flex min-h-12 items-center gap-3 rounded-xl border border-primary/20 bg-primary-soft/30 px-4 text-sm font-semibold text-primary transition hover:bg-primary-soft/60">
                <RiPulseLine aria-hidden="true" />
                <span><span className="block">Mở Trung tâm vận hành</span><span className="mt-0.5 block text-xs font-normal text-slate-600">Theo dõi workspace, Pay2S và sự cố production.</span></span>
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
