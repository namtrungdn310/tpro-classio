"use client";

import { useMemo, useRef, useState } from "react";
import { RiArrowGoBackLine as RotateCcw } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { FormDialogBody, FormDialogFooter, FormDialogShell } from "@/components/ui/form-dialog-shell";
import { SaveButton } from "@/components/ui/save-button";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import {
  FeeMessageCodeEditor,
  type FeeMessageCodeEditorHandle,
} from "@/components/fees/fee-message-code-editor";
import {
  FEE_MESSAGE_TOKENS,
  MAX_FEE_MESSAGE_TEMPLATE_LENGTH,
  feeMessageTemplateValuesSchema,
  type FeeMessageTemplateValues,
} from "@/lib/fees/message-templates";
import { useFormFieldFeedback } from "@/lib/forms/use-form-field-feedback";
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
  onReset: (version: number) => void;
  open: boolean;
  templates: FeeMessageTemplatesResponse;
};

export function FeeMessageTemplateDialog({
  isSaving,
  onClose,
  onSave,
  onReset,
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
      onReset={onReset}
      templates={templates}
    />
  );
}

function FeeMessageTemplateDialogContent({
  isSaving,
  onClose,
  onSave,
  onReset,
  templates,
}: Omit<FeeMessageTemplateDialogProps, "open">) {
  const reminderRef = useRef<FeeMessageCodeEditorHandle>(null);
  const receivedRef = useRef<FeeMessageCodeEditorHandle>(null);
  const [values, setValues] = useState<FeeMessageTemplateValues>({
    payment_reminder_template: templates.active.payment_reminder_template,
    payment_received_template: templates.active.payment_received_template,
  });
  const [baseVersion] = useState(templates.version);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const {
    markBlur,
    markInput,
    markSubmitted,
    resetFeedback,
    shouldShowError,
  } = useFormFieldFeedback(TEMPLATE_FIELDS);
  const requestClose = () => {
    if (!isSaving) {
      onClose();
    }
  };

  const hasDraftChanges =
    values.payment_reminder_template !== templates.active.payment_reminder_template ||
    values.payment_received_template !== templates.active.payment_received_template;
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
  // Compare the raw editor values so an explicit Enter is immediately visible
  // as a draft change and remains an intentional part of the saved message.
  const hasActionableDraft = hasDraftChanges;
  const shouldShowUnsavedNotice = shouldShowUnsavedChanges({
    hasChanges: hasDraftChanges,
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
    editorRef: React.RefObject<FeeMessageCodeEditorHandle | null>,
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
    if (templates.is_customized) {
      onReset(baseVersion);
    } else {
      setValues({ ...templates.defaults });
      setIsSubmitted(false);
      resetFeedback();
    }
  }

  return (
    <FormDialogShell
      title="Nội dung tin nhắn Zalo"
      width="xl"
      isBusy={isSaving}
      dirty={hasDraftChanges}
        onClose={requestClose}
    >
        <FormDialogBody>
          <div className="grid gap-5 lg:grid-cols-2">
            {fieldConfigs.map((config) => {
              const errorId = `${config.field}-error`;
              const error = shouldShowError(config.field, isSubmitted)
                ? validation.errors[config.field]
                : undefined;
              return (
                <section key={config.field} className="min-w-0">
                  <label
                    htmlFor={config.field}
                    className="form-label-text block select-none text-gray-700"
                  >
                    {config.label}
                  </label>
                  <p className="mt-1 text-xs text-gray-500">
                    Enter để xuống dòng · Backspace ở đầu dòng để nối.
                  </p>
                  <FeeMessageCodeEditor
                    ref={config.textareaRef}
                    id={config.field}
                    value={values[config.field]}
                    disabled={isSaving}
                    ariaInvalid={Boolean(error)}
                    ariaDescribedBy={error ? errorId : undefined}
                    onChange={(value) => updateField(config.field, value)}
                    onBlur={() => markBlur(config.field)}
                  />
                  <div className="mt-1.5 flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    {error ? (
                      <p id={errorId} className="text-sm font-medium text-destructive">
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
                        data-selection-policy="preserve"
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
          {shouldShowUnsavedNotice ? (
            <div className="mt-4">
              <UnsavedChangesNotice
                hasChanges={hasDraftChanges}
                hasErrors={hasErrors}
                isSaving={isSaving}
              />
            </div>
          ) : null}
          </FormDialogBody>

        <FormDialogFooter
          left={
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
          }
          right={
            <>
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
            </>
          }
        />
      </FormDialogShell>
    );
  }
