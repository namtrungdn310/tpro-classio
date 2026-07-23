"use client";

import type { ReactNode } from "react";
import type { UserMe } from "@/lib/api/auth";
import { AuthProvider } from "@/lib/hooks/useAuth";
import { QueryProvider } from "@/lib/providers/query-provider";
import { ToastProvider } from "@/components/providers/toast-provider";

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
        <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
      </ToastProvider>
    </QueryProvider>
  );
}
