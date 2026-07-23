"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, RefreshCw, X } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ClassScheduleList } from "@/components/classes/class-schedule-list";
import { InlineFieldDivider } from "@/components/ui/inline-field-divider";
import { SaveButton } from "@/components/ui/save-button";
import { SmartMoneyInput } from "@/components/ui/smart-money-input";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import type { ScheduleSlot } from "@/components/layout/weekly-schedule-board";
import {
  COURSE_DURATION_OPTIONS,
  getClassScheduleSlots,
  getClassScheduleSlotsLabel,
  getClassScheduleText,
  getClassTeacherIds,
  normalizeCourseBillingMonths,
} from "@/lib/classes/presentation";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import type { ClassCreate, ClassResponse, ClassType, TeacherOptionResponse } from "@/lib/types";
import { validationMessages } from "@/lib/forms/validation-messages";
import {
  noSavedInfoFormProps,
  savedInfoAutocomplete,
} from "@/lib/forms/saved-info-policy";
import { useFormFieldFeedback } from "@/lib/forms/use-form-field-feedback";

const ScheduleGridSlide = dynamic(
  () =>
    import("@/components/layout/schedule-grid-slide").then(
      (module) => module.ScheduleGridSlide,
    ),
  { ssr: false },
);

const MAX_CLASS_FEE = 999_999_999_999;
const CLASS_FEEDBACK_FIELDS = [
  "name",
  "type",
  "base_fee",
  "billing_cycle_months",
  "teacher_ids",
  "schedule",
] as const;

export const classFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, validationMessages.required("tên lớp"))
      .max(120, "Tên lớp không được vượt quá 120 ký tự."),
    type: z.enum(["MONTHLY", "COURSE"]),
    base_fee: z
      .number({ message: validationMessages.feeFormat })
      .min(0, validationMessages.feeNonNegative)
      .max(MAX_CLASS_FEE, "Học phí vượt quá giới hạn hệ thống.")
      .nullable()
      .refine((value) => value !== null, validationMessages.required("học phí"))
      .transform((value) => value as number),
    billing_cycle_months: z.number().int().min(1, validationMessages.billingCycle),
    teacher_ids: z
      .array(z.string().uuid())
      .min(1, validationMessages.selectRequired("ít nhất một giáo viên"))
      .max(10, "Mỗi lớp được chọn tối đa 10 giáo viên."),
  })
  .superRefine((values, context) => {
    if (
      values.type === "COURSE" &&
      !COURSE_DURATION_OPTIONS.some((option) => option.months === values.billing_cycle_months)
    ) {
      context.addIssue({
        code: "custom",
        path: ["billing_cycle_months"],
        message: "Vui lòng chọn một thời lượng gói được hỗ trợ.",
      });
    }
  });

type ClassFormInputValues = z.input<typeof classFormSchema>;
type ClassFormValues = z.output<typeof classFormSchema>;

const DEFAULT_VALUES: ClassFormInputValues = {
  name: "",
  type: "MONTHLY",
  base_fee: null,
  billing_cycle_months: 3,
  teacher_ids: [],
};

type OccupiedScheduleSlot = ScheduleSlot & { className: string };

type ClassFormDialogProps = {
  class_: ClassResponse | null;
  classes: ClassResponse[];
  isSaving: boolean;
  isTeachersError: boolean;
  isTeachersLoading: boolean;
  onClose: () => void;
  onRetryTeachers: () => void;
  onSubmit: (payload: ClassCreate) => void;
  teachers: TeacherOptionResponse[];
};

export function ClassFormDialog({
  class_,
  classes,
  isSaving,
  isTeachersError,
  isTeachersLoading,
  onClose,
  onRetryTeachers,
  onSubmit,
  teachers,
}: ClassFormDialogProps) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [isSchedulePickerOpen, setIsSchedulePickerOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState<{ text: string; slots: ScheduleSlot[] } | null>(null);
  const [initialScheduleKey, setInitialScheduleKey] = useState(scheduleKey(null));
  const { backdropPointerDownRef, dialogRef, requestClose } = useModalDialog({
    isBusy: isSaving,
    onClose,
    suspended: isSchedulePickerOpen,
  });
  const {
    control,
    formState: { errors, isSubmitted },
    handleSubmit,
    register,
    reset,
    setValue,
  } = useForm<ClassFormInputValues, unknown, ClassFormValues>({
    resolver: zodResolver(classFormSchema),
    defaultValues: DEFAULT_VALUES,
    mode: "onChange",
    shouldFocusError: true,
  });
  const {
    markBlur,
    markInput,
    markSubmitted,
    resetFeedback,
    shouldShowError,
  } = useFormFieldFeedback(CLASS_FEEDBACK_FIELDS);
  const type = useWatch({ control, name: "type" });
  const baseFee = useWatch({ control, name: "base_fee" });
  const billingCycleMonths = useWatch({ control, name: "billing_cycle_months" });
  const watchedTeacherIds = useWatch({ control, name: "teacher_ids" });
  const watchedFormValues = useWatch({ control });
  const teacherIds = useMemo(() => watchedTeacherIds ?? [], [watchedTeacherIds]);
  const occupiedSlots = useMemo(
    () => getOccupiedSlots(classes, class_?.id, teacherIds),
    [class_?.id, classes, teacherIds],
  );
  const scheduleConflict = useMemo(
    () => findScheduleConflict(scheduleValue?.slots ?? [], occupiedSlots),
    [occupiedSlots, scheduleValue?.slots],
  );
  const scheduleRequiredError =
    !class_ && !hasConfiguredSchedule(scheduleValue)
      ? validationMessages.selectRequired("lịch học")
      : undefined;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const nextSchedule = class_?.schedule
      ? {
          text: getClassScheduleText(class_),
          slots: getClassScheduleSlots(class_),
        }
      : null;
    reset(
      class_
        ? {
            name: class_.name,
            type: class_.type,
            base_fee: class_.base_fee,
            billing_cycle_months:
              class_.type === "COURSE"
                ? normalizeCourseBillingMonths(class_.billing_cycle_months)
                : 3,
            teacher_ids: getClassTeacherIds(class_),
          }
        : DEFAULT_VALUES,
    );
    setScheduleValue(nextSchedule);
    setInitialScheduleKey(scheduleKey(nextSchedule));
    resetFeedback();
  }, [class_, reset, resetFeedback]);

  useEffect(() => {
    if (type !== "COURSE") return;
    const normalized = normalizeCourseBillingMonths(billingCycleMonths);
    if (normalized !== billingCycleMonths) {
      setValue("billing_cycle_months", normalized, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [billingCycleMonths, setValue, type]);

  const hasUnsavedChanges = Boolean(
    class_ &&
      (normalizedClassFormKey(watchedFormValues) !==
        normalizedClassFormKey({
          name: class_.name,
          type: class_.type,
          base_fee: class_.base_fee,
          billing_cycle_months:
            class_.type === "COURSE"
              ? normalizeCourseBillingMonths(class_.billing_cycle_months)
              : 3,
          teacher_ids: getClassTeacherIds(class_),
        }) ||
        scheduleKey(scheduleValue) !== initialScheduleKey),
  );
  const hasFormErrors =
    !classFormSchema.safeParse(watchedFormValues).success ||
    Object.keys(errors).length > 0 ||
    Boolean(scheduleConflict) ||
    Boolean(scheduleRequiredError) ||
    (isTeachersError && teachers.length === 0);
  const shouldShowUnsavedNotice = shouldShowUnsavedChanges({
    hasChanges: hasUnsavedChanges,
    hasErrors: hasFormErrors,
    isSaving,
  });
  const nameError = shouldShowError("name", isSubmitted)
    ? errors.name?.message
    : undefined;
  const typeError = shouldShowError("type", isSubmitted)
    ? errors.type?.message
    : undefined;
  const baseFeeError = shouldShowError("base_fee", isSubmitted)
    ? errors.base_fee?.message
    : undefined;
  const billingCycleError = shouldShowError(
    "billing_cycle_months",
    isSubmitted,
  )
    ? errors.billing_cycle_months?.message
    : undefined;
  const teacherIdsError = shouldShowError("teacher_ids", isSubmitted)
    ? errors.teacher_ids?.message
    : undefined;
  const scheduleError = scheduleConflict
    ? `Lịch học trùng với lớp ${scheduleConflict.className} vào ${scheduleConflict.day}, ${scheduleConflict.start}–${scheduleConflict.end}. Vui lòng chọn ca khác.`
    : shouldShowError("schedule", isSubmitted)
      ? scheduleRequiredError
      : undefined;

  if (!mounted) return null;

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPointerDownRef.current && event.target === event.currentTarget) {
          requestClose();
        }
        backdropPointerDownRef.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isSaving}
        tabIndex={-1}
        inert={isSchedulePickerOpen}
        className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-[536px] sm:rounded-xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 py-3 pl-4 pr-4 sm:pl-5">
          <h2 id={titleId} className="section-title-text min-w-0 text-gray-900">
            {class_ ? "Chỉnh sửa lớp học" : "Thêm lớp học"}
          </h2>
          <button
            type="button"
            aria-label="Đóng"
            title="Đóng"
            disabled={isSaving}
            onClick={requestClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          {...noSavedInfoFormProps}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            markSubmitted();
            void handleSubmit((values) => {
              if (scheduleRequiredError) {
                return;
              }
              onSubmit({
                name: values.name.trim(),
                type: values.type,
                base_fee: values.base_fee,
                billing_cycle_months:
                  values.type === "MONTHLY"
                    ? 1
                    : normalizeCourseBillingMonths(values.billing_cycle_months),
                schedule: scheduleValue,
                teacher_id: values.teacher_ids[0] ?? null,
                teacher_ids: values.teacher_ids,
              });
            })(event);
          }}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:px-5">
            <Field controlId="class-name" error={nameError} label="Tên lớp">
              <input
                id="class-name"
                data-dialog-autofocus
                {...register("name", {
                  onChange: (event) => markInput("name", event.target.value),
                  onBlur: () => markBlur("name"),
                })}
                maxLength={120}
                required
                autoComplete={savedInfoAutocomplete.disabled}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "class-name-error" : undefined}
                className={inputClass(Boolean(nameError))}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field error={typeError} label="Hình thức học phí" labelId="class-type-label">
                <input type="hidden" {...register("type")} />
                <SegmentedControl
                  ariaLabelledBy="class-type-label"
                  options={[
                    { label: "Theo tháng", value: "MONTHLY" },
                    { label: "Theo gói", value: "COURSE" },
                  ]}
                  selected={type}
                  onSelect={(value) => {
                    markInput("type", value);
                    setValue("type", value as ClassType, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                />
              </Field>
              <Field controlId="class-fee" error={baseFeeError} label="Học phí">
                <SmartMoneyInput
                  id="class-fee"
                  value={baseFee ?? null}
                  required
                  ariaInvalid={Boolean(baseFeeError)}
                  ariaDescribedBy={baseFeeError ? "class-fee-error" : undefined}
                  onBlur={() => markBlur("base_fee")}
                  onDraftChange={(rawValue) => markInput("base_fee", rawValue)}
                  onChange={(value) => {
                    setValue("base_fee", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                  className={inputClass(Boolean(baseFeeError))}
                />
              </Field>
            </div>

            {type === "COURSE" ? (
              <Field error={billingCycleError} label="Thời lượng gói" labelId="class-duration-label">
                <input type="hidden" {...register("billing_cycle_months", { valueAsNumber: true })} />
                <SegmentedControl
                  ariaLabelledBy="class-duration-label"
                  options={COURSE_DURATION_OPTIONS.map((option) => ({
                    label: option.label,
                    value: String(option.months),
                  }))}
                  selected={String(billingCycleMonths)}
                  onSelect={(value) => {
                    markInput("billing_cycle_months", value);
                    setValue("billing_cycle_months", Number(value), {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                />
              </Field>
            ) : null}

            <Field error={teacherIdsError} errorId="class-teachers-error" label="Giáo viên" labelId="class-teachers-label">
              <input type="hidden" {...register("teacher_ids")} />
              {isTeachersLoading ? (
                <div role="status" className="form-input-text flex h-8 items-center gap-2 rounded-md border border-gray-200 px-3 text-gray-500">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Đang tải giáo viên
                </div>
              ) : isTeachersError && teachers.length === 0 ? (
                <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-100 bg-red-50 px-3 py-2">
                  <span className="helper-text text-red-700">Không tải được danh sách giáo viên.</span>
                  <button type="button" onClick={onRetryTeachers} className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 bg-white px-2 text-xs font-medium text-red-700 hover:bg-red-50">
                    <RefreshCw className="h-3 w-3" aria-hidden="true" /> Thử lại
                  </button>
                </div>
              ) : teachers.length > 0 ? (
                <div
                  role="group"
                  aria-labelledby="class-teachers-label"
                  aria-describedby={teacherIdsError ? "class-teachers-error" : undefined}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      markBlur("teacher_ids");
                    }
                  }}
                  className={`min-h-8 max-h-28 overflow-y-auto rounded-md border bg-white px-1.5 py-0.5 ${teacherIdsError ? "border-red-400 ring-2 ring-red-100" : "border-gray-200"}`}
                >
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                    {teachers.map((teacher) => {
                      const selected = teacherIds.includes(teacher.id);
                      const isLastSelectedTeacher = Boolean(
                        class_ && selected && teacherIds.length === 1,
                      );
                      return (
                        <span key={teacher.id} className="inline-flex min-w-0 items-center gap-1">
                          <InlineFieldDivider className="self-center" />
                          <button
                            type="button"
                            aria-pressed={selected}
                            aria-disabled={isLastSelectedTeacher || undefined}
                            disabled={!selected && teacherIds.length >= 10}
                            onClick={() => {
                              if (isLastSelectedTeacher) {
                                return;
                              }
                              const next = selected
                                ? teacherIds.filter((id) => id !== teacher.id)
                                : [...teacherIds, teacher.id];
                              markInput("teacher_ids", next);
                              setValue("teacher_ids", next, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }}
                            className={`form-input-text inline-flex h-7 max-w-[190px] items-center rounded-md px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-200 disabled:cursor-not-allowed disabled:opacity-45 ${selected ? "bg-gray-950 text-white" : "text-gray-700 hover:bg-gray-100 hover:text-gray-950"}`}
                          >
                            <span className="truncate">{teacher.full_name}</span>
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  {isTeachersError ? (
                    <p className="helper-text mt-1.5 px-1 text-amber-700" aria-live="polite">
                      Chưa cập nhật được danh sách mới nhất; đang dùng dữ liệu đã lưu.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-500">
                  Chưa có giáo viên đang hoạt động. Hãy thêm tại trang Nhân sự trước.
                </div>
              )}
            </Field>

            <Field
              error={scheduleError}
              errorId="class-schedule-error"
              label="Lịch học"
              labelId="class-schedule-label"
            >
              <button
                type="button"
                aria-label={`Lịch học: ${
                  scheduleValue?.slots.length
                    ? getClassScheduleSlotsLabel(scheduleValue.slots)
                    : scheduleValue?.text || "chưa thiết lập"
                }`}
                disabled={isTeachersLoading || teacherIds.length === 0}
                data-invalid={scheduleError ? "true" : undefined}
                aria-describedby={scheduleError ? "class-schedule-error" : undefined}
                onBlur={() => markBlur("schedule")}
                onClick={() => setIsSchedulePickerOpen(true)}
                className={`form-input-text min-h-8 w-full cursor-pointer rounded-md border bg-white px-1.5 py-1.5 text-left text-gray-700 outline-none transition-colors hover:border-gray-300 focus-visible:ring-2 focus-visible:ring-gray-200 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 ${scheduleError ? "border-red-400" : "border-gray-200"}`}
              >
                {isTeachersLoading ? (
                  "Đang tải giáo viên…"
                ) : teacherIds.length === 0 ? (
                  "Chọn giáo viên trước"
                ) : scheduleValue?.slots.length ? (
                  <ClassScheduleList
                    maxVisibleSlots={4}
                    slots={scheduleValue.slots}
                    variant="field"
                  />
                ) : (
                  <span className="block whitespace-normal break-words">
                    {scheduleValue?.text || "Thiết lập lịch học"}
                  </span>
                )}
              </button>
            </Field>
          </div>

          {shouldShowUnsavedNotice ? (
            <div className="shrink-0 px-4 pb-3 sm:px-5">
              <UnsavedChangesNotice
                hasChanges={hasUnsavedChanges}
                hasErrors={hasFormErrors}
                isSaving={isSaving}
              />
            </div>
          ) : null}

          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5">
            <Button type="button" variant="outline" className="h-8 rounded-md px-3 text-sm" disabled={isSaving} onClick={requestClose}>
              Huỷ
            </Button>
            <SaveButton
              type="submit"
              isSaving={isSaving}
              disabled={isTeachersLoading || teachers.length === 0 || Boolean(scheduleConflict) || Boolean(class_ && !hasUnsavedChanges)}
            />
          </div>
        </form>
      </div>

      <ScheduleGridSlide
        isOpen={isSchedulePickerOpen}
        currentValue={scheduleValue}
        occupiedSlots={occupiedSlots}
        onClose={() => setIsSchedulePickerOpen(false)}
        onSave={(value) => {
          setScheduleValue(value);
          markInput("schedule", value?.slots ?? value?.text ?? "");
        }}
      />
    </div>
  );

  return createPortal(dialog, document.body);
}

function Field({
  children,
  controlId,
  error,
  errorId: providedErrorId,
  label,
  labelId,
}: {
  children: React.ReactNode;
  controlId?: string;
  error?: string;
  errorId?: string;
  label: string;
  labelId?: string;
}) {
  const errorId = providedErrorId ?? (controlId ? `${controlId}-error` : undefined);
  return (
    <div className="space-y-1">
      {controlId ? (
        <label htmlFor={controlId} className="form-label-text block select-none text-[15px] text-gray-700">{label}</label>
      ) : (
        <span id={labelId} className="form-label-text block select-none text-[15px] text-gray-700">{label}</span>
      )}
      {children}
      {error ? <span id={errorId} role="alert" className="helper-text block text-red-600">{error}</span> : null}
    </div>
  );
}

function SegmentedControl({ ariaLabelledBy, onSelect, options, selected }: { ariaLabelledBy: string; onSelect: (value: string) => void; options: Array<{ label: string; value: string }>; selected: string }) {
  return (
    <div role="group" aria-labelledby={ariaLabelledBy} className={`grid h-8 overflow-hidden rounded-md border border-gray-200 bg-white p-0.5`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(option.value)}
            className={`form-input-text h-full rounded-[5px] px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-300 ${active ? "bg-gray-950 text-white" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function inputClass(hasError: boolean) {
  return `form-input-text h-8 w-full rounded-md border bg-white px-3 outline-none transition select-text ${hasError ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100" : "border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-200"}`;
}

function hasConfiguredSchedule(
  schedule: { text: string; slots: ScheduleSlot[] } | null,
) {
  return Boolean(schedule && (schedule.slots.length > 0 || schedule.text.trim()));
}

function getOccupiedSlots(classes: ClassResponse[], editingClassId: string | undefined, selectedTeacherIds: string[]): OccupiedScheduleSlot[] {
  const selected = new Set(selectedTeacherIds);
  if (selected.size === 0) return [];
  return classes
    .filter((class_) => class_.id !== editingClassId && getClassTeacherIds(class_).some((id) => selected.has(id)))
    .flatMap((class_) => getClassScheduleSlots(class_).map((slot) => ({ ...slot, className: class_.name })));
}

function findScheduleConflict(
  requestedSlots: ScheduleSlot[],
  occupiedSlots: OccupiedScheduleSlot[],
): OccupiedScheduleSlot | null {
  return occupiedSlots.find((occupied) =>
    requestedSlots.some(
      (requested) =>
        requested.day === occupied.day &&
        requested.start < occupied.end &&
        occupied.start < requested.end,
    ),
  ) ?? null;
}

function scheduleKey(schedule: { text: string; slots: ScheduleSlot[] } | null) {
  return JSON.stringify({
    text: schedule?.text.trim() ?? "",
    slots: [...(schedule?.slots ?? [])].sort((left, right) => `${left.day}-${left.start}-${left.end}`.localeCompare(`${right.day}-${right.start}-${right.end}`)),
  });
}

function normalizedClassFormKey(values: Partial<ClassFormInputValues>) {
  const type = values.type ?? "MONTHLY";
  return JSON.stringify({
    name: values.name?.trim() ?? "",
    type,
    base_fee: values.base_fee ?? null,
    billing_cycle_months:
      type === "MONTHLY"
        ? 1
        : normalizeCourseBillingMonths(values.billing_cycle_months ?? 3),
    teacher_ids: [...(values.teacher_ids ?? [])].sort(),
  });
}
