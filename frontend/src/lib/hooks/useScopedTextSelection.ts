"use client";

import { useEffect, type RefObject } from "react";

const SCOPE_SELECTOR = '[data-text-selection-scope="true"]';
const VALUE_SELECTOR = '[data-text-selection-value="true"]';
const HOST_SELECTOR = '[role="cell"], [data-text-selection-host="true"]';
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';
const DRAG_THRESHOLD_PX = 3;

type TextPoint = {
  node: Text;
  offset: number;
};

type ActiveDrag = {
  anchor: TextPoint;
  pointerId: number;
  scope: HTMLElement;
  startX: number;
  startY: number;
  valueRoot: HTMLElement;
  hasDragged: boolean;
};

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function getTextNodes(valueRoot: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(valueRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent?.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let currentNode = walker.nextNode();
  while (currentNode) {
    nodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }
  return nodes;
}

function normalizeCaretPoint(
  valueRoot: HTMLElement,
  textNodes: Text[],
  node: Node,
  offset: number,
): TextPoint | null {
  if (node instanceof Text && valueRoot.contains(node) && textNodes.includes(node)) {
    return { node, offset: Math.max(0, Math.min(offset, node.length)) };
  }
  return null;
}

function readCaretPoint(
  valueRoot: HTMLElement,
  textNodes: Text[],
  clientX: number,
  clientY: number,
): TextPoint | null {
  const caretDocument = document as CaretDocument;
  const caretPosition = caretDocument.caretPositionFromPoint?.(clientX, clientY);
  if (caretPosition) {
    const point = normalizeCaretPoint(
      valueRoot,
      textNodes,
      caretPosition.offsetNode,
      caretPosition.offset,
    );
    if (point) {
      return point;
    }
  }

  const caretRange = caretDocument.caretRangeFromPoint?.(clientX, clientY);
  if (caretRange) {
    return normalizeCaretPoint(
      valueRoot,
      textNodes,
      caretRange.startContainer,
      caretRange.startOffset,
    );
  }
  return null;
}

function getTextRects(valueRoot: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(valueRoot);
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
}

function distanceToRect(rect: DOMRect, clientX: number, clientY: number): number {
  const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
  const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
  return dx * dx + dy * dy;
}

function findSelectionScope(
  container: HTMLElement,
  target: Element,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const directScope = target.closest(SCOPE_SELECTOR);
  if (directScope instanceof HTMLElement && container.contains(directScope)) {
    return directScope;
  }

  const host = target.closest(HOST_SELECTOR);
  if (!(host instanceof HTMLElement) || !container.contains(host)) {
    return null;
  }

  return Array.from(host.querySelectorAll<HTMLElement>(SCOPE_SELECTOR)).reduce<HTMLElement | null>(
    (closest, scope) => {
      if (!closest) {
        return scope;
      }
      return distanceToRect(scope.getBoundingClientRect(), clientX, clientY) <
        distanceToRect(closest.getBoundingClientRect(), clientX, clientY)
        ? scope
        : closest;
    },
    null,
  );
}

function findClosestTextPoint(
  scope: HTMLElement,
  valueRoot: HTMLElement,
  clientX: number,
  clientY: number,
): TextPoint | null {
  const textNodes = getTextNodes(valueRoot);
  if (textNodes.length === 0) {
    return null;
  }

  const directPoint = readCaretPoint(valueRoot, textNodes, clientX, clientY);
  if (directPoint) {
    return directPoint;
  }

  const textRects = getTextRects(valueRoot);
  const closestRect = textRects.reduce<DOMRect | null>((closest, rect) => {
    if (!closest) {
      return rect;
    }
    return distanceToRect(rect, clientX, clientY) < distanceToRect(closest, clientX, clientY)
      ? rect
      : closest;
  }, null);

  if (closestRect) {
    const projectedX = Math.max(
      closestRect.left + 0.5,
      Math.min(clientX, closestRect.right - 0.5),
    );
    const projectedY = Math.max(
      closestRect.top + 0.5,
      Math.min(clientY, closestRect.bottom - 0.5),
    );
    const projectedPoint = readCaretPoint(valueRoot, textNodes, projectedX, projectedY);
    if (projectedPoint) {
      return projectedPoint;
    }
  }

  const bounds = scope.getBoundingClientRect();
  const useStart =
    clientY < bounds.top ||
    (clientY <= bounds.bottom && clientX < bounds.left + bounds.width / 2);
  const boundaryNode = useStart ? textNodes[0] : textNodes.at(-1)!;
  return { node: boundaryNode, offset: useStart ? 0 : boundaryNode.length };
}

function compareTextPoints(first: TextPoint, second: TextPoint): number {
  if (first.node === second.node) {
    return first.offset - second.offset;
  }

  const firstRange = document.createRange();
  firstRange.setStart(first.node, first.offset);
  firstRange.collapse(true);
  const secondRange = document.createRange();
  secondRange.setStart(second.node, second.offset);
  secondRange.collapse(true);
  return firstRange.compareBoundaryPoints(Range.START_TO_START, secondRange);
}

function applySelection(anchor: TextPoint, focus: TextPoint): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    return;
  }

  const range = document.createRange();
  if (compareTextPoints(anchor, focus) <= 0) {
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
  } else {
    range.setStart(focus.node, focus.offset);
    range.setEnd(anchor.node, anchor.offset);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function isWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}_]/u.test(character);
}

export function useScopedTextSelection<T extends HTMLElement>(
  containerRef: RefObject<T>,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const selectionContainer: T = container;

    let activeDrag: ActiveDrag | null = null;

    function clearDrag() {
      if (activeDrag?.scope.hasPointerCapture(activeDrag.pointerId)) {
        try {
          activeDrag.scope.releasePointerCapture(activeDrag.pointerId);
        } catch {
          // The row may have been replaced by filtering while a drag was active.
        }
      }
      activeDrag = null;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.button !== 0 ||
        event.pointerType !== "mouse" ||
        event.shiftKey ||
        event.detail > 1
      ) {
        clearDrag();
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        clearDrag();
        return;
      }

      const scope = findSelectionScope(
        selectionContainer,
        target,
        event.clientX,
        event.clientY,
      );
      if (!scope) {
        clearDrag();
        return;
      }

      const valueRoot = scope.querySelector<HTMLElement>(VALUE_SELECTOR);
      if (!valueRoot) {
        clearDrag();
        return;
      }

      const anchor = findClosestTextPoint(
        scope,
        valueRoot,
        event.clientX,
        event.clientY,
      );
      if (!anchor) {
        clearDrag();
        return;
      }

      event.preventDefault();
      applySelection(anchor, anchor);
      activeDrag = {
        anchor,
        pointerId: event.pointerId,
        scope,
        startX: event.clientX,
        startY: event.clientY,
        valueRoot,
        hasDragged: false,
      };
      try {
        scope.setPointerCapture(event.pointerId);
      } catch {
        // Document-level pointer handlers still complete the drag safely.
      }
    }

    function handlePointerMove(event: PointerEvent) {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
        return;
      }
      if (!activeDrag.scope.isConnected || !activeDrag.valueRoot.isConnected) {
        clearDrag();
        return;
      }

      const distance = Math.hypot(
        event.clientX - activeDrag.startX,
        event.clientY - activeDrag.startY,
      );
      if (!activeDrag.hasDragged && distance < DRAG_THRESHOLD_PX) {
        return;
      }

      event.preventDefault();
      activeDrag.hasDragged = true;
      const focus = findClosestTextPoint(
        activeDrag.scope,
        activeDrag.valueRoot,
        event.clientX,
        event.clientY,
      );
      if (focus) {
        applySelection(activeDrag.anchor, focus);
      }
    }

    function handlePointerEnd(event: PointerEvent) {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
        return;
      }

      if (!activeDrag.hasDragged) {
        window.getSelection()?.removeAllRanges();
      }
      clearDrag();
    }

    function handleDoubleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const scope = findSelectionScope(
        selectionContainer,
        target,
        event.clientX,
        event.clientY,
      );
      if (!scope) {
        return;
      }
      const valueRoot = scope.querySelector<HTMLElement>(VALUE_SELECTOR);
      if (!valueRoot) {
        return;
      }

      const point = findClosestTextPoint(scope, valueRoot, event.clientX, event.clientY);
      if (!point || point.node.length === 0) {
        return;
      }

      const text = point.node.data;
      let characterIndex = Math.min(point.offset, text.length - 1);
      if (!isWordCharacter(text[characterIndex]) && characterIndex > 0) {
        characterIndex -= 1;
      }
      if (!isWordCharacter(text[characterIndex])) {
        return;
      }

      let start = characterIndex;
      let end = characterIndex + 1;
      while (start > 0 && isWordCharacter(text[start - 1])) {
        start -= 1;
      }
      while (end < text.length && isWordCharacter(text[end])) {
        end += 1;
      }

      event.preventDefault();
      applySelection(
        { node: point.node, offset: start },
        { node: point.node, offset: end },
      );
    }

    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest(SCOPE_SELECTOR) || target.closest(EDITABLE_SELECTOR)) {
        return;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        selection.removeAllRanges();
      }
    }

    selectionContainer.addEventListener("pointerdown", handlePointerDown);
    selectionContainer.addEventListener("dblclick", handleDoubleClick);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    window.addEventListener("blur", clearDrag);

    return () => {
      clearDrag();
      selectionContainer.removeEventListener("pointerdown", handlePointerDown);
      selectionContainer.removeEventListener("dblclick", handleDoubleClick);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      window.removeEventListener("blur", clearDrag);
    };
  }, [containerRef]);
}
