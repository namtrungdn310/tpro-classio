"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getFinancialPrivacyStorageKey, parseFinancialPrivacyValue } from "@/lib/financial-privacy";
import { isManagementUser } from "@/lib/auth/permissions";
import { useAuth } from "@/lib/hooks/useAuth";

type FinancialPrivacyContextValue = {
  canControlFinancialPrivacy: boolean;
  isFinancialPrivacyReady: boolean;
  isFinancialPrivacyHidden: boolean;
  toggleFinancialPrivacy: () => void;
};

const DEFAULT_FINANCIAL_PRIVACY: FinancialPrivacyContextValue = {
  canControlFinancialPrivacy: false,
  isFinancialPrivacyReady: true,
  isFinancialPrivacyHidden: false,
  toggleFinancialPrivacy: () => undefined,
};

const FinancialPrivacyContext = createContext<FinancialPrivacyContextValue>(
  DEFAULT_FINANCIAL_PRIVACY,
);

export function FinancialPrivacyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const canControlFinancialPrivacy = isManagementUser(user);
  const [storedHidden, setStoredHidden] = useState<boolean | null>(null);

  useEffect(() => {
    if (!canControlFinancialPrivacy || !user) {
      setStoredHidden(false);
      return;
    }

    const storageKey = getFinancialPrivacyStorageKey(user.id);
    const sync = () => {
      setStoredHidden(parseFinancialPrivacyValue(window.localStorage.getItem(storageKey)));
    };

    sync();

    function handleStorage(event: StorageEvent) {
      if (event.key === storageKey) {
        sync();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [canControlFinancialPrivacy, user]);

  const isFinancialPrivacyReady = storedHidden !== null;
  const isFinancialPrivacyHidden = canControlFinancialPrivacy && storedHidden === true;

  const toggleFinancialPrivacy = useCallback(() => {
    if (!canControlFinancialPrivacy || !user) {
      return;
    }

    const next = !isFinancialPrivacyHidden;
    window.localStorage.setItem(
      getFinancialPrivacyStorageKey(user.id),
      next ? "hidden" : "visible",
    );
    setStoredHidden(next);
  }, [canControlFinancialPrivacy, isFinancialPrivacyHidden, user]);

  const value = useMemo<FinancialPrivacyContextValue>(
    () => ({
      canControlFinancialPrivacy,
      isFinancialPrivacyReady,
      isFinancialPrivacyHidden,
      toggleFinancialPrivacy,
    }),
    [
      canControlFinancialPrivacy,
      isFinancialPrivacyHidden,
      isFinancialPrivacyReady,
      toggleFinancialPrivacy,
    ],
  );

  return (
    <FinancialPrivacyContext.Provider value={value}>
      {children}
    </FinancialPrivacyContext.Provider>
  );
}

export function useFinancialPrivacy(): FinancialPrivacyContextValue {
  return useContext(FinancialPrivacyContext);
}
