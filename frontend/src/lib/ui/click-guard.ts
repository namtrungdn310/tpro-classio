"use client";

import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

/** Cửa sổ thời gian (ms) sau lần cuối có vùng chọn text để chặn click mở
 *  dialog — bao phủ mọi thứ tự sự kiện của browser (một số browser xóa
 *  selection tại `pointerdown`, số khác tại default action của `mousedown`). */
const SELECTION_BLOCK_WINDOW_MS = 500;

let lastActiveSelectionAt = Number.NEGATIVE_INFINITY;
let selectionListenerCount = 0;

function readHasSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && selection.toString().trim().length > 0);
}

function onDocumentSelectionChange() {
  if (readHasSelection()) {
    lastActiveSelectionAt = performance.now();
  }
}

function ensureSelectionListener() {
  if (selectionListenerCount === 0) {
    document.addEventListener("selectionchange", onDocumentSelectionChange);
  }
  selectionListenerCount += 1;
}

function releaseSelectionListener() {
  selectionListenerCount -= 1;
  if (selectionListenerCount === 0) {
    document.removeEventListener("selectionchange", onDocumentSelectionChange);
  }
}

/** Handlers cho một hàng/bảng clickable. Chặn click mở dialog khi người dùng
 *  đang bôi đen text ở bất kỳ đâu trong danh sách (kéo chuột chọn, hoặc còn
 *  vùng chọn tại lúc nhấn chuột, hoặc vừa bôi xanh trong vài trăm ms) để
 *  tránh vô tình mở nhầm dialog. */
export function useClickableRowProps(onClick?: () => void) {
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const selectionAtPressRef = useRef(false);

  useEffect(() => {
    if (!onClick) {
      return;
    }
    ensureSelectionListener();
    return releaseSelectionListener;
  }, [onClick]);

  function handlePointerDown(event: PointerEvent) {
    pressRef.current = { x: event.clientX, y: event.clientY };
    selectionAtPressRef.current = readHasSelection();
  }

  function handleClick(event: MouseEvent) {
    if (!onClick) {
      return;
    }
    const blockedBySelection =
      selectionAtPressRef.current ||
      performance.now() - lastActiveSelectionAt < SELECTION_BLOCK_WINDOW_MS;
    if (blockedBySelection) {
      selectionAtPressRef.current = false;
      return;
    }
    if (pressRef.current) {
      const moved =
        Math.abs(event.clientX - pressRef.current.x) +
        Math.abs(event.clientY - pressRef.current.y);
      pressRef.current = null;
      if (moved > 4) {
        return;
      }
    }
    onClick();
  }

  return { onClick: handleClick, onPointerDown: handlePointerDown };
}
