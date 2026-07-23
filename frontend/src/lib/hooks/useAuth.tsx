"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getMe, logout as logoutRequest, type UserMe } from "@/lib/api/auth";
import { announceAuthChanged, isAuthBroadcastStorageKey } from "@/lib/auth/session";
import {
  buildSessionReplacedLoginUrl,
  classifyAuthFailure,
} from "@/lib/api/errors";
import { forgetRememberedStudentClass } from "@/lib/students/selected-class-route";

const WAKE_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

function isPublicAuthPage(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/otp") ||
    pathname.startsWith("/onboarding")
  );
}

type AuthContextValue = {
  user: UserMe | null;
  isLoading: boolean;
  isLoggingOut: boolean;
  isSessionUnavailable: boolean;
  getMeSilently: () => Promise<void>;
  /** Alias for getMeSilently — use after completing an auth step to update user state. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser: UserMe | null;
}) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<UserMe | null>(initialUser);
  const [isLoading, setIsLoading] = useState(initialUser === null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isSessionUnavailable, setIsSessionUnavailable] = useState(false);
  const lastWakeRefreshAtRef = useRef(0);
  const logoutInFlightRef = useRef(false);

  const resetAuthState = useCallback(
    (broadcast = false) => {
      queryClient.clear();
      setUser(null);
      setIsLoading(false);
      setIsSessionUnavailable(false);
      if (broadcast) {
        announceAuthChanged();
      }
    },
    [queryClient],
  );

  const loadUser = useCallback(async () => {
    try {
      const currentUser = await getMe();
      setUser(currentUser);
      setIsSessionUnavailable(false);
    } catch (error) {
      const failureKind = classifyAuthFailure(error);
      if (failureKind === "transient") {
        setIsSessionUnavailable(true);
      } else {
        queryClient.clear();
        setUser(null);
        setIsSessionUnavailable(false);
        if (
          typeof window !== "undefined" &&
          failureKind === "session-replaced" &&
          !isPublicAuthPage(window.location.pathname)
        ) {
          window.location.href = buildSessionReplacedLoginUrl();
          return;
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (typeof window !== "undefined" && !initialUser && isPublicAuthPage(window.location.pathname)) {
      setIsLoading(false);
      return;
    }

    if (initialUser) {
      setUser(initialUser);
      setIsLoading(false);
      void loadUser();
      return;
    }

    void loadUser();
  }, [initialUser, loadUser]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (isAuthBroadcastStorageKey(event.key)) {
        forgetRememberedStudentClass(user?.id);
        void loadUser();
      }
    }

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadUser, user?.id]);

  useEffect(() => {
    function shouldRefreshOnWake() {
      return user !== null && Date.now() - lastWakeRefreshAtRef.current >= WAKE_REFRESH_INTERVAL_MS;
    }

    function refreshOnWake() {
      if (!shouldRefreshOnWake()) {
        return;
      }

      lastWakeRefreshAtRef.current = Date.now();
      void loadUser();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshOnWake();
      }
    }

    window.addEventListener("focus", refreshOnWake);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshOnWake);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadUser, user]);

  const handleLogout = useCallback(async () => {
    if (logoutInFlightRef.current) return;

    logoutInFlightRef.current = true;
    setIsLoggingOut(true);
    // Stop protected requests before the BFF clears the session cookies. This
    // prevents page-level queries from briefly rendering their 401 error state
    // while the browser is leaving the dashboard.
    try {
      await queryClient.cancelQueries();
    } catch {
      // Cancellation is best-effort; it must never block credential revocation.
    }

    try {
      await logoutRequest();
    } catch {
      // The BFF clears browser credentials even when upstream revocation is
      // temporarily unavailable. Local logout must still complete.
    } finally {
      forgetRememberedStudentClass(user?.id);
      resetAuthState(true);
      if (typeof window !== "undefined") {
        window.location.replace("/login");
      }
    }
  }, [queryClient, resetAuthState, user?.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isLoggingOut,
      isSessionUnavailable,
      getMeSilently: loadUser,
      refresh: loadUser,
      logout: handleLogout,
    }),
    [handleLogout, isLoading, isLoggingOut, isSessionUnavailable, loadUser, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
