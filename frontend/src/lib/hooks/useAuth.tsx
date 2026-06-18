"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getMe, logout as clearAuthStorage } from "@/lib/api/auth";
import type { UserMe } from "@/lib/api/auth";

type AuthContextValue = {
  user: UserMe | null;
  isLoading: boolean;
  getMeSilently: () => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = useCallback(async (showLoading: boolean) => {
    const token = window.localStorage.getItem("tpro_token");
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    if (showLoading) {
      setIsLoading(true);
    }

    try {
      const currentUser = await getMe();
      setUser(currentUser);
    } catch {
      clearAuthStorage();
      setUser(null);
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadUser(true);
  }, [loadUser]);

  const handleLogout = useCallback(() => {
    clearAuthStorage();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      getMeSilently: () => loadUser(false),
      logout: handleLogout,
    }),
    [handleLogout, isLoading, loadUser, user],
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
