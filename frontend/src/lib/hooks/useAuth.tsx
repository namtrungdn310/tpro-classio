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
import type { UserMe } from "@/lib/api/auth";

type AuthContextValue = {
  user: UserMe | null;
  isLoading: boolean;
  getMeSilently: () => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function clearAuthStorage(): void {
  window.localStorage.removeItem("tpro_token");
  window.localStorage.removeItem("tpro_refresh_token");
}

type TokenPayload = {
  sub?: string;
  email?: string;
  full_name?: string | null;
  role?: string;
  exp?: number;
};

function decodeToken(token: string): TokenPayload | null {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) {
      return null;
    }

    const normalizedPayload = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(window.atob(normalizedPayload)) as TokenPayload;
  } catch {
    return null;
  }
}

function isTokenExpired(payload: TokenPayload): boolean {
  return payload.exp ? payload.exp * 1000 <= Date.now() : true;
}

function getUserFromPayload(payload: TokenPayload): UserMe | null {
  if (!payload.sub || !payload.email || !payload.role) {
    return null;
  }

  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    full_name: payload.full_name ?? null,
  };
}

function getUserFromToken(
  token: string | null = window.localStorage.getItem("tpro_token"),
  options: { allowExpired?: boolean } = {},
): UserMe | null {
  if (!token) {
    return null;
  }

  const payload = decodeToken(token);
  if (!payload || (!options.allowExpired && isTokenExpired(payload))) {
    return null;
  }

  return getUserFromPayload(payload);
}

function getInitialUser(): UserMe | null {
  if (typeof window === "undefined") {
    return null;
  }

  return getUserFromToken() ?? getUserFromToken(window.localStorage.getItem("tpro_token"), {
    allowExpired: true,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(() => getInitialUser());
  const [isLoading, setIsLoading] = useState(false);

  const loadUser = useCallback(async () => {
    const cachedUser = getUserFromToken();
    if (cachedUser) {
      setUser(cachedUser);
      setIsLoading(false);
      return;
    }

    const refreshTokenValue = window.localStorage.getItem("tpro_refresh_token");
    if (!refreshTokenValue) {
      clearAuthStorage();
      setUser(null);
      setIsLoading(false);
      return;
    }

    const expiredUser = getUserFromToken(window.localStorage.getItem("tpro_token"), {
      allowExpired: true,
    });
    if (expiredUser) {
      setUser(expiredUser);
      setIsLoading(false);
    }

    try {
      const { refreshToken } = await import("@/lib/api/auth");
      const data = await refreshToken(refreshTokenValue);
      window.localStorage.setItem("tpro_token", data.access_token);
      window.localStorage.setItem("tpro_refresh_token", data.refresh_token);
      setUser(getUserFromToken(data.access_token));
    } catch {
      clearAuthStorage();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === "tpro_token") {
        void loadUser();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [loadUser]);

  const handleLogout = useCallback(() => {
    clearAuthStorage();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      getMeSilently: async () => loadUser(),
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
