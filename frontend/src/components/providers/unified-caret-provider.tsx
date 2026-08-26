"use client";

import { useEffect } from "react";
import {
  resolveCaretCssLength,
  resolveSingleLineTextOffset,
  snapCaretCoordinate,
  snapCaretLength,
  supportsUnifiedCaret,
} from "@/lib/forms/unified-caret";

type CaretBox = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type EditableCaretElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLElement;

const ACTIVE_ATTRIBUTE = "data-unified-caret-active";
const CARET_WIDTH_FALLBACK = 1;
const CARET_HEIGHT_FALLBACK = 20;
const LAYOUT_ANIMATION_WINDOW_MS = 400;

/**
 * Renders one shared caret for every editable text control. Geometry is
 * measured from the focused element, then snapped to the device-pixel grid so
 * Windows scaling and browser zoom cannot make identical carets look thicker
 * or lighter depending on their horizontal position.
 */
export function UnifiedCaretProvider() {
  useEffect(() => {
    const overlay = document.createElement("span");
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    const forcedColorsQuery = window.matchMedia("(forced-colors: active)");
    let activeElement: EditableCaretElement | null = null;
    let animationDeadline = 0;
    let isComposing = false;
    let rafId: number | null = null;
    let restartBlinkOnNextUpdate = false;

    overlay.setAttribute("aria-hidden", "true");
    overlay.className = "unified-form-caret";
    overlay.hidden = true;
    document.body.append(overlay);

    function scheduleUpdate() {
      if (rafId !== null) {
        return;
      }

      rafId = window.requestAnimationFrame(updateCaret);
    }

    function scheduleInteractiveUpdate() {
      restartBlinkOnNextUpdate = true;
      scheduleUpdate();
    }

    function scheduleAnimatedUpdate() {
      animationDeadline = performance.now() + LAYOUT_ANIMATION_WINDOW_MS;
      scheduleUpdate();
    }

    function clearRenderedCaret() {
      activeElement?.removeAttribute(ACTIVE_ATTRIBUTE);
      overlay.hidden = true;
    }

    function clearActiveElement() {
      clearRenderedCaret();
      resizeObserver.disconnect();
      activeElement = null;
      restartBlinkOnNextUpdate = false;
    }

    function setActiveElement(element: EditableCaretElement | null) {
      if (activeElement === element) {
        scheduleInteractiveUpdate();
        return;
      }

      clearActiveElement();
      activeElement = element;
      if (!element) {
        return;
      }

      resizeObserver.observe(element);
      restartBlinkOnNextUpdate = true;
      scheduleUpdate();
    }

    function syncActiveElementFromDocument() {
      const focusedElement = document.activeElement;
      const nextElement = isUnifiedCaretElement(focusedElement)
        ? focusedElement
        : null;

      if (nextElement !== activeElement) {
        setActiveElement(nextElement);
      }

      return nextElement;
    }

    function updateCaret(timestamp: number) {
      rafId = null;
      const element = activeElement;

      if (
        !element ||
        document.activeElement !== element ||
        isComposing ||
        forcedColorsQuery.matches ||
        !isUnifiedCaretElement(element)
      ) {
        clearRenderedCaret();
        return;
      }

      const nextBox = getCaretBox(element);
      if (!nextBox) {
        // Never suppress the native caret unless a measured overlay can be
        // committed in the same frame. This prevents a blank caret interval
        // while portals and contenteditable selections are settling.
        clearRenderedCaret();
        return;
      }

      const pixelRatio = window.devicePixelRatio || 1;
      const left = snapCaretCoordinate(nextBox.left, pixelRatio);
      const top = snapCaretCoordinate(nextBox.top, pixelRatio);
      const width = snapCaretLength(nextBox.width, pixelRatio);
      const height = snapCaretLength(nextBox.height, pixelRatio);

      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      overlay.hidden = false;
      element.setAttribute(ACTIVE_ATTRIBUTE, "true");

      if (restartBlinkOnNextUpdate) {
        restartBlinkOnNextUpdate = false;
        restartCaretBlink(overlay);
      }

      if (timestamp < animationDeadline) {
        scheduleUpdate();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      const target = event.target;
      setActiveElement(isUnifiedCaretElement(target) ? target : null);
    }

    function handleFocusOut(event: FocusEvent) {
      if (event.target === activeElement) {
        clearActiveElement();
      }
    }

    function handleElementEvent(event: Event) {
      const eventElement = getUnifiedCaretElementFromEventTarget(event.target);
      if (event.type === "pointerdown" && eventElement) {
        setActiveElement(eventElement);
        return;
      }

      const focusedElement = syncActiveElementFromDocument();
      if (
        focusedElement &&
        isEventInsideActiveElement(event.target, focusedElement)
      ) {
        scheduleInteractiveUpdate();
      }
    }

    function handleSelectionChange() {
      if (syncActiveElementFromDocument()) {
        scheduleInteractiveUpdate();
      }
    }

    function handleCompositionStart(event: CompositionEvent) {
      if (event.target !== activeElement) {
        return;
      }

      isComposing = true;
      clearRenderedCaret();
    }

    function handleCompositionEnd(event: CompositionEvent) {
      if (event.target !== activeElement) {
        return;
      }

      isComposing = false;
      scheduleInteractiveUpdate();
    }

    function handleLayoutAnimation(event: AnimationEvent | TransitionEvent) {
      const target = event.target;
      if (
        activeElement &&
        target instanceof Node &&
        (target === activeElement || target.contains(activeElement))
      ) {
        scheduleAnimatedUpdate();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        syncActiveElementFromDocument();
        scheduleUpdate();
      } else {
        clearRenderedCaret();
      }
    }

    function handleForcedColorsChange() {
      if (forcedColorsQuery.matches) {
        clearRenderedCaret();
      } else {
        syncActiveElementFromDocument();
        scheduleUpdate();
      }
    }

    function handleWindowFocus() {
      syncActiveElementFromDocument();
      scheduleUpdate();
    }

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("beforeinput", handleElementEvent, true);
    document.addEventListener("input", handleElementEvent, true);
    document.addEventListener("keydown", handleElementEvent, true);
    document.addEventListener("keyup", handleElementEvent, true);
    document.addEventListener("pointerdown", handleElementEvent, true);
    document.addEventListener("pointerup", handleElementEvent, true);
    document.addEventListener("select", handleElementEvent, true);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("compositionstart", handleCompositionStart, true);
    document.addEventListener("compositionend", handleCompositionEnd, true);
    document.addEventListener("animationstart", handleLayoutAnimation, true);
    document.addEventListener("transitionrun", handleLayoutAnimation, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", clearRenderedCaret);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate);
    document.fonts?.addEventListener("loadingdone", scheduleUpdate);
    forcedColorsQuery.addEventListener("change", handleForcedColorsChange);

    const initialElement = document.activeElement;
    if (isUnifiedCaretElement(initialElement)) {
      setActiveElement(initialElement);
    }

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      clearActiveElement();
      resizeObserver.disconnect();
      overlay.remove();
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("beforeinput", handleElementEvent, true);
      document.removeEventListener("input", handleElementEvent, true);
      document.removeEventListener("keydown", handleElementEvent, true);
      document.removeEventListener("keyup", handleElementEvent, true);
      document.removeEventListener("pointerdown", handleElementEvent, true);
      document.removeEventListener("pointerup", handleElementEvent, true);
      document.removeEventListener("select", handleElementEvent, true);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("compositionstart", handleCompositionStart, true);
      document.removeEventListener("compositionend", handleCompositionEnd, true);
      document.removeEventListener("animationstart", handleLayoutAnimation, true);
      document.removeEventListener("transitionrun", handleLayoutAnimation, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", clearRenderedCaret);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleUpdate);
      document.fonts?.removeEventListener("loadingdone", scheduleUpdate);
      forcedColorsQuery.removeEventListener("change", handleForcedColorsChange);
    };
  }, []);

  return null;
}

function isEventInsideActiveElement(
  target: EventTarget | null,
  activeElement: EditableCaretElement | null,
) {
  if (!activeElement || !(target instanceof Node)) {
    return false;
  }

  return target === activeElement || activeElement.contains(target);
}

function getUnifiedCaretElementFromEventTarget(
  target: EventTarget | null,
): EditableCaretElement | null {
  if (isUnifiedCaretElement(target)) {
    return target;
  }

  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  const editableHost = element?.closest<HTMLElement>(
    '[contenteditable="true"]',
  );

  if (!editableHost) {
    return null;
  }

  return isUnifiedCaretElement(editableHost) ? editableHost : null;
}

function restartCaretBlink(overlay: HTMLElement) {
  // Native carets restart their visible phase after pointer, keyboard and
  // selection activity. Keep the shared overlay on the same timeline so a
  // click never lands in the invisible half of an older blink cycle.
  for (const animation of overlay.getAnimations()) {
    animation.currentTime = 0;
    if (animation.playState !== "running") {
      animation.play();
    }
  }
}

function isUnifiedCaretElement(
  target: EventTarget | null,
): target is EditableCaretElement {
  if (
    target instanceof HTMLElement &&
    target.closest('[data-unified-caret-opt-out="true"]')
  ) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    return supportsUnifiedCaret({
      disabled: target.disabled,
      readOnly: target.readOnly,
      tagName: target.tagName,
      type: target.type,
    });
  }

  if (target instanceof HTMLTextAreaElement) {
    return supportsUnifiedCaret({
      disabled: target.disabled,
      readOnly: target.readOnly,
      tagName: target.tagName,
    });
  }

  return (
    target instanceof HTMLElement &&
    supportsUnifiedCaret({
      contentEditable: target.contentEditable,
      tagName: target.tagName,
    })
  );
}

function getCaretBox(element: EditableCaretElement): CaretBox | null {
  if (element instanceof HTMLInputElement) {
    return getInputCaretBox(element);
  }

  if (element instanceof HTMLTextAreaElement) {
    return getTextAreaCaretBox(element);
  }

  return getContentEditableCaretBox(element);
}

function getInputCaretBox(input: HTMLInputElement): CaretBox | null {
  if (
    input.selectionStart === null ||
    input.selectionEnd === null ||
    input.selectionStart !== input.selectionEnd
  ) {
    return null;
  }

  const style = window.getComputedStyle(input);
  const rect = input.getBoundingClientRect();
  const scaleX = getElementScale(rect.width, input.offsetWidth);
  const scaleY = getElementScale(rect.height, input.offsetHeight);
  const paddingLeft = parseCssNumber(style.paddingLeft);
  const paddingRight = parseCssNumber(style.paddingRight);
  const textIndent = parseCssNumber(style.textIndent);
  const contentWidth = Math.max(
    0,
    input.clientWidth - paddingLeft - paddingRight,
  );
  const displayedValue = getDisplayedInputValue(input);
  const prefixValue = getDisplayedInputValue(
    input,
    input.value.slice(0, input.selectionStart),
  );
  const fullTextWidth = measureSingleLineText(input, displayedValue);
  const prefixTextWidth = measureSingleLineText(input, prefixValue);
  const alignmentOffset = resolveSingleLineTextOffset({
    contentWidth,
    direction: style.direction,
    textAlign: style.textAlign,
    textWidth: fullTextWidth,
  });
  const contentLeft =
    rect.left + (input.clientLeft + paddingLeft + textIndent) * scaleX;
  const contentRight =
    rect.left + (input.clientLeft + input.clientWidth - paddingRight) * scaleX;
  const unclampedLeft =
    contentLeft +
    (alignmentOffset + prefixTextWidth - input.scrollLeft) * scaleX;
  const caretHeight = getCaretHeight(style) * scaleY;

  return {
    height: caretHeight,
    left: clamp(unclampedLeft, contentLeft, contentRight),
    top: rect.top + (rect.height - caretHeight) / 2,
    width: getCaretWidth(style),
  };
}

function getTextAreaCaretBox(
  textarea: HTMLTextAreaElement,
): CaretBox | null {
  if (
    textarea.selectionStart === null ||
    textarea.selectionEnd === null ||
    textarea.selectionStart !== textarea.selectionEnd
  ) {
    return null;
  }

  const style = window.getComputedStyle(textarea);
  const rect = textarea.getBoundingClientRect();
  const scaleX = getElementScale(rect.width, textarea.offsetWidth);
  const scaleY = getElementScale(rect.height, textarea.offsetHeight);
  const paddingLeft = parseCssNumber(style.paddingLeft);
  const paddingRight = parseCssNumber(style.paddingRight);
  const paddingTop = parseCssNumber(style.paddingTop);
  const paddingBottom = parseCssNumber(style.paddingBottom);
  const contentWidth = Math.max(
    0,
    textarea.clientWidth - paddingLeft - paddingRight,
  );
  const mirror = document.createElement("div");
  const marker = document.createElement("span");

  applyTextMirrorStyles(mirror, style);
  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.left = "-10000px";
  mirror.style.top = "0";
  mirror.style.width = `${contentWidth}px`;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = style.wordBreak;
  mirror.append(
    document.createTextNode(
      textarea.value.slice(0, textarea.selectionStart),
    ),
  );
  marker.textContent = "\u200b";
  mirror.append(marker);
  mirror.append(
    document.createTextNode(textarea.value.slice(textarea.selectionStart)),
  );
  document.body.append(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const markerLeft = markerRect.left - mirrorRect.left;
  const markerTop = markerRect.top - mirrorRect.top;
  mirror.remove();

  const contentLeft =
    rect.left + (textarea.clientLeft + paddingLeft) * scaleX;
  const contentRight =
    rect.left + (textarea.clientLeft + textarea.clientWidth - paddingRight) *
      scaleX;
  const contentTop =
    rect.top + (textarea.clientTop + paddingTop) * scaleY;
  const contentBottom =
    rect.top +
    (textarea.clientTop + textarea.clientHeight - paddingBottom) * scaleY;
  const caretHeight = getCaretHeight(style) * scaleY;
  const left =
    contentLeft + (markerLeft - textarea.scrollLeft) * scaleX;
  const top =
    contentTop + (markerTop - textarea.scrollTop) * scaleY;

  if (
    top + caretHeight < contentTop ||
    top > contentBottom ||
    left < contentLeft - 1 ||
    left > contentRight + 1
  ) {
    return null;
  }

  return {
    height: caretHeight,
    left: clamp(left, contentLeft, contentRight),
    top: clamp(top, contentTop, Math.max(contentTop, contentBottom - caretHeight)),
    width: getCaretWidth(style),
  };
}

function getContentEditableCaretBox(
  element: HTMLElement,
): CaretBox | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) {
    return null;
  }

  const style = window.getComputedStyle(element);
  const hostRect = element.getBoundingClientRect();
  const scaleX = getElementScale(hostRect.width, element.offsetWidth);
  const scaleY = getElementScale(hostRect.height, element.offsetHeight);
  const caretHeight = getCaretHeight(style) * scaleY;
  const directRect = getLastClientRect(range);

  if (directRect && (directRect.width > 0 || directRect.height > 0)) {
    return contentEditableBoxFromRect(
      directRect,
      caretHeight,
      getCaretWidth(style),
    );
  }

  // Collapsed ranges at the edge of an atomic token often have no own rect.
  // Measuring the last rectangle of all content before the range gives the
  // correct boundary without inserting temporary DOM nodes into the editor.
  const precedingRange = range.cloneRange();
  precedingRange.selectNodeContents(element);
  precedingRange.setEnd(range.endContainer, range.endOffset);
  const precedingRect = getLastClientRect(precedingRange);

  if (precedingRect) {
    return {
      height: caretHeight,
      left: precedingRect.right,
      top:
        precedingRect.top +
        (precedingRect.height - caretHeight) / 2,
      width: getCaretWidth(style),
    };
  }

  const paddingLeft = parseCssNumber(style.paddingLeft) * scaleX;
  const paddingTop = parseCssNumber(style.paddingTop) * scaleY;

  return {
    height: caretHeight,
    left: hostRect.left + element.clientLeft * scaleX + paddingLeft,
    top: hostRect.top + element.clientTop * scaleY + paddingTop,
    width: getCaretWidth(style),
  };
}

function contentEditableBoxFromRect(
  rect: DOMRect,
  caretHeight: number,
  caretWidth: number,
): CaretBox {
  return {
    height: caretHeight,
    left: rect.left,
    top: rect.top + (rect.height - caretHeight) / 2,
    width: caretWidth,
  };
}

function getLastClientRect(range: Range) {
  const rects = range.getClientRects();
  return rects.length > 0 ? rects[rects.length - 1] : null;
}

function getDisplayedInputValue(
  input: HTMLInputElement,
  value = input.value,
) {
  if (input.type !== "password") {
    return value;
  }

  return "•".repeat(Array.from(value).length);
}

function measureSingleLineText(source: HTMLElement, text: string) {
  if (!text) {
    return 0;
  }

  const style = window.getComputedStyle(source);
  const mirror = document.createElement("span");
  applyTextMirrorStyles(mirror, style);
  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.left = "-10000px";
  mirror.style.top = "0";
  mirror.style.whiteSpace = "pre";
  mirror.textContent = text;
  document.body.append(mirror);
  const width = mirror.getBoundingClientRect().width;
  mirror.remove();
  return width;
}

function applyTextMirrorStyles(
  element: HTMLElement,
  style: CSSStyleDeclaration,
) {
  element.style.boxSizing = "border-box";
  element.style.direction = style.direction;
  element.style.fontFamily = style.fontFamily;
  element.style.fontFeatureSettings = style.fontFeatureSettings;
  element.style.fontKerning = style.fontKerning;
  element.style.fontSize = style.fontSize;
  element.style.fontStretch = style.fontStretch;
  element.style.fontStyle = style.fontStyle;
  element.style.fontVariant = style.fontVariant;
  element.style.fontVariationSettings = style.fontVariationSettings;
  element.style.fontWeight = style.fontWeight;
  element.style.letterSpacing = style.letterSpacing;
  element.style.lineHeight = style.lineHeight;
  element.style.tabSize = style.tabSize;
  element.style.textAlign = style.textAlign;
  element.style.textIndent = style.textIndent;
  element.style.textRendering = style.textRendering;
  element.style.textTransform = style.textTransform;
  element.style.wordSpacing = style.wordSpacing;
}

function getCaretHeight(style: CSSStyleDeclaration) {
  const customHeight = parseCssLength(
    style.getPropertyValue("--form-caret-height"),
    style,
  );
  if (customHeight > 0) {
    return customHeight;
  }

  const lineHeight = parseCssNumber(style.lineHeight);
  if (lineHeight > 0) {
    return lineHeight;
  }

  const fontSize = parseCssNumber(style.fontSize);
  return fontSize > 0 ? fontSize * 1.25 : CARET_HEIGHT_FALLBACK;
}

function getCaretWidth(style: CSSStyleDeclaration) {
  const customWidth = parseCssLength(
    style.getPropertyValue("--form-caret-width"),
    style,
  );
  return customWidth > 0 ? customWidth : CARET_WIDTH_FALLBACK;
}

function getElementScale(renderedSize: number, layoutSize: number) {
  if (renderedSize <= 0 || layoutSize <= 0) {
    return 1;
  }

  return renderedSize / layoutSize;
}

function parseCssNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCssLength(
  value: string,
  style: CSSStyleDeclaration,
) {
  return resolveCaretCssLength(value, {
    elementFontSize: parseCssNumber(style.fontSize),
    rootFontSize: parseCssNumber(
      window.getComputedStyle(document.documentElement).fontSize,
    ),
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
