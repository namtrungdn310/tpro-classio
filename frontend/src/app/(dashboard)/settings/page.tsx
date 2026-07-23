"use client";

import { AccountSettingsSection } from "@/components/settings/account-settings-section";
import { SecuritySettingsSection } from "@/components/settings/security-settings-section";
import { UserAccessPanel } from "@/components/settings/user-access-panel";
import { useAuth } from "@/lib/hooks/useAuth";

export default function SettingsPage() {
  const { user } = useAuth();

  if (!user) return null;

  const canManageUsers = Boolean(user.is_owner);

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
          </div>
        ) : null}
      </div>
    </div>
  );
}
