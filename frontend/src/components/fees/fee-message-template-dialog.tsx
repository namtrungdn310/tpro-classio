"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import {
  FeeTemplateEditor,
  type FeeTemplateEditorHandle,
} from "@/components/fees/fee-template-editor";
import {
  DEFAULT_FEE_MESSAGE_TEMPLATES,
  FEE_MESSAGE_TOKENS,
  MAX_FEE_MESSAGE_TEMPLATE_LENGTH,
  feeMessageTemplateValuesSchema,
  type FeeMessageTemplateValues,
} from "@/lib/fees/message-templates";
import { useFormFieldFeedback } from "@/lib/forms/use-form-field-feedback";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import type {
  FeeMessageTemplatesResponse,
  FeeMessageTemplatesUpdate,
} from "@/lib/types";

type TemplateField = keyof FeeMessageTemplateValues;

const TEMPLATE_FIELDS = [
  "payment_reminder_template",
  "payment_received_template",
] as const satisfies readonly TemplateField[];

type FeeMessageTemplateDialogProps = {
  isSaving: boolean;
  onClose: () => void;
  onSave: (payload: FeeMessageTemplatesUpdate) => void;
  open: boolean;
  templates: FeeMessageTemplatesResponse;
};

export function FeeMessageTemplateDialog({
  isSaving,
  onClose,
  onSave,
  open,
  templates,
}: FeeMessageTemplateDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <FeeMessageTemplateDialogContent
      isSaving={isSaving}
      onClose={onClose}
      onSave={onSave}
      templates={templates}
    />
  );
}

function FeeMessageTemplateDialogContent({
  isSaving,
  onClose,
  onSave,
  templates,
}: Omit<FeeMessageTemplateDialogProps, "open">) {
  const titleId = useId();
  const reminderRef = useRef<FeeTemplateEditorHandle>(null);
  const receivedRef = useRef<FeeTemplateEditorHandle>(null);
  const [values, setValues] = useState<FeeMessageTemplateValues>({
    payment_reminder_template: templates.payment_reminder_template,
    payment_received_template: templates.payment_received_template,
  });
  const [baseVersion, setBaseVersion] = useState(templates.version);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const {
    markBlur,
    markInput,
    markSubmitted,
    resetFeedback,
    shouldShowError,
  } = useFormFieldFeedback(TEMPLATE_FIELDS);
  const { backdropPointerDownRef, dialogRef, requestClose } = useModalDialog({
    isBusy: isSaving,
    onClose,
  });

  // A 409 refreshes the latest template metadata while this dialog remains
  // mounted. Rebase the next explicit retry onto that version instead of
  // repeatedly submitting the stale version captured when the dialog opened.
  useEffect(() => {
    setBaseVersion(templates.version);
  }, [templates.version]);
  const hasDraftChanges =
    values.payment_reminder_template !== templates.payment_reminder_template ||
    values.payment_received_template !== templates.payment_received_template;
  const validation = useMemo(() => {
    const result = feeMessageTemplateValuesSchema.safeParse(values);
    if (result.success) {
      return {
        data: result.data,
        errors: {} as Partial<Record<TemplateField, string>>,
      };
    }

    const fieldErrors = result.error.flatten().fieldErrors;
    return {
      data: null,
      errors: {
        payment_reminder_template: fieldErrors.payment_reminder_template?.[0],
        payment_received_template: fieldErrors.payment_received_template?.[0],
      },
    };
  }, [values]);
  const hasErrors = validation.data === null;
  const hasPersistableChanges = Boolean(
    validation.data &&
      (validation.data.payment_reminder_template !== templates.payment_reminder_template ||
        validation.data.payment_received_template !== templates.payment_received_template),
  );
  const hasActionableDraft = validation.data ? hasPersistableChanges : hasDraftChanges;
  const shouldShowUnsavedNotice = shouldShowUnsavedChanges({
    hasChanges: hasPersistableChanges,
    hasErrors,
    isSaving,
  });

  const fieldConfigs = useMemo(
    () => [
      {
        field: "payment_reminder_template" as const,
        label: "Thông báo phụ huynh đóng học phí",
        textareaRef: reminderRef,
        tokens: FEE_MESSAGE_TOKENS,
      },
      {
        field: "payment_received_template" as const,
        label: "Thông báo đã nhận được học phí",
        textareaRef: receivedRef,
        tokens: FEE_MESSAGE_TOKENS,
      },
    ],
    [],
  );

  function updateField(field: TemplateField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    markInput(field, value);
  }

  function insertToken(
    field: TemplateField,
    editorRef: React.RefObject<FeeTemplateEditorHandle | null>,
    token: string,
    label: string,
  ) {
    editorRef.current?.insertToken(token, label);
  }

  function handleSave() {
    setIsSubmitted(true);
    markSubmitted();
    if (!validation.data) {
      return;
    }

    onSave({ ...validation.data, version: baseVersion });
  }

  function resetToDefaults() {
    setValues({ ...DEFAULT_FEE_MESSAGE_TEMPLATES });
    setIsSubmitted(false);
    resetFeedback();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPointerDownRef.current && event.target === event.currentTarget) {
          requestClose();
        }
        backdropPointerDownRef.current = false;
      }}
      onPointerCancel={() => {
        backdropPointerDownRef.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isSaving || undefined}
        tabIndex={-1}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id={titleId} className="section-title-text text-gray-950">
              Nội dung tin nhắn Zalo
            </h2>
          </div>
          <button
            type="button"
            aria-label="Đóng khung nội dung Zalo"
            disabled={isSaving}
            onClick={requestClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <UnsavedChangesNotice
            hasChanges={hasPersistableChanges}
            hasErrors={hasErrors}
            isSaving={isSaving}
          />
          <div className={`${shouldShowUnsavedNotice ? "mt-4" : ""} grid gap-5 lg:grid-cols-2`}>
            {fieldConfigs.map((config) => {
              const errorId = `${config.field}-error`;
              const error = shouldShowError(config.field, isSubmitted)
                ? validation.errors[config.field]
                : undefined;
              return (
                <section key={config.field} className="min-w-0">
                  <label
                    htmlFor={config.field}
                    className="form-label-text block select-none text-[15px] text-gray-700"
                  >
                    {config.label}
                  </label>
                  <FeeTemplateEditor
                    ref={config.textareaRef}
                    id={config.field}
                    value={values[config.field]}
                    disabled={isSaving}
                    ariaInvalid={Boolean(error)}
                    ariaDescribedBy={error ? errorId : undefined}
                    onChange={(value) => updateField(config.field, value)}
                    onBlur={() => markBlur(config.field)}
                  />
                  <div className="mt-1.5 flex min-h-5 items-start justify-between gap-3">
                    {error ? (
                      <p id={errorId} className="text-sm font-medium text-red-600">
                        {error}
                      </p>
                    ) : (
                      <span />
                    )}
                    <span className="shrink-0 select-none text-xs tabular-nums text-gray-400">
                      {values[config.field].length}/{MAX_FEE_MESSAGE_TEMPLATE_LENGTH}
                    </span>
                  </div>
                  <div className="mt-2 flex select-none flex-wrap gap-1.5">
                    {config.tokens.map(({ label, token }) => (
                      <button
                        key={token}
                        type="button"
                        disabled={isSaving}
                        title={`Chèn ${label}`}
                        data-fee-template-editor-control={config.field}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() =>
                          insertToken(config.field, config.textareaRef, token, label)
                        }
                        className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 bg-gray-50/70 px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={resetToDefaults}
            className="h-8 gap-1.5 rounded-md px-3 text-sm"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Mặc định
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={requestClose}
              className="h-8 rounded-md px-3 text-sm"
            >
              Huỷ
            </Button>
            <SaveButton
              type="button"
              disabled={!hasActionableDraft}
              onClick={handleSave}
              isSaving={isSaving}
            />
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
