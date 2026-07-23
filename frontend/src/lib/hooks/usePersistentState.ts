"use client";

import { Dispatch, SetStateAction, useEffect, useState } from "react";

const memoryState = new Map<string, unknown>();

export function usePersistentState<T>(
  storageKey: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (memoryState.has(storageKey)) {
      return memoryState.get(storageKey) as T;
    }
    return defaultValue;
  });

  useEffect(() => {
    memoryState.set(storageKey, value);
  }, [storageKey, value]);

  return [value, setValue];
}
