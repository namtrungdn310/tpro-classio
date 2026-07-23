"use client";

import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function HeaderControlsPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById("dashboard-header-controls"));
  }, []);

  if (!target) {
    return null;
  }

  return createPortal(children, target);
}
