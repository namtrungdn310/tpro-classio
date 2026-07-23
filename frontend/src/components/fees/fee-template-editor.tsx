"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FEE_TEMPLATE_CARET_BOUNDARY,
  stripFeeTemplateCaretBoundaries,
} from "@/lib/fees/editor-caret-boundary";
import { tokenizeFeeMessageTemplate } from "@/lib/fees/message-templates";

export type FeeTemplateEditorHandle = {
  insertToken: (token: string, label: string) => void;
};

type FeeTemplateEditorProps = {
  ariaDescribedBy?: string;
  ariaInvalid: boolean;
  disabled: boolean;
  id: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  value: string;
};

export const FeeTemplateEditor = forwardRef<
  FeeTemplateEditorHandle,
  FeeTemplateEditorProps
>(function FeeTemplateEditor(
  { ariaDescribedBy, ariaInvalid, disabled, id, onBlur, onChange, value },
  forwardedRef,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastRangeRef = useRef<Range | null>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || serializeEditor(editor) === value) {
      return;
    }
    renderEditor(editor, value);
  }, [value]);

  useEffect(() => {
    const mountedEditor = editorRef.current;
    if (!mountedEditor) return;
    const editor: HTMLDivElement = mountedEditor;
    const ownerDocument = editor.ownerDocument;

    function clearEditorSelectionOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || editor.contains(target)) return;
      const control =
        target instanceof Element
          ? target.closest<HTMLElement>("[data-fee-template-editor-control]")
          : null;
      if (control?.dataset.feeTemplateEditorControl === id) return;

      const selection = ownerDocument.getSelection();
      if (!selectionTouchesEditor(editor, selection)) return;
      selection?.removeAllRanges();
      if (ownerDocument.activeElement === editor) editor.blur();
    }

    ownerDocument.addEventListener(
      "pointerdown",
      clearEditorSelectionOnOutsidePointer,
      true,
    );
    return () => {
      ownerDocument.removeEventListener(
        "pointerdown",
        clearEditorSelectionOnOutsidePointer,
        true,
      );
    };
  }, [id]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      insertToken(token, label) {
        const editor = editorRef.current;
        if (!editor || disabled) {
          return;
        }

        const chip = createTokenChip(token, label);
        insertNodesAtCaret(
          editor,
          [chip, createTokenCaretBoundary()],
          lastRangeRef.current,
        );
        editor.focus();
        rememberSelection(editor, lastRangeRef);
        onChange(serializeEditor(editor));
      },
    }),
    [disabled, onChange],
  );

  function handleInput() {
    const editor = editorRef.current;
    if (!editor) return;
    rememberSelection(editor, lastRangeRef);
    onChange(serializeEditor(editor));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const editor = editorRef.current;
    if (event.key === "Backspace" || event.key === "Delete") {
      if (editor && deleteSelectionWithWholeTokens(editor)) {
        event.preventDefault();
        rememberSelection(editor, lastRangeRef);
        onChange(serializeEditor(editor));
      }
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (!editor) return;
    insertLineAtCaret(editor, lastRangeRef.current);
    rememberSelection(editor, lastRangeRef);
    onChange(serializeEditor(editor));
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const editor = editorRef.current;
    if (!editor) return;
    const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    insertTextAtCaret(editor, text, lastRangeRef.current);
    rememberSelection(editor, lastRangeRef);
    onChange(serializeEditor(editor));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const editor = editorRef.current;
    if (!editor) return;
    normalizeTokenSelection(editor, event);
    rememberSelection(editor, lastRangeRef);
  }

  return (
    <div
      ref={editorRef}
      id={id}
      role="textbox"
      aria-multiline="true"
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedBy}
      aria-disabled={disabled || undefined}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onBlur={() => {
        rememberSelection(editorRef.current, lastRangeRef);
        onBlur?.();
      }}
      onKeyUp={() => {
        if (editorRef.current) normalizeTokenSelection(editorRef.current);
        rememberSelection(editorRef.current, lastRangeRef);
      }}
      onPointerUp={handlePointerUp}
      className="form-input-text scrollbar-hidden mt-2 h-52 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-gray-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200 aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-100 aria-disabled:bg-gray-50"
    />
  );
});

function renderEditor(editor: HTMLDivElement, value: string) {
  // A block per logical line keeps token boundaries independent from the
  // previous line; an atomic token placed directly after <br> is ambiguous in Blink.
  const fragment = document.createDocumentFragment();
  for (const valueLine of value.split("\n")) {
    fragment.append(createEditorLine(valueLine));
  }
  editor.replaceChildren(fragment);
}

function createEditorLine(value = ""): HTMLDivElement {
  const line = document.createElement("div");
  line.dataset.feeTemplateLine = "";
  appendTemplateText(line, value);
  ensureLineContent(line);
  return line;
}

function appendTemplateText(parent: Node, value: string): Node[] {
  const nodes = createTemplateNodes(value);
  for (const node of nodes) parent.appendChild(node);
  return nodes;
}

function createTemplateNodes(value: string): Node[] {
  const nodes: Node[] = [];
  for (const segment of tokenizeFeeMessageTemplate(value)) {
    if (segment.type === "token") {
      nodes.push(
        createTokenChip(segment.value, segment.label),
        createTokenCaretBoundary(),
      );
    } else {
      nodes.push(document.createTextNode(segment.value));
    }
  }
  return nodes;
}

function createTokenChip(token: string, label: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.dataset.feeTemplateToken = token;
  chip.contentEditable = "false";
  chip.setAttribute("aria-label", label);
  chip.draggable = false;
  chip.className = "inline cursor-text whitespace-nowrap leading-5";

  const labelElement = document.createElement("span");
  labelElement.setAttribute("aria-hidden", "true");
  labelElement.textContent = label;
  labelElement.className =
    "inline-block rounded-md bg-gray-100 px-1.5 text-[14px] font-medium leading-5 text-gray-700";
  chip.append(labelElement);
  return chip;
}

function createTokenCaretBoundary(): Text {
  return document.createTextNode(FEE_TEMPLATE_CARET_BOUNDARY);
}

function isTokenCaretBoundary(node: Node | null): node is Text {
  return (
    node?.nodeType === Node.TEXT_NODE &&
    (node.textContent ?? "").includes(FEE_TEMPLATE_CARET_BOUNDARY)
  );
}

function insertNodesAtCaret(
  editor: HTMLDivElement,
  nodes: Node[],
  savedRange: Range | null,
) {
  const selection = window.getSelection();
  const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const sourceRange = isRangeInside(editor, currentRange)
    ? currentRange
    : isRangeInside(editor, savedRange)
      ? savedRange
      : rangeAtEnd(editor);
  const range = rangeForMutation(editor, sourceRange);

  deleteRangeContents(editor, range);
  const line = closestEditorLine(editor, range.startContainer);
  if (line) removeLinePlaceholder(line);
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    fragment.append(node);
  }
  const lastNode = nodes.at(-1);
  range.insertNode(fragment);
  if (lastNode) {
    if (isTokenCaretBoundary(lastNode)) {
      range.setStart(lastNode, FEE_TEMPLATE_CARET_BOUNDARY.length);
    } else {
      range.setStartAfter(lastNode);
    }
  }
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertLineAtCaret(editor: HTMLDivElement, savedRange: Range | null) {
  const selection = window.getSelection();
  const sourceRange = getActiveRange(editor, selection, savedRange);
  const range = rangeForMutation(editor, sourceRange);
  deleteRangeContents(editor, range);

  const line = closestEditorLine(editor, range.startContainer);
  if (!line) {
    const nextLine = createEditorLine();
    editor.append(nextLine);
    placeCaretAtLineStart(selection, nextLine);
    return;
  }

  removeLinePlaceholder(line);
  const trailingRange = document.createRange();
  trailingRange.setStart(range.startContainer, range.startOffset);
  trailingRange.setEnd(line, line.childNodes.length);
  const trailingContent = trailingRange.extractContents();

  const nextLine = createEditorLine();
  removeLinePlaceholder(nextLine);
  nextLine.append(trailingContent);
  ensureLineContent(nextLine);
  ensureLineContent(line);
  line.after(nextLine);
  placeCaretAtLineStart(selection, nextLine);
}

function insertTextAtCaret(
  editor: HTMLDivElement,
  text: string,
  savedRange: Range | null,
) {
  const textLines = text.split("\n");
  if (textLines.length === 1) {
    insertNodesAtCaret(editor, createTemplateNodes(text), savedRange);
    return;
  }

  const selection = window.getSelection();
  const sourceRange = getActiveRange(editor, selection, savedRange);
  const range = rangeForMutation(editor, sourceRange);
  deleteRangeContents(editor, range);
  const firstLine = closestEditorLine(editor, range.startContainer);
  if (!firstLine) {
    const newLines = textLines.map((line) => createEditorLine(line));
    editor.append(...newLines);
    placeCaretAtLineEnd(selection, newLines.at(-1) ?? firstLine);
    return;
  }

  removeLinePlaceholder(firstLine);
  const trailingRange = document.createRange();
  trailingRange.setStart(range.startContainer, range.startOffset);
  trailingRange.setEnd(firstLine, firstLine.childNodes.length);
  const trailingContent = trailingRange.extractContents();

  const firstInsertedNodes = createTemplateNodes(textLines[0]);
  const firstFragment = document.createDocumentFragment();
  firstFragment.append(...firstInsertedNodes);
  range.insertNode(firstFragment);
  ensureLineContent(firstLine);

  let currentLine = firstLine;
  let lastInsertedNode = firstInsertedNodes.at(-1) ?? null;
  for (const valueLine of textLines.slice(1)) {
    const nextLine = createEditorLine(valueLine);
    currentLine.after(nextLine);
    currentLine = nextLine;
    const lineNodes = Array.from(nextLine.childNodes).filter(
      (node) => !isLinePlaceholder(node),
    );
    lastInsertedNode = lineNodes.at(-1) ?? null;
  }

  removeLinePlaceholder(currentLine);
  const caretOffset = currentLine.childNodes.length;
  currentLine.append(trailingContent);
  ensureLineContent(currentLine);

  const caretRange = document.createRange();
  if (lastInsertedNode?.parentNode === currentLine) {
    caretRange.setStartAfter(lastInsertedNode);
  } else {
    caretRange.setStart(currentLine, caretOffset);
  }
  caretRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
}

function getActiveRange(
  editor: HTMLDivElement,
  selection: Selection | null,
  savedRange: Range | null,
): Range {
  const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
  return isRangeInside(editor, currentRange)
    ? currentRange
    : isRangeInside(editor, savedRange)
      ? savedRange
      : rangeAtEnd(editor);
}

function deleteRangeContents(editor: HTMLDivElement, range: Range) {
  const startLine = closestEditorLine(editor, range.startContainer);
  const endLine = closestEditorLine(editor, range.endContainer);
  range.deleteContents();
  range.collapse(true);

  if (!startLine || !endLine || startLine === endLine || !endLine.isConnected) {
    return;
  }

  removeLinePlaceholder(startLine);
  removeLinePlaceholder(endLine);
  startLine.append(...Array.from(endLine.childNodes));
  endLine.remove();
  ensureLineContent(startLine);
}

function rememberSelection(
  editor: HTMLDivElement | null,
  rangeRef: { current: Range | null },
) {
  if (!editor) return;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (isRangeInside(editor, range)) {
    rangeRef.current = range.cloneRange();
  }
}

function selectionTouchesEditor(
  editor: HTMLDivElement,
  selection: Selection | null,
): boolean {
  if (!selection?.rangeCount) return false;
  if (
    (selection.anchorNode && editor.contains(selection.anchorNode)) ||
    (selection.focusNode && editor.contains(selection.focusNode))
  ) {
    return true;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(editor)) return true;
  }
  return false;
}

function normalizeTokenSelection(
  editor: HTMLDivElement,
  pointerEvent?: ReactPointerEvent<HTMLDivElement>,
) {
  const selection = window.getSelection();
  const sourceRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!selection || !sourceRange || !isRangeInside(editor, sourceRange)) {
    return;
  }

  if (sourceRange.collapsed) {
    const target =
      pointerEvent?.target instanceof Node
        ? closestTokenElement(editor, pointerEvent.target)
        : null;
    const boundaryToken = closestTokenElement(editor, sourceRange.startContainer);
    const token = target ?? boundaryToken;
    if (!token) return;

    const placeAfter = pointerEvent
      ? pointerEvent.clientX >= token.getBoundingClientRect().left + token.offsetWidth / 2
      : sourceRange.startOffset >= (token.textContent?.length ?? 0) / 2;
    placeCaretAtTokenEdge(selection, token, placeAfter ? "after" : "before");
    return;
  }

  const range = sourceRange.cloneRange();
  const startToken = tokenAtRangeBoundary(editor, range, "start");
  const endToken = tokenAtRangeBoundary(editor, range, "end");
  if (!startToken && !endToken) {
    return;
  }

  const isBackward =
    selection.anchorNode === sourceRange.endContainer &&
    selection.anchorOffset === sourceRange.endOffset;
  if (startToken) range.setStartBefore(startToken);
  if (endToken) range.setEndAfter(endToken);
  applySelectionRange(selection, range, isBackward);
}

function placeCaretAtTokenEdge(
  selection: Selection,
  token: HTMLElement,
  edge: "before" | "after",
) {
  const range = document.createRange();
  if (edge === "before") {
    range.setStartBefore(token);
  } else {
    const boundary = getOrCreateTokenCaretBoundary(token);
    range.setStart(boundary, FEE_TEMPLATE_CARET_BOUNDARY.length);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getOrCreateTokenCaretBoundary(token: HTMLElement): Text {
  if (isTokenCaretBoundary(token.nextSibling)) {
    return token.nextSibling;
  }
  const boundary = createTokenCaretBoundary();
  token.after(boundary);
  return boundary;
}

function applySelectionRange(
  selection: Selection,
  range: Range,
  backward: boolean,
) {
  selection.removeAllRanges();
  if (backward && typeof selection.extend === "function") {
    selection.collapse(range.endContainer, range.endOffset);
    selection.extend(range.startContainer, range.startOffset);
    return;
  }
  selection.addRange(range);
}

function deleteSelectionWithWholeTokens(editor: HTMLDivElement | null): boolean {
  if (!editor) return false;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || range.collapsed || !isRangeInside(editor, range)) {
    return false;
  }

  const tokens = Array.from(
    editor.querySelectorAll<HTMLElement>("[data-fee-template-token]"),
  ).filter((token) => range.intersectsNode(token));
  if (tokens.length === 0) {
    return false;
  }

  const mutationRange = rangeForMutation(editor, range);
  deleteRangeContents(editor, mutationRange);
  mutationRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(mutationRange);
  return true;
}

function rangeForMutation(editor: HTMLDivElement, source: Range): Range {
  const range = source.cloneRange();
  const startToken = tokenAtRangeBoundary(editor, range, "start");
  const endToken = tokenAtRangeBoundary(editor, range, "end");
  if (startToken) {
    range.setStartBefore(startToken);
  }
  if (endToken) {
    range.setEndAfter(endToken);
  }
  return range;
}

function tokenAtRangeBoundary(
  editor: HTMLDivElement,
  range: Range,
  boundary: "start" | "end",
): HTMLElement | null {
  const container = boundary === "start" ? range.startContainer : range.endContainer;
  const offset = boundary === "start" ? range.startOffset : range.endOffset;
  const nestedToken = closestTokenElement(editor, container);
  if (nestedToken) {
    return nestedToken;
  }
  if (!(container instanceof Element)) {
    return null;
  }
  const child =
    boundary === "start" ? container.childNodes[offset] : container.childNodes[offset - 1];
  return child ? closestTokenElement(editor, child) : null;
}

function closestTokenElement(
  editor: HTMLDivElement,
  node: Node,
): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const token = element?.closest<HTMLElement>("[data-fee-template-token]") ?? null;
  return token && editor.contains(token) ? token : null;
}

function isRangeInside(editor: HTMLDivElement, range: Range | null): range is Range {
  return Boolean(range && editor.contains(range.commonAncestorContainer));
}

function rangeAtEnd(editor: HTMLDivElement): Range {
  const range = document.createRange();
  const lastLine = Array.from(editor.children)
    .reverse()
    .find(isEditorLine);
  range.selectNodeContents(lastLine ?? editor);
  range.collapse(false);
  return range;
}

function closestEditorLine(
  editor: HTMLDivElement,
  node: Node,
): HTMLDivElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const line =
    element?.closest<HTMLDivElement>("[data-fee-template-line]") ?? null;
  return line && editor.contains(line) ? line : null;
}

function isEditorLine(element: Element): element is HTMLDivElement {
  return (
    element instanceof HTMLDivElement &&
    element.dataset.feeTemplateLine !== undefined
  );
}

function createLinePlaceholder(): HTMLBRElement {
  const placeholder = document.createElement("br");
  placeholder.dataset.feeTemplatePlaceholder = "";
  return placeholder;
}

function isLinePlaceholder(node: Node): boolean {
  return (
    node instanceof HTMLElement &&
    node.dataset.feeTemplatePlaceholder !== undefined
  );
}

function removeLinePlaceholder(line: HTMLDivElement) {
  for (const placeholder of line.querySelectorAll(
    ":scope > [data-fee-template-placeholder]",
  )) {
    placeholder.remove();
  }
}

function ensureLineContent(line: HTMLDivElement) {
  if (!line.hasChildNodes()) {
    line.append(createLinePlaceholder());
  }
}

function placeCaretAtLineStart(
  selection: Selection | null,
  line: HTMLDivElement,
) {
  const range = document.createRange();
  range.setStart(line, 0);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function placeCaretAtLineEnd(
  selection: Selection | null,
  line: HTMLDivElement | null,
) {
  if (!line) return;
  const range = document.createRange();
  range.selectNodeContents(line);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function serializeEditor(editor: HTMLDivElement): string {
  const childNodes = Array.from(editor.childNodes);
  if (
    childNodes.length > 0 &&
    childNodes.every(
      (node) => node instanceof HTMLDivElement && isEditorLine(node),
    )
  ) {
    return childNodes.map(serializeLine).join("\n");
  }
  return childNodes.map(serializeNode).join("");
}

function serializeLine(node: Node): string {
  if (!(node instanceof HTMLElement)) return serializeNode(node);
  if (
    node.childNodes.length === 1 &&
    (isLinePlaceholder(node.firstChild as Node) ||
      (node.firstChild instanceof HTMLBRElement && !node.firstChild.nextSibling))
  ) {
    return "";
  }
  return Array.from(node.childNodes).map(serializeNode).join("");
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return stripFeeTemplateCaretBoundaries(node.textContent ?? "");
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  if (isLinePlaceholder(node)) {
    return "";
  }
  const token = node.dataset.feeTemplateToken;
  if (token) {
    return token;
  }
  if (node.tagName === "BR") {
    return "\n";
  }
  const content = Array.from(node.childNodes).map(serializeNode).join("");
  return node.tagName === "DIV" || node.tagName === "P" ? `${content}\n` : content;
}
