"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { DecorationSet, EditorView } from "@codemirror/view";
import { cn } from "@/lib/utils";

export type FeeMessageCodeEditorHandle = {
  insertToken: (token: string, label: string) => void;
};

type Props = {
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid: boolean;
  disabled: boolean;
  id: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  value: string;
};

export const FeeMessageCodeEditor = forwardRef<FeeMessageCodeEditorHandle, Props>(
  function FeeMessageCodeEditor(
    { ariaDescribedBy, ariaInvalid, ariaLabel, disabled, id, onBlur, onChange, value },
    forwardedRef,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const valueRef = useRef(value);
    const onChangeRef = useRef(onChange);
    const onBlurRef = useRef(onBlur);
    const initialAriaRef = useRef({ ariaDescribedBy, ariaInvalid, ariaLabel });
    valueRef.current = value;
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;

    useImperativeHandle(forwardedRef, () => ({
      insertToken(token) {
        const view = viewRef.current;
        if (!view || disabled) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: token },
          selection: { anchor: from + token.length },
          scrollIntoView: true,
        });
        view.focus();
      },
    }), [disabled]);

    useEffect(() => {
      let disposed = false;
      let view: EditorView | null = null;
      const host = hostRef.current;
      if (!host) return;
      const initialAria = initialAriaRef.current;

      void Promise.all([
        import("@codemirror/state"),
        import("@codemirror/view"),
        import("@codemirror/commands"),
      ]).then(([stateModule, viewModule, commandsModule]) => {
        if (disposed) return;
        const { EditorState } = stateModule;
        const { EditorView, keymap, lineNumbers, Decoration, ViewPlugin } = viewModule;
        const { defaultKeymap, history, historyKeymap, insertNewline } = commandsModule;
        const tokenMark = Decoration.mark({ class: "cm-fee-token" });
        const tokenPlugin = ViewPlugin.fromClass(class {
          decorations;
          constructor(editorView: EditorView) {
            this.decorations = buildTokenDecorations(editorView, Decoration, tokenMark);
          }
          update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
            if (update.docChanged || update.viewportChanged) {
              this.decorations = buildTokenDecorations(update.view, Decoration, tokenMark);
            }
          }
        }, { decorations: (plugin) => plugin.decorations });
        view = new EditorView({
          parent: host,
          state: EditorState.create({
            doc: valueRef.current,
            extensions: [
              lineNumbers(),
              EditorView.lineWrapping,
              history(),
              tokenPlugin,
              keymap.of([
                { key: "Enter", run: insertNewline },
                { key: "Shift-Enter", run: insertNewline },
                ...historyKeymap,
                ...defaultKeymap.filter((binding) => binding.key !== "Tab"),
              ]),
              EditorState.readOnly.of(disabled),
              EditorView.contentAttributes.of({
                id,
                "aria-multiline": "true",
                ...(initialAria.ariaDescribedBy
                  ? { "aria-describedby": initialAria.ariaDescribedBy }
                  : {}),
                ...(initialAria.ariaInvalid ? { "aria-invalid": "true" } : {}),
                ...(initialAria.ariaLabel ? { "aria-label": initialAria.ariaLabel } : {}),
                "data-unified-caret-opt-out": "true",
                "data-selection-policy": "preserve",
              }),
              EditorView.updateListener.of((update) => {
                if (update.docChanged) onChangeRef.current(update.state.doc.toString());
                if (update.focusChanged && !update.view.hasFocus) onBlurRef.current?.();
              }),
              EditorView.theme({
                "&": { height: "13rem", fontSize: "16px", backgroundColor: disabled ? "#f9fafb" : "white" },
                ".cm-scroller": { overflow: "auto", fontFamily: "inherit", lineHeight: "1.5" },
                ".cm-content": { padding: "10px 12px", caretColor: "#0b3996" },
                ".cm-gutters": { backgroundColor: "#fbfcfe", color: "#98a2b3", borderRight: "1px solid #e5e7eb" },
                ".cm-lineNumbers .cm-gutterElement": { minWidth: "2.5rem", padding: "0 10px 0 6px" },
                ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
                ".cm-focused": { outline: "none" },
                ".cm-fee-token": { backgroundColor: "#f3f4f6", borderRadius: "6px", color: "#4b5563", padding: "1px 4px", fontWeight: "500" },
              }),
            ],
          }),
        });
        viewRef.current = view;
      });

      return () => {
        disposed = true;
        view?.destroy();
        viewRef.current = null;
      };
    }, [disabled, id]);

    useEffect(() => {
      const editable = hostRef.current?.querySelector<HTMLElement>(".cm-content");
      if (!editable) return;
      if (ariaDescribedBy) editable.setAttribute("aria-describedby", ariaDescribedBy);
      else editable.removeAttribute("aria-describedby");
      if (ariaLabel) editable.setAttribute("aria-label", ariaLabel);
      else editable.removeAttribute("aria-label");
      if (ariaInvalid) editable.setAttribute("aria-invalid", "true");
      else editable.removeAttribute("aria-invalid");
    }, [ariaDescribedBy, ariaInvalid, ariaLabel]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view || view.state.doc.toString() === value) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }, [value]);

    return (
      <div
        className={cn(
          "mt-2 h-52 w-full overflow-hidden rounded-lg border bg-white transition focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15",
          ariaInvalid ? "border-destructive ring-2 ring-destructive/15" : "border-gray-200",
        )}
      >
        <div ref={hostRef} className="h-full" />
      </div>
    );
  },
);

function buildTokenDecorations(
  view: EditorView,
  DecorationClass: typeof import("@codemirror/view").Decoration,
  mark: ReturnType<typeof import("@codemirror/view").Decoration.mark>,
): DecorationSet {
  const ranges: ReturnType<typeof mark.range>[] = [];
  const pattern = /{{[a-z_]+}}/g;
  for (const viewport of view.visibleRanges) {
    const text = view.state.doc.sliceString(viewport.from, viewport.to);
    for (const match of text.matchAll(pattern)) {
      const from = viewport.from + (match.index ?? 0);
      ranges.push(mark.range(from, from + match[0].length));
    }
  }
  return DecorationClass.set(ranges, true);
}
