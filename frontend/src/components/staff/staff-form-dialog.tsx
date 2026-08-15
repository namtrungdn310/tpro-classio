"use client";

import {
  useEffect,
  useId,
  useState,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  createEntityDialogFrameClassName,
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { InlineFormError } from "@/components/ui/inline-form-error";
import { FormSection } from "@/components/ui/form-section";
import {
  formTextControlClassName,
  formTextControlErrorClassName,
} from "@/components/ui/form-text-control";
import { SaveButton } from "@/components/ui/save-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SplitTextField } from "@/components/ui/split-text-field";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
  normalizeVietnamPhone,
  staffCreateFormSchema,
  staffFormSchema,
  type StaffFormValues,
} from "@/lib/schemas/staff";
import type { StaffCreate, StaffResponse, StaffType, StaffUpdate } from "@/lib/types";
import {
  noSavedInfoFormProps,
  savedInfoAutocomplete,
} from "@/lib/forms/saved-info-policy";
import { useFormFieldFeedback } from "@/lib/forms/use-form-field-feedback";
import { moveFocusByFormArrow } from "@/lib/forms/field-navigation";
import {
  handleContactSuggestionTab,
  type ContactSuggestionSource,
  useContactPairSuggestion,
} from "@/lib/forms/use-contact-pair-suggestion";
import { cn } from "@/lib/utils";

const STAFF_FEEDBACK_FIELDS = ["full_name", "staff_type", "contact"] as const;

const defaultValues: StaffFormValues = {
  full_name: "",
  staff_type: "TEACHER",
  zalo_name: "",
  phone: "",
};

export function StaffFormDialog({
  assignedClassNames,
  contactSuggestionSources,
  isSaving,
  onClose,
  onSubmit,
  staff,
}: {
  assignedClassNames: string[];
  contactSuggestionSources: ContactSuggestionSource[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (payload: StaffCreate | StaffUpdate) => Promise<void>;
  staff: StaffResponse | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const fieldIdPrefix = useId();
  const {
    clearErrors,
    formState: { errors, isSubmitted },
    getValues,
    handleSubmit,
    register,
    reset,
    setError,
    setValue,
    watch,
  } = useForm<StaffFormValues>({
    resolver: zodResolver(staff ? staffFormSchema : staffCreateFormSchema),
    mode: "onChange",
    shouldFocusError: true,
    defaultValues,
  });
  const {
    markBlur,
    markInput,
    markSubmitted,
    resetFeedback,
    shouldShowError,
  } = useFormFieldFeedback(STAFF_FEEDBACK_FIELDS);
  const staffType = watch("staff_type");
  const watchedFormValues = watch();
  const contactSuggestion = useContactPairSuggestion({
    localSources: contactSuggestionSources,
    owner: "staff",
    phoneValue: watchedFormValues.phone,
    zaloValue: watchedFormValues.zalo_name,
  });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setSubmitError("");
    reset(
      staff
        ? {
            full_name: staff.full_name,
            staff_type: staff.staff_type,
            zalo_name: staff.zalo_name ?? "",
            phone: staff.phone ?? "",
          }
        : defaultValues,
    );
    resetFeedback();
  }, [reset, resetFeedback, staff]);

  async function submit(values: StaffFormValues) {
    markSubmitted();
    setSubmitError("");
    if (
      staff?.staff_type === "TEACHER" &&
      values.staff_type === "ASSISTANT" &&
      assignedClassNames.length > 0
    ) {
      setError("staff_type", {
        type: "manual",
        message: `Hãy gỡ nhân sự khỏi ${formatClassList(assignedClassNames)} trước khi đổi sang trợ giảng.`,
      });
      return;
    }

    const payload: StaffCreate | StaffUpdate = {
      full_name: values.full_name.trim(),
      staff_type: values.staff_type,
      zalo_name: values.zalo_name.trim() || null,
      phone: values.phone ? normalizeVietnamPhone(values.phone) : null,
    };

    try {
      await onSubmit(payload);
    } catch (error) {
      const message = getApiErrorMessage(error, "Không thể lưu thông tin nhân sự.");
      setSubmitError(message);
    }
  }

  function acceptContactSuggestion() {
    if (!contactSuggestion) {
      return;
    }

    const field =
      contactSuggestion.target === "zalo" ? "zalo_name" : "phone";
    const nextZaloName =
      field === "zalo_name"
        ? contactSuggestion.value
        : getValues("zalo_name");
    const nextPhone =
      field === "phone"
        ? contactSuggestion.value
        : getValues("phone");

    setSubmitError("");
    clearErrors(["zalo_name", "phone"]);
    setValue(field, contactSuggestion.value, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    markInput("contact", [nextZaloName, nextPhone].filter(Boolean));
  }

  if (!mounted) return null;

  const hasUnsavedChanges = Boolean(
    staff && normalizedStaffKey(watchedFormValues) !== normalizedStaffKey({
      full_name: staff.full_name,
      staff_type: staff.staff_type,
      zalo_name: staff.zalo_name ?? "",
      phone: staff.phone ?? "",
    }),
  );
  const hasErrors =
    !(staff ? staffFormSchema : staffCreateFormSchema).safeParse(watchedFormValues).success ||
    Object.keys(errors).length > 0 ||
    Boolean(submitError);
  const shouldShowUnsavedNotice = shouldShowUnsavedChanges({
    hasChanges: hasUnsavedChanges,
    hasErrors,
    isSaving,
  });
  const fullNameId = `${fieldIdPrefix}-full-name`;
  const typeLabelId = `${fieldIdPrefix}-staff-type-label`;
  const contactLabelId = `${fieldIdPrefix}-contact-label`;
  const zaloNameId = `${fieldIdPrefix}-zalo-name`;
  const phoneId = `${fieldIdPrefix}-phone`;
  const contactError = errors.zalo_name ?? errors.phone;
  const visibleFullNameError = shouldShowError("full_name", isSubmitted)
    ? errors.full_name
    : undefined;
  const visibleStaffTypeError = shouldShowError("staff_type", isSubmitted)
    ? errors.staff_type
    : undefined;
  const visibleContactError = shouldShowError("contact", isSubmitted)
    ? contactError
    : undefined;
  const contactErrorId = `${fieldIdPrefix}-contact-error`;
  const contactDescribedBy = visibleContactError ? contactErrorId : undefined;
  const assignmentsId = `${fieldIdPrefix}-assignments`;
  const fullNameDescription = [
    visibleFullNameError ? `${fullNameId}-error` : null,
    staff?.staff_type === "TEACHER" && assignedClassNames.length > 0
      ? assignmentsId
      : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <FormDialogShell
      title={staff ? "Chỉnh sửa nhân sự" : "Thêm nhân sự"}
      width={staff ? "md" : "standard"}
      isBusy={isSaving}
      dirty={hasUnsavedChanges}
      onClose={onClose}
      frameProps={{ className: staff ? undefined : createEntityDialogFrameClassName }}
    >

        <form
          {...noSavedInfoFormProps}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={moveFocusByFormArrow}
          onSubmit={handleSubmit(submit, () => markSubmitted())}
        >
          <FormDialogBody>
            <fieldset disabled={isSaving} className="space-y-3 disabled:opacity-70">
              <FormSection label="Hồ sơ nhân sự" order={1}>
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <FormField
                    controlId={fullNameId}
                    error={visibleFullNameError?.message}
                    errorId={`${fullNameId}-error`}
                    label="Họ và tên"
                  >
                    <input
                      {...register("full_name", {
                        onChange: (event) => {
                          setSubmitError("");
                          markInput("full_name", event.target.value);
                        },
                        onBlur: () => markBlur("full_name"),
                      })}
                      id={fullNameId}
                      autoComplete={savedInfoAutocomplete.disabled}
                      data-dialog-autofocus
                      aria-invalid={Boolean(visibleFullNameError)}
                      aria-describedby={fullNameDescription}
                      className={getInputClass(Boolean(visibleFullNameError))}
                      data-row={0}
                      data-col={0}
                    />
                  </FormField>
                </div>

                <FormField
                  error={visibleStaffTypeError?.message}
                  errorId={`${fieldIdPrefix}-staff-type-error`}
                  label="Vai trò"
                  labelId={typeLabelId}
                >
                  <input type="hidden" {...register("staff_type")} />
                  <SegmentedControl
                    ariaLabelledBy={typeLabelId}
                    ariaDescribedBy={visibleStaffTypeError ? `${fieldIdPrefix}-staff-type-error` : undefined}
                    invalid={Boolean(visibleStaffTypeError)}
                    options={[
                      { label: "Giáo viên", value: "TEACHER" },
                      { label: "Trợ giảng", value: "ASSISTANT" },
                    ]}
                    selected={staffType}
                    onSelect={(value) => {
                      clearErrors("staff_type");
                      setSubmitError("");
                      markInput("staff_type", value);
                      setValue("staff_type", value as StaffType, {
                        shouldDirty: true,
                        shouldValidate: false,
                      });
                    }}
                  />
                </FormField>

                {staff?.staff_type === "TEACHER" && assignedClassNames.length > 0 ? (
                  <p
                    id={assignmentsId}
                    className="helper-text min-w-0 select-none text-gray-500 sm:col-span-2"
                  >
                    Đang phụ trách: {assignedClassNames.join(", ")}
                  </p>
                ) : null}
              </div>
              </FormSection>

              <FormSection label="Thông tin liên hệ" order={2}>
              <FormField
                error={visibleContactError?.message}
                errorId={contactErrorId}
                label="Zalo và số điện thoại"
                labelId={contactLabelId}
              >
                <SplitTextField
                  role="group"
                  aria-labelledby={contactLabelId}
                  aria-describedby={contactDescribedBy}
                  onKeyDown={(event) =>
                    handleContactSuggestionTab(
                      event,
                      contactSuggestion,
                      acceptContactSuggestion,
                    )
                  }
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      markBlur("contact");
                    }
                  }}
                  className={`h-8 rounded-md border bg-white transition-shadow focus-within:ring-2 ${
                    visibleContactError
                      ? "border-destructive focus-within:border-destructive focus-within:ring-destructive/15"
                      : "border-gray-200 focus-within:border-primary/60 focus-within:ring-primary/15"
                  }`}
                  left={
                    <input
                      {...register("zalo_name", {
                        onChange: (event) => {
                          setSubmitError("");
                          markInput("contact", [
                            event.target.value,
                            getValues("phone"),
                          ].filter(Boolean));
                        },
                      })}
                      id={zaloNameId}
                      autoComplete={savedInfoAutocomplete.disabled}
                      maxLength={100}
                      placeholder={
                        contactSuggestion?.target === "zalo"
                          ? contactSuggestion.value
                          : "Tên Zalo"
                      }
                      aria-label="Tên Zalo nhân sự"
                      aria-invalid={Boolean(visibleContactError)}
                      aria-describedby={contactDescribedBy}
                      aria-autocomplete={
                        contactSuggestion?.target === "zalo"
                          ? "inline"
                          : undefined
                      }
                      aria-keyshortcuts={contactSuggestion ? "Tab" : undefined}
                      data-contact-part="zalo"
                      className="form-input-text h-full min-w-0 bg-transparent px-3 py-0 outline-none placeholder:text-gray-400"
                      data-row={1}
                      data-col={0}
                    />
                  }
                  right={
                    <input
                      {...register("phone", {
                        onChange: (event) => {
                          setSubmitError("");
                          markInput("contact", [
                            getValues("zalo_name"),
                            event.target.value,
                          ].filter(Boolean));
                        },
                      })}
                      id={phoneId}
                      inputMode="tel"
                      autoComplete={savedInfoAutocomplete.disabled}
                      maxLength={32}
                      placeholder={
                        contactSuggestion?.target === "phone"
                          ? contactSuggestion.value
                          : "SĐT"
                      }
                      aria-label="Số điện thoại nhân sự"
                      aria-invalid={Boolean(visibleContactError)}
                      aria-describedby={contactDescribedBy}
                      aria-autocomplete={
                        contactSuggestion?.target === "phone"
                          ? "inline"
                          : undefined
                      }
                      aria-keyshortcuts={contactSuggestion ? "Tab" : undefined}
                      data-contact-part="phone"
                      className="form-input-text h-full min-w-0 bg-transparent px-3 py-0 outline-none placeholder:text-gray-400"
                      data-row={1}
                      data-col={1}
                    />
                  }
                />
              </FormField>
              </FormSection>
            </fieldset>

            {submitError ? (
              <InlineFormError className="mt-3">{submitError}</InlineFormError>
            ) : null}
          </FormDialogBody>

          <FormDialogFooter
            left={
              shouldShowUnsavedNotice ? (
                <UnsavedChangesNotice
                  hasChanges={hasUnsavedChanges}
                  hasErrors={hasErrors}
                  isSaving={isSaving}
                />
              ) : null
            }
            right={
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-md px-3 text-sm"
                  disabled={isSaving}
                  onClick={onClose}
                >
                  Huỷ
                </Button>
                <SaveButton
                  type="submit"
                  isSaving={isSaving}
                  disabled={Boolean(staff && !hasUnsavedChanges)}
                />
              </>
            }
          />
        </form>
      </FormDialogShell>
    );
  }

function getInputClass(hasError: boolean) {
  return cn(formTextControlClassName, hasError && formTextControlErrorClassName);
}

function formatClassList(classNames: string[]) {
  if (classNames.length <= 3) return `các lớp ${classNames.join(", ")}`;
  return `${classNames.slice(0, 3).join(", ")} và ${classNames.length - 3} lớp khác`;
}

function normalizedStaffKey(values: StaffFormValues) {
  return JSON.stringify({
    full_name: values.full_name.trim(),
    staff_type: values.staff_type,
    zalo_name: values.zalo_name.trim() || null,
    phone: values.phone ? normalizeVietnamPhone(values.phone) : null,
  });
}
