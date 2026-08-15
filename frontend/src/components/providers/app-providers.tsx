"use client";

import type { ReactNode } from "react";
import type { UserMe } from "@/lib/api/auth";
import { AuthProvider } from "@/lib/hooks/useAuth";
import { QueryProvider } from "@/lib/providers/query-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import { UnifiedCaretProvider } from "@/components/providers/unified-caret-provider";
import { BusinessDateRollover } from "@/components/providers/business-date-rollover";
import { ActionSelectionGuard } from "@/components/providers/action-selection-guard";

export function AppProviders({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser: UserMe | null;
}) {
  return (
    <QueryProvider>
      <ToastProvider>
        <AuthProvider initialUser={initialUser}>
          {children}
          <BusinessDateRollover />
          <UnifiedCaretProvider />
          <ActionSelectionGuard />
        </AuthProvider>
      </ToastProvider>
    </QueryProvider>
  );
}
