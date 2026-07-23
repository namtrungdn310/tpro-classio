"use client";

import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

const MIN_SLIDE_DURATION_MS = 320;
const MAX_SLIDE_DURATION_MS = 520;
const SLIDE_SPEED_PX_PER_MS = 2.15;

export const SLIDE_PANEL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export function getSlidePanelDuration(width: number) {
  if (!Number.isFinite(width) || width <= 0) {
    return MIN_SLIDE_DURATION_MS;
  }

  return Math.min(
    MAX_SLIDE_DURATION_MS,
    Math.max(MIN_SLIDE_DURATION_MS, Math.round(width / SLIDE_SPEED_PX_PER_MS)),
  );
}

export function getSlidePanelStyle(durationMs: number): CSSProperties {
  return {
    transitionDuration: `${durationMs}ms`,
    transitionTimingFunction: SLIDE_PANEL_EASING,
  };
}

export function getSlideBackdropStyle(durationMs: number): CSSProperties {
  return {
    transitionDuration: `${durationMs}ms`,
    transitionTimingFunction: "ease-out",
  };
}

export function getSlidePanelUnmountDelay(
  durationMs: number,
  prefersReducedMotion: boolean,
) {
  return prefersReducedMotion ? 0 : durationMs;
}

export function canRevealSlidePanel({
  isOpen,
  isRendered,
  isReady,
}: {
  isOpen: boolean;
  isRendered: boolean;
  isReady: boolean;
}) {
  return isOpen && isRendered && isReady;
}

/**
 * Uses one physical travel speed for every right-side panel. Wider panels get
 * a proportionally longer duration, so compact and wide workflows feel alike.
 */
export function useSlidePanelDuration(
  panelRef: RefObject<HTMLElement | null>,
  isRendered = true,
) {
  return useSlidePanelMotion(panelRef, isRendered).durationMs;
}

export function useSlidePanelMotion(
  panelRef: RefObject<HTMLElement | null>,
  isRendered = true,
) {
  const [motion, setMotion] = useState({
    durationMs: MIN_SLIDE_DURATION_MS,
    isReady: false,
  });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!isRendered || !panel) return;

    const updateDuration = () => {
      const nextDuration = getSlidePanelDuration(panel.getBoundingClientRect().width);
      setMotion((current) =>
        current.durationMs === nextDuration && current.isReady
          ? current
          : { durationMs: nextDuration, isReady: true },
      );
    };

    updateDuration();
    const resizeObserver = new ResizeObserver(updateDuration);
    resizeObserver.observe(panel);
    return () => resizeObserver.disconnect();
  }, [isRendered, panelRef]);

  return motion;
}
