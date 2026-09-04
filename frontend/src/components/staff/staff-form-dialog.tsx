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
import type { StaffCreate, StaffResponse, StaffUpdate } from "@/lib/types";
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

const STAFF_FEEDBACK_FIELDS = [
  "full_name",
  "contact",
  "email",
  "checkin_window_hours",
  "checkin_window_minutes",
] as const;

const defaultValues: StaffFormValues = {
  full_name: "",
  zalo_name: "",
  phone: "",
  email: "",
  checkin_window_hours: "24",
  checkin_window_minutes: "00",
};

export function StaffFormDialog({
  assignedClassNames,
  contactSuggestionSources,
  embedded = false,
  isSaving,
  onClose,
  onDirtyChange,
  onSubmit,
  staff,
}: {
  assignedClassNames: string[];
  contactSuggestionSources: ContactSuggestionSource[];
  embedded?: boolean;
  isSaving: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
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
    if (staff) {
      const windowVal = staff.checkin_window_after_hours ?? 24;
      const h = Math.floor(windowVal);
      const m = Math.round((windowVal - h) * 60);
      reset({
        full_name: staff.full_name,
        zalo_name: staff.zalo_name ?? "",
        phone: staff.phone ?? "",
        email: staff.email ?? "",
        checkin_window_hours: String(h),
        checkin_window_minutes: m === 0 ? "00" : String(m).padStart(2, "0"),
      });
    } else {
      reset(defaultValues);
    }
    resetFeedback();
  }, [reset, resetFeedback, staff]);

  async function submit(values: StaffFormValues) {
    markSubmitted();
    setSubmitError("");

    const rawHours = values.checkin_window_hours;
    const rawMinutes = values.checkin_window_minutes;
    const hoursNum =
      rawHours === "" || rawHours === null || rawHours === undefined ? 24 : Number(rawHours);
    const minutesNum =
      rawMinutes === "" || rawMinutes === null || rawMinutes === undefined ? 0 : Number(rawMinutes);
    const totalHours =
      Math.round((hoursNum + minutesNum / 60) * 100) / 100 || 24;

    const payload: StaffCreate | StaffUpdate = {
      full_name: values.full_name.trim(),
      ...(staff?.staff_type ? { staff_type: staff.staff_type } : {}),
      zalo_name: values.zalo_name.trim() || null,
      phone: values.phone ? normalizeVietnamPhone(values.phone) : null,
      email: values.email.trim() || null,
      checkin_window_after_hours: totalHours,
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

  const hasUnsavedChanges = Boolean(
    staff && normalizedStaffKey(watchedFormValues) !== normalizedStaffKey({
      full_name: staff.full_name,
      zalo_name: staff.zalo_name ?? "",
      phone: staff.phone ?? "",
      email: staff.email ?? "",
      checkin_window_hours: String(Math.floor(staff.checkin_window_after_hours ?? 24)),
      checkin_window_minutes: Math.round(((staff.checkin_window_after_hours ?? 24) % 1) * 60) === 0
        ? "00"
        : String(Math.round(((staff.checkin_window_after_hours ?? 24) % 1) * 60)).padStart(2, "0"),
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
  const contactLabelId = `${fieldIdPrefix}-contact-label`;
  const zaloNameId = `${fieldIdPrefix}-zalo-name`;
  const phoneId = `${fieldIdPrefix}-phone`;
  const emailId = `${fieldIdPrefix}-email`;
  const checkinHoursId = `${fieldIdPrefix}-checkin-hours`;
  const checkinMinutesId = `${fieldIdPrefix}-checkin-minutes`;
  const contactError = errors.zalo_name ?? errors.phone;
  const visibleFullNameError = shouldShowError("full_name", isSubmitted)
    ? errors.full_name
    : undefined;
  const visibleContactError = shouldShowError("contact", isSubmitted)
    ? contactError
    : undefined;
  const visibleEmailError = shouldShowError("email", isSubmitted)
    ? errors.email
    : undefined;
  const visibleCheckinHoursError = shouldShowError(
    "checkin_window_hours",
    isSubmitted,
  )
    ? errors.checkin_window_hours
    : undefined;
  const visibleCheckinMinutesError = shouldShowError(
    "checkin_window_minutes",
    isSubmitted,
  )
    ? errors.checkin_window_minutes
    : undefined;
  const contactErrorId = `${fieldIdPrefix}-contact-error`;
  const contactDescribedBy = visibleContactError ? contactErrorId : undefined;
  const emailErrorId = `${fieldIdPrefix}-email-error`;
  const emailDescribedBy = visibleEmailError ? emailErrorId : undefined;
  const checkinHoursErrorId = `${fieldIdPrefix}-checkin-hours-error`;
  const checkinHoursDescribedBy = visibleCheckinHoursError
    ? checkinHoursErrorId
    : undefined;
  const checkinMinutesErrorId = `${fieldIdPrefix}-checkin-minutes-error`;
  const checkinMinutesDescribedBy = visibleCheckinMinutesError
    ? checkinMinutesErrorId
    : undefined;
  const assignmentsId = `${fieldIdPrefix}-assignments`;
  const fullNameDescription = [
    visibleFullNameError ? `${fullNameId}-error` : null,
    assignedClassNames.length > 0 ? assignmentsId : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  const formElement = (
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
                <div className="space-y-3">
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

                  {assignedClassNames.length > 0 ? (
                    <p
                      id={assignmentsId}
                      className="helper-text min-w-0 select-none text-gray-500"
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
                  className={`h-8 rounded-md border bg-white transition-shadow focus-within:ring-1 ${
                    visibleContactError
                      ? "border-destructive focus-within:!border-destructive focus-within:!ring-destructive/15"
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

              <FormField
                controlId={emailId}
                error={visibleEmailError?.message}
                errorId={emailErrorId}
                label="Email (tùy chọn)"
              >
                <input
                  {...register("email", {
                    onChange: (event) => {
                      setSubmitError("");
                      markInput("email", event.target.value);
                    },
                    onBlur: () => markBlur("email"),
                  })}
                  id={emailId}
                  type="text"
                  inputMode="email"
                  autoComplete={savedInfoAutocomplete.disabled}
                  maxLength={320}
                  aria-invalid={Boolean(visibleEmailError)}
                  aria-describedby={emailDescribedBy}
                  className={getInputClass(Boolean(visibleEmailError))}
                  data-row={2}
                  data-col={0}
                />
                <p className="helper-text select-none text-gray-500">
                  Lưu ý: Email dùng để giáo viên đăng nhập vào hệ thống và thực hiện chấm công.
                </p>
              </FormField>
              </FormSection>

              <FormSection label="Cửa sổ chấm công" order={3}>
                <div className="grid grid-cols-2 items-start gap-3">
                  <div className="min-w-0">
                    <FormField
                      controlId={checkinHoursId}
                      error={visibleCheckinHoursError?.message}
                      errorId={checkinHoursErrorId}
                      label="Số giờ"
                    >
                      <input
                        {...register("checkin_window_hours", {
                          onChange: (event) => {
                            setSubmitError("");
                            markInput("checkin_window_hours", event.target.value);
                          },
                          onBlur: () => markBlur("checkin_window_hours"),
                        })}
                        id={checkinHoursId}
                        type="text"
                        inputMode="numeric"
                        autoComplete={savedInfoAutocomplete.disabled}
                        placeholder="24"
                        aria-invalid={Boolean(visibleCheckinHoursError)}
                        aria-describedby={checkinHoursDescribedBy}
                        className={getInputClass(Boolean(visibleCheckinHoursError))}
                        data-row={3}
                        data-col={0}
                      />
                    </FormField>
                  </div>

                  <div className="min-w-0">
                    <FormField
                      controlId={checkinMinutesId}
                      error={visibleCheckinMinutesError?.message}
                      errorId={checkinMinutesErrorId}
                      label="Số phút"
                    >
                      <input
                        {...register("checkin_window_minutes", {
                          onChange: (event) => {
                            setSubmitError("");
                            markInput("checkin_window_minutes", event.target.value);
                          },
                          onBlur: () => markBlur("checkin_window_minutes"),
                        })}
                        id={checkinMinutesId}
                        type="text"
                        inputMode="numeric"
                        autoComplete={savedInfoAutocomplete.disabled}
                        placeholder="00"
                        aria-invalid={Boolean(visibleCheckinMinutesError)}
                        aria-describedby={checkinMinutesDescribedBy}
                        className={getInputClass(Boolean(visibleCheckinMinutesError))}
                        data-row={3}
                        data-col={1}
                      />
                    </FormField>
                  </div>
                </div>
                <p className="helper-text select-none text-gray-500">
                  Thời gian cho phép giáo viên tự chấm công tính từ lúc buổi học bắt đầu (mặc định: 24 giờ 00 phút).
                </p>
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
  );

  if (!mounted) return null;

  if (embedded) {
    return formElement;
  }

  return (
    <FormDialogShell
      title={staff ? "Chỉnh sửa nhân sự" : "Thêm nhân sự"}
      width={staff ? "md" : "standard"}
      isBusy={isSaving}
      dirty={hasUnsavedChanges}
      onClose={onClose}
      frameProps={{ className: undefined }}
    >
      {formElement}
    </FormDialogShell>
  );
}

function getInputClass(hasError: boolean) {
  return cn(formTextControlClassName, hasError && formTextControlErrorClassName);
}

function normalizedStaffKey(values: StaffFormValues) {
  const rawHours = values.checkin_window_hours;
  const rawMinutes = values.checkin_window_minutes;
  const hoursNum =
    rawHours === "" || rawHours === null || rawHours === undefined ? 24 : Number(rawHours);
  const minutesNum =
    rawMinutes === "" || rawMinutes === null || rawMinutes === undefined ? 0 : Number(rawMinutes);
  const totalHours =
    values.checkin_window_after_hours !== undefined
      ? Number(values.checkin_window_after_hours)
      : Math.round((hoursNum + minutesNum / 60) * 100) / 100 || 24;

  return JSON.stringify({
    full_name: values.full_name.trim(),
    zalo_name: values.zalo_name?.trim() || null,
    phone: values.phone ? normalizeVietnamPhone(values.phone) : null,
    email: values.email?.trim() || null,
    checkin_window_after_hours: totalHours,
  });
}
