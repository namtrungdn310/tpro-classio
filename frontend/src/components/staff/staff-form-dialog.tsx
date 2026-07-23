"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineFieldDivider } from "@/components/ui/inline-field-divider";
import { SaveButton } from "@/components/ui/save-button";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
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

const STAFF_FEEDBACK_FIELDS = ["full_name", "staff_type", "contact"] as const;

const defaultValues: StaffFormValues = {
  full_name: "",
  staff_type: "TEACHER",
  zalo_name: "",
  phone: "",
};

export function StaffFormDialog({
  assignedClassNames,
  isSaving,
  onClose,
  onSubmit,
  staff,
}: {
  assignedClassNames: string[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (payload: StaffCreate | StaffUpdate) => Promise<void>;
  staff: StaffResponse | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const titleId = useId();
  const fieldIdPrefix = useId();
  const { backdropPointerDownRef, dialogRef, requestClose } = useModalDialog({
    isBusy: isSaving,
    onClose,
  });
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
  const assignmentsId = `${fieldIdPrefix}-assignments`;
  const fullNameDescription = [
    visibleFullNameError ? `${fullNameId}-error` : null,
    staff?.staff_type === "TEACHER" && assignedClassNames.length > 0
      ? assignmentsId
      : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPointerDownRef.current && event.target === event.currentTarget) requestClose();
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
        className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-[536px] sm:rounded-xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 py-3 pl-4 pr-4 sm:pl-5">
          <h2 id={titleId} className="section-title-text min-w-0 select-none text-gray-900">
            {staff ? "Chỉnh sửa nhân sự" : "Thêm nhân sự"}
          </h2>
          <button
            type="button"
            aria-label="Đóng"
            title="Đóng"
            disabled={isSaving}
            onClick={requestClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          {...noSavedInfoFormProps}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleSubmit(submit, () => markSubmitted())}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
            <fieldset disabled={isSaving} className="space-y-3 disabled:opacity-70">
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <Field
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
                    />
                  </Field>
                </div>

                <Field
                  error={visibleStaffTypeError?.message}
                  errorId={`${fieldIdPrefix}-staff-type-error`}
                  label="Vai trò"
                  labelId={typeLabelId}
                >
                  <input type="hidden" {...register("staff_type")} />
                  <div
                    role="group"
                    aria-labelledby={typeLabelId}
                    aria-describedby={visibleStaffTypeError ? `${fieldIdPrefix}-staff-type-error` : undefined}
                    className={`grid h-8 w-full select-none grid-cols-2 overflow-hidden rounded-md border bg-white p-0.5 ${visibleStaffTypeError ? "border-red-400 ring-2 ring-red-100" : "border-gray-200"}`}
                  >
                    {([
                      { label: "Giáo viên", value: "TEACHER" },
                      { label: "Trợ giảng", value: "ASSISTANT" },
                    ] as const).map((option) => {
                      const selected = staffType === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            clearErrors("staff_type");
                            setSubmitError("");
                            markInput("staff_type", option.value);
                            setValue("staff_type", option.value as StaffType, {
                              shouldDirty: true,
                              shouldValidate: false,
                            });
                          }}
                          className={`form-input-text h-full min-w-0 rounded-[5px] px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-300 ${
                            selected
                              ? "bg-gray-950 text-white"
                              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                {staff?.staff_type === "TEACHER" && assignedClassNames.length > 0 ? (
                  <p
                    id={assignmentsId}
                    className="helper-text min-w-0 select-none text-gray-500 sm:col-span-2"
                  >
                    Đang phụ trách: {assignedClassNames.join(", ")}
                  </p>
                ) : null}
              </div>

              <Field
                error={visibleContactError?.message}
                errorId={contactErrorId}
                label="Thông tin nhân sự"
                labelId={contactLabelId}
              >
                <div
                  role="group"
                  aria-labelledby={contactLabelId}
                  aria-describedby={visibleContactError ? contactErrorId : undefined}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      markBlur("contact");
                    }
                  }}
                  className={`grid h-8 grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center rounded-md border bg-white transition-shadow focus-within:ring-2 ${
                    visibleContactError
                      ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100"
                      : "border-gray-200 focus-within:border-gray-400 focus-within:ring-gray-200"
                  }`}
                >
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
                    placeholder="Tên Zalo"
                    aria-label="Tên Zalo nhân sự"
                    aria-invalid={Boolean(visibleContactError)}
                    aria-describedby={visibleContactError ? contactErrorId : undefined}
                    className="form-input-text h-full min-w-0 bg-transparent px-3 outline-none placeholder:text-gray-400"
                  />
                  <InlineFieldDivider />
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
                    placeholder="SĐT"
                    aria-label="Số điện thoại nhân sự"
                    aria-invalid={Boolean(visibleContactError)}
                    aria-describedby={visibleContactError ? contactErrorId : undefined}
                    className="form-input-text h-full min-w-0 bg-transparent px-3 outline-none placeholder:text-gray-400"
                  />
                </div>
              </Field>
            </fieldset>

            {submitError ? (
              <div role="alert" className="helper-text mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-red-700">
                {submitError}
              </div>
            ) : null}
          </div>

          {shouldShowUnsavedNotice ? (
            <div className="shrink-0 px-4 pb-3 sm:px-5">
              <UnsavedChangesNotice
                hasChanges={hasUnsavedChanges}
                hasErrors={hasErrors}
                isSaving={isSaving}
              />
            </div>
          ) : null}

          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5">
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-md px-3 text-sm"
              disabled={isSaving}
              onClick={requestClose}
            >
              Huỷ
            </Button>
            <SaveButton
              type="submit"
              isSaving={isSaving}
              disabled={Boolean(staff && !hasUnsavedChanges)}
            />
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function Field({
  children,
  controlId,
  error,
  errorId,
  label,
  labelId,
}: {
  children: ReactNode;
  controlId?: string;
  error?: string;
  errorId?: string;
  label: string;
  labelId?: string;
}) {
  return (
    <div className="block space-y-1">
      {controlId ? (
        <label htmlFor={controlId} className="form-label-text block select-none text-[15px] text-gray-700">
          {label}
        </label>
      ) : (
        <span id={labelId} className="form-label-text block select-none text-[15px] text-gray-700">
          {label}
        </span>
      )}
      {children}
      {error ? (
        <span id={errorId} role="alert" className="helper-text block text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function getInputClass(hasError: boolean) {
  return `form-input-text h-8 w-full rounded-md border bg-white px-3 outline-none transition select-text ${
    hasError
      ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
      : "border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
  }`;
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
