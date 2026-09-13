"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import {
  RiLoader4Line as LoaderCircle,
  RiRefreshLine as RefreshCw,
} from "react-icons/ri";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ClassScheduleList } from "@/components/classes/class-schedule-list";
import { ClassPackageDurationDialog } from "@/components/classes/class-package-duration-dialog";
import {
  createEntityDialogFrameClassName,
  editEntityDialogFrameClassName,
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { FormNotice } from "@/components/ui/form-notice";
import { FormSection } from "@/components/ui/form-section";
import { InlineFormError } from "@/components/ui/inline-form-error";
import {
  formTextControlClassName,
  formTextControlErrorClassName,
} from "@/components/ui/form-text-control";
import { SaveButton } from "@/components/ui/save-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SmartMoneyInput } from "@/components/ui/smart-money-input";
import { comparableManualDate, ManualDateInput, isValidIsoDate } from "@/components/ui/manual-date-input";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import type { ScheduleSlot } from "@/components/layout/weekly-schedule-board";
import {
  getClassScheduleSlotsLabel,
  normalizeCourseBillingMonths,
  normalizeCourseBillingWeeks,
} from "@/lib/classes/presentation";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { getClassScheduleAvailability, previewStaffAvailability } from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import type {
  ClassCreate,
  ClassCategory,
  ClassGradeMode,
  ClassIdentityScheme,
  ClassResponse,
  ClassType,
  ClassUpdate,
  StaffAvailabilityCandidateResponse,
  TeacherOptionResponse,
} from "@/lib/types";
import { validationMessages } from "@/lib/forms/validation-messages";
import {
  noSavedInfoFormProps,
  savedInfoAutocomplete,
} from "@/lib/forms/saved-info-policy";
import { useFormFieldFeedback } from "@/lib/forms/use-form-field-feedback";
import {
  isNativeTextEditingTarget,
  moveFocusByFormArrow,
} from "@/lib/forms/field-navigation";
import { collapseSelectionOnKeyboardFocus } from "@/lib/forms/keyboard-focus";
import { cn } from "@/lib/utils";

const ScheduleGridSlide = dynamic(
  () =>
    import("@/components/layout/schedule-grid-slide").then(
      (module) => module.ScheduleGridSlide,
    ),
  { ssr: false },
);

const MAX_CLASS_FEE = 999_999_999_999;
const CLASS_FORM_COLUMNS = "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";
const CLASS_FEEDBACK_FIELDS = [
  "name",
  "identity_scheme",
  "class_category",
  "grade_mode",
  "grade_level",
  "academic_year_start",
  "start_date",
  "start_date_change_reason",
  "type",
  "base_fee",
  "billing_cycle_months",
  "billing_cycle_weeks",
  "schedule",
] as const;

export const classFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, validationMessages.required("tên lớp"))
      .max(120, "Tên lớp không được vượt quá 120 ký tự."),
    identity_scheme: z.enum(["LEGACY", "ACADEMIC_YEAR", "INTAKE"]),
    class_category: z.enum(["GENERAL", "SPECIALIZED", "IELTS", "CUSTOM"]).nullable(),
    grade_mode: z.enum(["GRADE", "NONE"]),
    grade_level: z.number().int().min(1).max(12).nullable(),
    academic_year_start: z.number().int().min(2000).max(2200).nullable(),
    start_date: z.string(),
    start_date_change_reason: z.string().trim().max(500).default(""),
    type: z.enum(["MONTHLY", "COURSE"]),
    base_fee: z
      .number({ message: validationMessages.feeFormat })
      .min(0, validationMessages.feeNonNegative)
      .max(MAX_CLASS_FEE, "Học phí vượt quá giới hạn hệ thống.")
      .nullable()
      .refine((value) => value !== null, validationMessages.required("học phí"))
      .transform((value) => value as number),
    billing_cycle_months: z.number().int().min(1, validationMessages.billingCycle),
    billing_cycle_weeks: z.number().int().min(1, validationMessages.billingCycle).max(32_767).nullable(),
    teacher_ids: z.array(z.string().uuid()).max(10).default([]),
    assistant_ids: z.array(z.string().uuid()).max(10).default([]),
  })
  .superRefine((values, context) => {
    if (values.class_category === null) {
      context.addIssue({ code: "custom", path: ["class_category"], message: "Vui lòng chọn loại lớp." });
      return;
    }
    if (!isValidIsoDate(values.start_date)) {
      context.addIssue({ code: "custom", path: ["start_date"], message: "Ngày bắt đầu không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy." });
    }
    if (values.identity_scheme !== "LEGACY") {
      const expectedScheme = values.class_category === "IELTS" ? "INTAKE" : "ACADEMIC_YEAR";
      if (values.identity_scheme !== expectedScheme) {
        context.addIssue({ code: "custom", path: ["class_category"], message: "Thông tin loại lớp không nhất quán." });
      }
      if (
        values.class_category === "GENERAL" &&
        values.academic_year_start === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["academic_year_start"],
          message: "Vui lòng chọn năm học.",
        });
      }
      if (values.class_category === "GENERAL") {
        if (values.grade_mode !== "GRADE" || values.grade_level === null) {
          context.addIssue({ code: "custom", path: ["grade_level"], message: "Vui lòng chọn khối lớp." });
        }
      } else if (["SPECIALIZED", "CUSTOM"].includes(values.class_category)) {
        if (
          (values.grade_mode === "GRADE" && values.grade_level === null) ||
          (values.grade_mode === "NONE" && values.grade_level !== null)
        ) {
          context.addIssue({ code: "custom", path: ["grade_level"], message: "Vui lòng chọn khối lớp hoặc chọn Không." });
        }
        const hasGrade = values.grade_level !== null;
        const hasYear = values.academic_year_start !== null;
        if (hasGrade && !hasYear) {
          context.addIssue({
            code: "custom",
            path: ["academic_year_start"],
            message: "Vui lòng chọn năm học khi đã chọn khối lớp.",
          });
        } else if (!hasGrade && hasYear) {
          context.addIssue({
            code: "custom",
            path: ["grade_level"],
            message: "Vui lòng chọn khối lớp khi đã chọn năm học.",
          });
        }
      } else if (
        values.grade_mode !== "NONE" ||
        values.grade_level !== null ||
        values.academic_year_start !== null
      ) {
        context.addIssue({ code: "custom", path: ["class_category"], message: "Lớp IELTS không sử dụng khối lớp và năm học." });
      }
    }
    if (values.type === "COURSE" && values.billing_cycle_weeks === null) {
      context.addIssue({
        code: "custom",
        path: ["billing_cycle_weeks"],
        message: validationMessages.billingCycle,
      });
    }
  });

type ClassFormInputValues = z.input<typeof classFormSchema>;
type ClassFormValues = z.output<typeof classFormSchema>;

const DEFAULT_VALUES: ClassFormInputValues = {
  name: "",
  identity_scheme: "ACADEMIC_YEAR",
  class_category: "GENERAL",
  grade_mode: "GRADE",
  grade_level: 6,
  academic_year_start: getDefaultAcademicYearStart(),
  start_date: getVietnamTodayIso(),
  start_date_change_reason: "",
  type: "MONTHLY",
  base_fee: null,
  billing_cycle_months: 3,
  billing_cycle_weeks: null,
  teacher_ids: [],
  assistant_ids: [],
};

type ClassFormDialogProps = {
  class_: ClassResponse | null;
  /** Prefilled create payload used by flows such as "Tạo lớp kế tiếp". */
  initialValues?: ClassCreate | null;
  additionalSection?: ReactNode | ((draft: ClassFormDraftContext) => ReactNode);
  onDraftChange?: (draft: ClassFormDraftContext) => void;
  externalDirty?: boolean;
  externalSubmitDisabled?: boolean;
  submitLabel?: string;
  title?: string;
  /** Render without the modal shell so a parent workspace owns the overlay. */
  embedded?: boolean;
  isSaving: boolean;
  isTeachersError: boolean;
  isTeachersLoading: boolean;
  onClose: () => void;
  /** Reports unsaved-change state up to the workspace (dirty dot, confirm). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Reports when a nested picker slide opens so the workspace can suspend. */
  onNestedOverlayChange?: (open: boolean) => void;
  onPackageDurationChanged?: (class_: ClassResponse) => void;
  onRetryTeachers: () => void;
  onSubmit: (payload: ClassCreate | ClassUpdate) => void;
  teachers: TeacherOptionResponse[];
};

export type ClassFormDraftContext = {
  baseFee: number | null;
  schedule: { text: string; slots: ScheduleSlot[] } | null;
};

type PreviewState = {
  isChecking: boolean;
  error: string | null;
  canApply: boolean;
  candidates: StaffAvailabilityCandidateResponse[];
  draftKey: string;
};

export function ClassFormDialog({
  class_,
  initialValues = null,
  additionalSection,
  onDraftChange,
  externalDirty = false,
  externalSubmitDisabled = false,
  submitLabel,
  title,
  embedded = false,
  isSaving,
  isTeachersError,
  isTeachersLoading,
  onClose,
  onDirtyChange,
  onNestedOverlayChange,
  onRetryTeachers,
  onPackageDurationChanged,
  onSubmit,
  teachers,
}: ClassFormDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [isPackageDurationOpen, setIsPackageDurationOpen] = useState(false);
  const [isSchedulePickerOpen, setIsSchedulePickerOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState<{ text: string; slots: ScheduleSlot[] } | null>(null);
  const [initialScheduleKey, setInitialScheduleKey] = useState(scheduleKey(null));

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
  const customName = useWatch({ control, name: "name" });
  const identityScheme = useWatch({ control, name: "identity_scheme" });
  const classCategory = useWatch({ control, name: "class_category" });
  const gradeLevel = useWatch({ control, name: "grade_level" });
  const academicYearStart = useWatch({ control, name: "academic_year_start" });
  const startDate = useWatch({ control, name: "start_date" });
  const startDateChangeReason = useWatch({ control, name: "start_date_change_reason" }) ?? "";
  const baseFee = useWatch({ control, name: "base_fee" });
  const billingCycleWeeks = useWatch({ control, name: "billing_cycle_weeks" });
  const watchedFormValues = useWatch({ control });

  const activeClassLabel = class_?.name || initialValues?.name || customName?.trim() || "Lớp này";

  // Candidate staff IDs: exact set union of all slot teacher_ids and assistant_ids
  const candidateStaffIds = useMemo(() => {
    const ids = new Set<string>();
    for (const slot of scheduleValue?.slots ?? []) {
      for (const id of slot.teacher_ids ?? []) ids.add(id);
      for (const id of slot.assistant_ids ?? []) ids.add(id);
    }
    return Array.from(ids).sort();
  }, [scheduleValue?.slots]);

  // Strict invariant: A staff member CANNOT be both Teacher and Assistant in the same class
  const hasRoleOverlap = useMemo(() => {
    const teacherIdSet = new Set<string>();
    const assistantIdSet = new Set<string>();
    for (const slot of scheduleValue?.slots ?? []) {
      for (const id of slot.teacher_ids ?? []) teacherIdSet.add(id);
      for (const id of slot.assistant_ids ?? []) assistantIdSet.add(id);
    }
    for (const id of teacherIdSet) {
      if (assistantIdSet.has(id)) return true;
    }
    return false;
  }, [scheduleValue?.slots]);

  // DraftKey fingerprint for state machine
  const draftKey = useMemo(() => {
    const slotFingerprint = (scheduleValue?.slots ?? [])
      .map(
        (s) =>
          `${s.day}_${s.start}_${s.end}_${[...(s.teacher_ids ?? [])].sort().join(",")}_${[...(s.assistant_ids ?? [])].sort().join(",")}`,
      )
      .sort()
      .join(";");
    return `${class_?.id ?? "new"}|${class_?.version ?? 0}|${startDate ?? ""}|${slotFingerprint}|${candidateStaffIds.join(",")}`;
  }, [candidateStaffIds, class_?.id, class_?.version, scheduleValue?.slots, startDate]);

  const [previewState, setPreviewState] = useState<PreviewState>({
    isChecking: false,
    error: null,
    canApply: true,
    candidates: [],
    draftKey: "",
  });

  // State machine preview effect: 300ms debounce, AbortController, draftKey validation
  useEffect(() => {
    // If no candidate staff are selected, preview is NOT called: UNASSIGNED is allowed.
    if (candidateStaffIds.length === 0) {
      setPreviewState({
        isChecking: false,
        error: null,
        canApply: true,
        candidates: [],
        draftKey,
      });
      return;
    }

    if (hasRoleOverlap || !startDate || !isValidIsoDate(startDate) || (scheduleValue?.slots.length ?? 0) === 0) {
      setPreviewState({
        isChecking: false,
        error: hasRoleOverlap ? "Một nhân sự không thể vừa là giáo viên vừa là trợ giảng trong cùng lớp" : null,
        canApply: false,
        candidates: [],
        draftKey,
      });
      return;
    }

    // Immediately clear old valid preview and lock save while checking
    setPreviewState((prev) => ({
      ...prev,
      isChecking: true,
      error: null,
      canApply: false,
      draftKey,
    }));

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await previewStaffAvailability(
          {
            class_id: class_?.id,
            expected_version: class_?.version,
            start_date: startDate,
            schedule: {
              text: scheduleValue?.text ?? "",
              slots: (scheduleValue?.slots ?? []).map((s) => ({
                day: s.day as ScheduleSlot["day"],
                start: s.start,
                end: s.end,
                teacher_ids: s.teacher_ids ?? [],
                assistant_ids: s.assistant_ids ?? [],
                id: s.id,
                version: s.version,
              })),
            },
            candidate_staff_ids: candidateStaffIds,
          },
          { signal: controller.signal },
        );

        // Stale response guard: only commit if response matches current draftKey
        setPreviewState((current) => {
          if (current.draftKey !== draftKey) {
            return current;
          }
          return {
            isChecking: false,
            error: null,
            canApply: response.can_apply,
            candidates: response.candidates,
            draftKey,
          };
        });
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setPreviewState((current) => {
          if (current.draftKey !== draftKey) return current;
          return {
            isChecking: false,
            error: getApiErrorMessage(
              err,
              "Không thể kiểm tra lịch bận nhân sự. Vui lòng thử lại.",
            ),
            canApply: false,
            candidates: [],
            draftKey,
          };
        });
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [candidateStaffIds, class_?.id, class_?.version, draftKey, hasRoleOverlap, scheduleValue, startDate]);

  // Map conflicts specifically to matching slot & role
  const slotConflicts = useMemo(() => {
    const conflictsBySlotKey = new Map<
      string,
      Array<{ staffName: string; role: "TEACHER" | "ASSISTANT"; message: string }>
    >();
    if (!previewState.candidates) return conflictsBySlotKey;

    for (const slot of scheduleValue?.slots ?? []) {
      const slotKey = `${slot.day}-${slot.start}-${slot.end}`;
      const slotConflictList: Array<{
        staffName: string;
        role: "TEACHER" | "ASSISTANT";
        message: string;
      }> = [];

      for (const candidate of previewState.candidates) {
        const isAssignedTeacher = (slot.teacher_ids ?? []).includes(candidate.staff_id);
        const isAssignedAssistant = (slot.assistant_ids ?? []).includes(candidate.staff_id);
        if (!isAssignedTeacher && !isAssignedAssistant) continue;

        const role = isAssignedTeacher ? "TEACHER" : "ASSISTANT";
        const staffName =
          teachers.find((t) => t.id === candidate.staff_id)?.full_name ?? "Nhân sự";

        for (const conflict of candidate.conflicts) {
          if (
            conflict.day === slot.day &&
            conflict.start < slot.end &&
            slot.start < conflict.end
          ) {
            slotConflictList.push({
              staffName,
              role,
              message: `${staffName} (${role === "TEACHER" ? "Giáo viên" : "Trợ giảng"}) trùng lịch với lớp ${conflict.class_name} (${conflict.day} ${conflict.start}–${conflict.end})`,
            });
          }
        }
      }
      if (slotConflictList.length > 0) {
        conflictsBySlotKey.set(slotKey, slotConflictList);
      }
    }
    return conflictsBySlotKey;
  }, [previewState.candidates, scheduleValue?.slots, teachers]);

  const updateSlotStaff = useCallback(
    (slotIndex: number, field: "teacher_ids" | "assistant_ids", staffIds: string[]) => {
      setScheduleValue((prev) => {
        if (!prev) return prev;
        const nextSlots = prev.slots.map((slot, i) => {
          if (i !== slotIndex) return slot;
          return {
            ...slot,
            [field]: staffIds,
          };
        });
        return {
          ...prev,
          slots: nextSlots,
        };
      });
    },
    [],
  );

  // Availability query for occupied schedule blocks of all other classes
  const availabilityQuery = useQuery({
    queryKey: classQueryKeys.availability({
      classId: class_?.id ?? null,
      startDate,
      teacherIds: [],
      assistantIds: [],
      scope: "all_classes",
    }),
    queryFn: () =>
      getClassScheduleAvailability({
        class_id: class_?.id,
        start_date: startDate,
        scope: "all_classes",
        teacher_ids: [],
        assistant_ids: [],
      }),
    enabled:
      Boolean(mounted) &&
      isSchedulePickerOpen &&
      Boolean(startDate) &&
      isValidIsoDate(startDate),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const occupiedSlots = useMemo(
    () =>
      (availabilityQuery.data ?? []).map((conflict) => ({
        day: conflict.day,
        start: conflict.start,
        end: conflict.end,
        classId: conflict.class_id,
        className: conflict.class_name,
        classCategory: conflict.class_category,
        gradeLevel: conflict.grade_level,
        busyTeacherIds: conflict.busy_teacher_ids,
        busyAssistantIds: conflict.busy_assistant_ids,
      })),
    [availabilityQuery.data],
  );

  const missingScheduleDates = !startDate || !isValidIsoDate(startDate);
  const occupiedLoading =
    Boolean(availabilityQuery.isFetching) && !availabilityQuery.isSuccess;
  const occupiedError = missingScheduleDates
    ? "Vui lòng chọn ngày bắt đầu trước khi thiết lập lịch học."
    : availabilityQuery.isError
      ? getApiErrorMessage(
          availabilityQuery.error,
          "Không tải được lịch bận. Vui lòng thử lại.",
        )
      : null;

  const scheduleRequiredError =
    !class_ && !hasConfiguredSchedule(scheduleValue)
      ? validationMessages.selectRequired("lịch học")
      : undefined;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const initialRecord = class_ ?? initialValues;
    const normalizedBillingWeeks =
      initialRecord?.type === "COURSE"
        ? normalizeCourseBillingWeeks(
            initialRecord.billing_cycle_weeks,
            initialRecord.billing_cycle_months,
          )
        : null;

    const nextSchedule = initialRecord?.schedule
      ? {
          text: initialRecord.schedule?.text ?? "",
          slots: (initialRecord.schedule?.slots ?? []).map((slot) => ({
            ...slot,
            teacher_ids:
              slot.teacher_ids && slot.teacher_ids.length > 0
                ? slot.teacher_ids
                : initialRecord.teacher_ids?.length === 1
                  ? initialRecord.teacher_ids
                  : [],
            assistant_ids:
              slot.assistant_ids && slot.assistant_ids.length > 0
                ? slot.assistant_ids
                : initialRecord.assistant_ids?.length === 1
                  ? initialRecord.assistant_ids
                  : [],
          })),
        }
      : null;

    reset(
      initialRecord
        ? {
            name: initialRecord.name,
            identity_scheme: initialRecord.identity_scheme,
            class_category: initialRecord.class_category,
            grade_mode: initialRecord.grade_mode ?? (initialRecord.grade_level ? "GRADE" : "NONE"),
            grade_level: initialRecord.grade_level ?? null,
            academic_year_start: initialRecord.academic_year_start ?? null,
            start_date: initialRecord.start_date ?? "",
            start_date_change_reason: "",
            type: initialRecord.type,
            base_fee: initialRecord.base_fee,
            billing_cycle_months:
              initialRecord.type === "COURSE"
                ? normalizeCourseBillingMonths(initialRecord.billing_cycle_months)
                : 3,
            billing_cycle_weeks:
              initialRecord.type === "COURSE" ? normalizedBillingWeeks : null,
            teacher_ids: initialRecord.teacher_ids ?? [],
            assistant_ids: initialRecord.assistant_ids ?? [],
          }
        : DEFAULT_VALUES,
    );
    setScheduleValue(nextSchedule);
    setInitialScheduleKey(scheduleKey(nextSchedule));
    resetFeedback();
  }, [class_, initialValues, reset, resetFeedback]);

  const baselineRecord = class_ ?? initialValues;
  const hasCommittedStartDateChange = Boolean(
    class_ &&
      startDate &&
      isValidIsoDate(startDate) &&
      startDate !== class_.start_date,
  );

  const hasUnsavedChanges = Boolean(
    externalDirty ||
    (baselineRecord &&
      (normalizedClassFormKey({
        ...watchedFormValues,
        start_date:
          comparableManualDate(
            watchedFormValues.start_date,
            baselineRecord.start_date,
          ) ?? undefined,
        start_date_change_reason: hasCommittedStartDateChange
          ? watchedFormValues.start_date_change_reason
          : "",
      }) !==
        normalizedClassFormKey({
          name: baselineRecord.name,
          identity_scheme: baselineRecord.identity_scheme,
          class_category: baselineRecord.class_category,
          grade_mode: baselineRecord.grade_mode ?? (baselineRecord.grade_level ? "GRADE" : "NONE"),
          grade_level: baselineRecord.grade_level ?? null,
          academic_year_start: baselineRecord.academic_year_start ?? null,
          start_date: baselineRecord.start_date ?? "",
          start_date_change_reason: "",
          type: baselineRecord.type,
          base_fee: baselineRecord.base_fee,
          billing_cycle_months:
            baselineRecord.type === "COURSE"
              ? normalizeCourseBillingMonths(baselineRecord.billing_cycle_months)
              : 3,
          billing_cycle_weeks:
            baselineRecord.type === "COURSE"
              ? normalizeCourseBillingWeeks(
                  baselineRecord.billing_cycle_weeks,
                  baselineRecord.billing_cycle_months,
                )
              : null,
          teacher_ids: baselineRecord.teacher_ids ?? [],
          assistant_ids: baselineRecord.assistant_ids ?? [],
        }) ||
        scheduleKey(scheduleValue) !== initialScheduleKey)),
  );

  const hasFormErrors =
    !classFormSchema.safeParse(watchedFormValues).success ||
    Object.keys(errors).length > 0 ||
    Boolean(scheduleRequiredError) ||
    hasRoleOverlap ||
    (candidateStaffIds.length > 0 && (!previewState.canApply || previewState.isChecking || Boolean(previewState.error))) ||
    Boolean(
      hasCommittedStartDateChange &&
        startDateChangeReason.trim().length < 3,
    );

  const shouldShowUnsavedNotice = shouldShowUnsavedChanges({
    hasChanges: hasUnsavedChanges,
    hasErrors: hasFormErrors,
    isSaving,
  });

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    onDraftChange?.({ baseFee: baseFee ?? null, schedule: scheduleValue });
  }, [baseFee, onDraftChange, scheduleValue]);

  useEffect(() => {
    onNestedOverlayChange?.(isSchedulePickerOpen);
  }, [isSchedulePickerOpen, onNestedOverlayChange]);

  const nameError = shouldShowError("name", isSubmitted)
    ? errors.name?.message
    : undefined;
  const identityError = shouldShowError("class_category", isSubmitted) || shouldShowError("identity_scheme", isSubmitted)
    ? errors.class_category?.message ?? errors.identity_scheme?.message
    : undefined;
  const gradeLevelError = shouldShowError("grade_level", isSubmitted)
    ? errors.grade_level?.message
    : undefined;
  const academicYearError = shouldShowError("academic_year_start", isSubmitted)
    ? errors.academic_year_start?.message
    : undefined;
  const startDateError = shouldShowError("start_date", isSubmitted)
    ? errors.start_date?.message
    : undefined;
  const typeError = shouldShowError("type", isSubmitted)
    ? errors.type?.message
    : undefined;
  const baseFeeError = shouldShowError("base_fee", isSubmitted)
    ? errors.base_fee?.message
    : undefined;
  const billingCycleError = shouldShowError(
    "billing_cycle_weeks",
    isSubmitted,
  )
    ? errors.billing_cycle_weeks?.message
    : undefined;
  const scheduleError = shouldShowError("schedule", isSubmitted)
    ? scheduleRequiredError
    : undefined;

  const billingModeLocked = Boolean(class_ && !class_.can_edit_billing_mode);
  const billingConfigurationLocked = Boolean(class_);
  if (!mounted) return null;

  const pickerSlides = (
    <>
      <ScheduleGridSlide
        isOpen={isSchedulePickerOpen}
        currentValue={scheduleValue}
        occupiedSlots={occupiedSlots}
        occupiedLoading={occupiedLoading}
        occupiedError={occupiedError}
        onRetryOccupied={() => void availabilityQuery.refetch()}
        selectedTeachers={[]}
        selectedAssistants={[]}
        classLabel={activeClassLabel}
        scheduleMode="class-schedule"
        onClose={() => setIsSchedulePickerOpen(false)}
        onSave={(value) => {
          setScheduleValue((prev) => {
            if (!value) return null;
            const prevSlots = prev?.slots ?? [];
            const nextSlots = value.slots.map((newSlot) => {
              const matched = prevSlots.find(
                (p) => p.day === newSlot.day && p.start === newSlot.start && p.end === newSlot.end,
              );
              return {
                ...newSlot,
                id: matched?.id ?? newSlot.id,
                version: matched?.version ?? newSlot.version,
                teacher_ids: matched?.teacher_ids ?? newSlot.teacher_ids ?? [],
                assistant_ids: matched?.assistant_ids ?? newSlot.assistant_ids ?? [],
              };
            });
            return {
              text: value.text ?? "",
              slots: nextSlots,
            };
          });
          markInput("schedule", value?.slots ?? value?.text ?? "");
        }}
      />
      {isPackageDurationOpen && class_ ? (
        <ClassPackageDurationDialog
          class_={class_}
          onClose={() => {
            setIsPackageDurationOpen(false);
            onNestedOverlayChange?.(false);
          }}
          onApplied={(updatedClass) => {
            setValue("billing_cycle_weeks", updatedClass.billing_cycle_weeks ?? null, {
              shouldDirty: false,
              shouldValidate: true,
            });
            onPackageDurationChanged?.(updatedClass);
          }}
        />
      ) : null}
    </>
  );

  const editForm = (
    <form
      {...noSavedInfoFormProps}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      data-vertical-arrow-scope="class-primary"
      onKeyDown={moveFocusByFormArrow}
      onSubmit={(event) => {
        markSubmitted();
        void handleSubmit((values) => {
          if (scheduleRequiredError) {
            return;
          }
          if (!values.class_category) {
            return;
          }
          if (hasRoleOverlap) {
            return;
          }
          if (candidateStaffIds.length > 0 && !previewState.canApply) {
            return;
          }

          const allTeacherIds = Array.from(
            new Set((scheduleValue?.slots ?? []).flatMap((slot) => slot.teacher_ids ?? [])),
          );
          const allAssistantIds = Array.from(
            new Set((scheduleValue?.slots ?? []).flatMap((slot) => slot.assistant_ids ?? [])),
          );

          onSubmit({
            name: values.name.trim(),
            type: values.type,
            base_fee: values.base_fee,
            billing_cycle_months: 1,
            billing_cycle_weeks:
              values.type === "COURSE" ? values.billing_cycle_weeks : null,
            schedule: scheduleValue,
            teacher_ids: allTeacherIds,
            assistant_ids: allAssistantIds,
            identity_scheme: values.class_category === "IELTS" ? "INTAKE" : "ACADEMIC_YEAR",
            class_category: values.class_category,
            grade_mode: values.class_category === "IELTS" ? "NONE" : values.grade_mode,
            program_name: null,
            grade_level:
              values.class_category !== "IELTS" && values.grade_mode === "GRADE"
                ? values.grade_level
                : null,
            academic_year_start:
              values.class_category === "IELTS" ? null : values.academic_year_start,
            start_date: values.start_date,
            ...(class_ && values.start_date !== class_.start_date
              ? {
                  start_date_change_reason: values.start_date_change_reason.trim(),
                }
              : {}),
            ...(class_
              ? {
                  expected_version: class_.version,
                }
              : {}),
            ...(!class_ && initialValues?.source_class_id
              ? { source_class_id: initialValues.source_class_id }
              : {}),
          });
        })(event);
      }}
    >
      <FormDialogBody>
        <FormSection label="Thông tin lớp học" order={1}>
          <div className={`grid gap-3 ${CLASS_FORM_COLUMNS}`}>
            <FormField className="min-w-0 sm:col-span-2" error={identityError} label="Loại lớp" labelId="class-identity-label">
              {!classCategory ? (
                <FormNotice tone="warning">Lớp chưa được phân loại. Chọn loại lớp để hoàn thiện hồ sơ mà không suy đoán từ tên.</FormNotice>
              ) : null}
              <input type="hidden" {...register("identity_scheme")} />
              <input type="hidden" {...register("class_category")} />
              <input type="hidden" {...register("grade_mode")} />
              <SegmentedControl
                ariaLabelledBy="class-identity-label"
                options={[
                  { label: "Phổ thông", value: "GENERAL" },
                  { label: "Thi Chuyên", value: "SPECIALIZED" },
                  { label: "IELTS", value: "IELTS" },
                  { label: "Custom", value: "CUSTOM" },
                ]}
                selected={classCategory ?? ""}
                onSelect={(value) => {
                  const category = value as ClassCategory;
                  const nextScheme: Exclude<ClassIdentityScheme, "LEGACY"> = category === "IELTS" ? "INTAKE" : "ACADEMIC_YEAR";
                  const isGradeBased = category === "GENERAL";
                  const nextGradeMode: ClassGradeMode = isGradeBased ? "GRADE" : "NONE";
                  markInput("identity_scheme", value);
                  setValue("class_category", category, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setValue("identity_scheme", nextScheme, { shouldDirty: true, shouldValidate: true });
                  setValue("grade_mode", nextGradeMode, { shouldDirty: true, shouldValidate: true });
                  if (isGradeBased) {
                    if (gradeLevel === null) {
                      setValue("grade_level", 6, { shouldDirty: true, shouldValidate: true });
                    }
                    if (academicYearStart === null) {
                      setValue("academic_year_start", getDefaultAcademicYearStart(), { shouldDirty: true, shouldValidate: true });
                    }
                  } else {
                    setValue("grade_level", null, { shouldDirty: true, shouldValidate: true });
                    setValue("academic_year_start", null, { shouldDirty: true, shouldValidate: true });
                  }
                }}
              />
            </FormField>
            {identityScheme !== "LEGACY" && classCategory && classCategory !== "IELTS" ? (
              <>
                <FormField className="min-w-0" controlId="class-grade" error={gradeLevelError} label="Khối lớp">
                  <select
                    id="class-grade"
                    key={classCategory}
                    {...register("grade_level", {
                      setValueAs: (value) => (value ? Number(value) : null),
                      onChange: (event) => {
                        const nextMode: ClassGradeMode = event.target.value ? "GRADE" : "NONE";
                        markInput("grade_level", event.target.value);
                        markInput("grade_mode", nextMode);
                        setValue("grade_mode", nextMode, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      },
                      onBlur: () => markBlur("grade_level"),
                    })}
                    aria-invalid={Boolean(gradeLevelError)}
                    className={`${formTextControlClassName} appearance-none bg-white px-3 ${gradeLevelError ? formTextControlErrorClassName : ""}`}
                  >
                    {Array.from({ length: 12 }, (_, index) => index + 1).map((grade) => (
                      <option key={grade} value={grade}>Lớp {grade}</option>
                    ))}
                    {classCategory !== "GENERAL" ? <option value="">Không</option> : null}
                  </select>
                </FormField>
                <FormField className="min-w-0" controlId="class-academic-year" error={academicYearError} label="Năm học">
                  <select
                    id="class-academic-year"
                    key={classCategory}
                    {...register("academic_year_start", {
                      setValueAs: (value) => (value ? Number(value) : null),
                      onChange: (event) => markInput("academic_year_start", event.target.value),
                      onBlur: () => markBlur("academic_year_start"),
                    })}
                    aria-invalid={Boolean(academicYearError)}
                    className={`${formTextControlClassName} appearance-none bg-white px-3 ${academicYearError ? formTextControlErrorClassName : ""}`}
                  >
                    {getAcademicYearOptions().map((year) => (
                      <option key={year} value={year}>{year}–{year + 1}</option>
                    ))}
                    {classCategory !== "GENERAL" ? <option value="">Không</option> : null}
                  </select>
                </FormField>
              </>
            ) : (
              <FormField className="min-w-0 sm:col-span-2" controlId="class-name" error={nameError} label="Tên lớp">
                <input
                  id="class-name"
                  {...register("name", {
                    onChange: (event) => markInput("name", event.target.value),
                    onBlur: () => markBlur("name"),
                  })}
                  maxLength={120}
                  autoComplete={savedInfoAutocomplete.disabled}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? "class-name-error" : undefined}
                  className={inputClass(Boolean(nameError))}
                  data-row={0}
                  data-col={1}
                  data-vertical-arrow-scope="class-primary"
                />
              </FormField>
            )}
          </div>

          {identityScheme !== "LEGACY" && classCategory ? (
            <>
              <div className={`grid gap-3 ${CLASS_FORM_COLUMNS}`}>
                {classCategory !== "IELTS" ? (
                  <FormField className="min-w-0" controlId="class-name" error={nameError} label="Tên lớp">
                    <input
                      id="class-name"
                      {...register("name", {
                        onChange: (event) => markInput("name", event.target.value),
                        onBlur: () => markBlur("name"),
                      })}
                      maxLength={120}
                      autoComplete={savedInfoAutocomplete.disabled}
                      aria-invalid={Boolean(nameError)}
                      aria-describedby={nameError ? "class-name-error" : undefined}
                      className={inputClass(Boolean(nameError))}
                      data-row={0}
                      data-col={1}
                      data-vertical-arrow-scope="class-primary"
                    />
                  </FormField>
                ) : null}
                <FormField
                  className={cn("min-w-0", classCategory === "IELTS" && "sm:col-span-2")}
                  controlId="class-start-date"
                  error={startDateError}
                  label="Ngày bắt đầu"
                >
                  <ManualDateInput
                    id="class-start-date"
                    value={startDate ?? null}
                    onChange={(value) => {
                      markInput("start_date", value ?? "");
                      setValue("start_date", value ?? "", {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                    onBlur={() => markBlur("start_date")}
                    error={Boolean(startDateError)}
                    ariaLabel="Ngày bắt đầu"
                    ariaDescribedBy={startDateError ? "class-start-date-error" : undefined}
                    dataRow={2}
                    dataCol={1}
                  />
                </FormField>
              </div>
              {hasCommittedStartDateChange ? (
                <FormField
                  controlId="class-start-date-reason"
                  label="Lý do đổi ngày bắt đầu"
                  error={
                    startDateChangeReason.trim().length < 3
                      ? "Vui lòng nhập ít nhất 3 ký tự."
                      : undefined
                  }
                >
                  <input
                    id="class-start-date-reason"
                    {...register("start_date_change_reason", {
                      onChange: (event) => markInput("start_date_change_reason", event.target.value),
                      onBlur: () => markBlur("start_date_change_reason"),
                    })}
                    maxLength={500}
                    autoComplete={savedInfoAutocomplete.disabled}
                    className={inputClass(startDateChangeReason.trim().length < 3)}
                  />
                </FormField>
              ) : null}
            </>
          ) : null}
        </FormSection>

        <FormSection label="Học phí và thời hạn" order={2}>
          <div className={`grid gap-3 ${CLASS_FORM_COLUMNS}`}>
            <FormField error={typeError} label="Hình thức đóng học phí" labelId="class-type-label">
              <input type="hidden" {...register("type")} />
              <SegmentedControl
                ariaLabelledBy="class-type-label"
                disabled={billingModeLocked}
                options={[
                  { label: "Theo tháng", value: "MONTHLY" },
                  { label: "Theo gói", value: "COURSE" },
                ]}
                selected={type}
                onSelect={(value) => {
                  if (billingModeLocked || value === type) return;
                  markInput("type", value);
                  setValue("type", value as ClassType, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setValue(
                    "billing_cycle_weeks",
                    value === "COURSE" ? billingCycleWeeks : null,
                    { shouldDirty: true, shouldValidate: true },
                  );
                }}
              />
            </FormField>
            <FormField controlId="class-fee" error={baseFeeError} label="Học phí">
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
                dataRow={5}
                dataCol={0}
                dataVerticalArrowScope="class-primary"
              />
            </FormField>
          </div>

          {type === "COURSE" ? (
            <>
              <input type="hidden" {...register("billing_cycle_months", { valueAsNumber: true })} />
              <FormField controlId="class-duration-weeks" error={billingCycleError} label="Thời lượng mỗi gói">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-md border border-gray-200 bg-white">
                    <input
                      id="class-duration-weeks"
                      type="text"
                      inputMode="numeric"
                      disabled={billingConfigurationLocked}
                      value={billingCycleWeeks ?? ""}
                      maxLength={5}
                      autoComplete={savedInfoAutocomplete.disabled}
                      aria-invalid={Boolean(billingCycleError)}
                      aria-describedby={billingCycleError ? "class-duration-weeks-error" : undefined}
                      data-row={6}
                      data-col={0}
                      data-vertical-arrow-scope="class-primary"
                      onFocus={collapseSelectionOnKeyboardFocus}
                      onChange={(event) => {
                        const rawValue = event.target.value.replace(/\D/g, "").slice(0, 5);
                        setValue("billing_cycle_weeks", rawValue === "" ? null : Number(rawValue), { shouldDirty: true, shouldValidate: true });
                      }}
                      onBlur={() => markBlur("billing_cycle_weeks")}
                      className="form-input-text h-full w-full bg-transparent px-3 pr-12 outline-none"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center form-input-text text-gray-500">tuần</span>
                  </div>
                  {class_?.can_edit_package_duration ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={hasUnsavedChanges || isSaving}
                      title={
                        hasUnsavedChanges
                          ? "Hãy lưu các thay đổi trong biểu mẫu trước"
                          : undefined
                      }
                      onClick={() => {
                        setIsPackageDurationOpen(true);
                        onNestedOverlayChange?.(true);
                      }}
                    >
                      Điều chỉnh
                    </Button>
                  ) : null}
                </div>
              </FormField>
            </>
          ) : null}
        </FormSection>

        <FormSection label="Lịch học trong tuần" order={3} summary={`${scheduleValue?.slots.length ?? 0} buổi/tuần`}>
          <FormField
            error={scheduleError}
            errorId="class-schedule-error"
            label="Các buổi trong tuần"
            labelId="class-schedule-label"
            visuallyHiddenLabel
          >
            <button
              type="button"
              aria-label={`Lịch học: ${
                scheduleValue?.slots.length
                  ? getClassScheduleSlotsLabel(scheduleValue.slots)
                  : scheduleValue?.text || "chưa thiết lập"
              }`}
              data-invalid={scheduleError ? "true" : undefined}
              aria-describedby={scheduleError ? "class-schedule-error" : undefined}
              onBlur={() => markBlur("schedule")}
              onClick={() => setIsSchedulePickerOpen(true)}
              className={cn(
                "form-input-text min-h-8 w-full cursor-pointer rounded-md border bg-white px-2 py-2 text-left text-gray-700 outline-none transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400",
                scheduleError ? "border-destructive focus-visible:!border-destructive focus-visible:!ring-destructive/30" : "border-gray-200 focus-visible:ring-primary/15",
              )}
            >
              {scheduleValue?.slots.length ? (
                <ClassScheduleList
                  maxVisibleSlots={4}
                  slots={scheduleValue.slots}
                  variant="field"
                />
              ) : (
                <span className="block text-gray-500">
                  {scheduleValue?.text || "Thiết lập lịch học trong tuần"}
                </span>
              )}
            </button>
          </FormField>
        </FormSection>

        <FormSection label="Phân công nhân sự theo lịch học" order={4} summary={candidateStaffIds.length === 0 ? "Chưa phân công" : `${candidateStaffIds.length} nhân sự`}>
          {isTeachersLoading ? (
            <div role="status" className="flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-gray-50/50 px-3 text-xs text-gray-500">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
              <span>Đang tải danh sách nhân sự...</span>
            </div>
          ) : isTeachersError && teachers.length === 0 ? (
            <InlineFormError
              action={
                <button
                  type="button"
                  onClick={onRetryTeachers}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-destructive hover:bg-destructive-soft"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" /> Thử lại
                </button>
              }
            >
              Không tải được danh sách nhân sự. Bạn vẫn có thể lưu lớp mà không phân công nhân sự.
            </InlineFormError>
          ) : (!scheduleValue?.slots || scheduleValue.slots.length === 0) ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50/50 p-3 text-center text-xs text-gray-500">
              Vui lòng chọn lịch học ở bước trên trước khi phân công nhân sự.
            </div>
          ) : (
            <div className="space-y-3">
              {hasRoleOverlap ? (
                <div role="alert" className="rounded-md border border-destructive/20 bg-destructive-soft/50 p-2 text-xs font-medium text-destructive">
                  Một nhân sự không thể vừa là giáo viên vừa là trợ giảng trong cùng lớp.
                </div>
              ) : null}

              {previewState.isChecking ? (
                <div role="status" className="flex items-center gap-2 text-xs text-gray-500">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                  <span>Đang kiểm tra lịch bận nhân sự...</span>
                </div>
              ) : previewState.error ? (
                <InlineFormError
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewState((prev) => ({ ...prev, draftKey: "" }));
                      }}
                      className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs font-medium text-destructive hover:bg-destructive-soft"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden="true" /> Thử lại
                    </button>
                  }
                >
                  {previewState.error}
                </InlineFormError>
              ) : null}

              {scheduleValue.slots.map((slot, index) => {
                const slotKey = `${slot.day}-${slot.start}-${slot.end}`;
                const assignedTeacherId = slot.teacher_ids?.[0] ?? "";
                const assignedAssistantId = slot.assistant_ids?.[0] ?? "";
                const conflictsForSlot = slotConflicts.get(slotKey) ?? [];

                return (
                  <div
                    key={slotKey}
                    className="rounded-lg border border-gray-200 bg-gray-50/40 p-3 transition-colors hover:border-gray-300"
                  >
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-800">
                        Buổi {index + 1}: {slot.day} · {slot.start}–{slot.end}
                      </span>
                      {slot.id ? (
                        <span className="text-[11px] font-normal text-gray-400">Ca hiện hữu</span>
                      ) : null}
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor={`slot-teacher-${index}`}
                          className="mb-1 block text-xs font-medium text-gray-600"
                        >
                          Giáo viên
                        </label>
                        <select
                          id={`slot-teacher-${index}`}
                          value={assignedTeacherId}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateSlotStaff(index, "teacher_ids", val ? [val] : []);
                          }}
                          className={cn(
                            formTextControlClassName,
                            "h-8 text-xs bg-white",
                            conflictsForSlot.some((c) => c.role === "TEACHER") && formTextControlErrorClassName,
                          )}
                        >
                          <option value="">-- Chưa phân công --</option>
                          {teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.full_name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor={`slot-assistant-${index}`}
                          className="mb-1 block text-xs font-medium text-gray-600"
                        >
                          Trợ giảng
                        </label>
                        <select
                          id={`slot-assistant-${index}`}
                          value={assignedAssistantId}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateSlotStaff(index, "assistant_ids", val ? [val] : []);
                          }}
                          className={cn(
                            formTextControlClassName,
                            "h-8 text-xs bg-white",
                            conflictsForSlot.some((c) => c.role === "ASSISTANT") && formTextControlErrorClassName,
                          )}
                        >
                          <option value="">-- Không có trợ giảng --</option>
                          {teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.full_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {conflictsForSlot.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {conflictsForSlot.map((conflict, cIdx) => (
                          <p
                            key={cIdx}
                            role="alert"
                            className="flex items-start gap-1 text-xs font-medium text-destructive"
                          >
                            <span>•</span>
                            <span>{conflict.message}</span>
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </FormSection>

        {typeof additionalSection === "function"
          ? additionalSection({ baseFee: baseFee ?? null, schedule: scheduleValue })
          : additionalSection}
      </FormDialogBody>

      <FormDialogFooter
        left={
          shouldShowUnsavedNotice ? (
            <UnsavedChangesNotice
              hasChanges={hasUnsavedChanges}
              hasErrors={hasFormErrors}
              isSaving={isSaving}
            />
          ) : null
        }
        right={
          <>
            <Button type="button" variant="outline" className="h-8 rounded-md px-3 text-sm" disabled={isSaving} onClick={onClose}>
              Huỷ
            </Button>
            <SaveButton
              type="submit"
              isSaving={isSaving}
              idleLabel={submitLabel}
              pendingLabel={submitLabel ? `Đang ${submitLabel.toLocaleLowerCase("vi-VN")}` : undefined}
              disabled={
                externalSubmitDisabled ||
                isSaving ||
                hasFormErrors ||
                Boolean(class_ && !hasUnsavedChanges)
              }
            />
          </>
        }
      />
    </form>
  );

  if (embedded) {
    return (
      <>
        {createPortal(pickerSlides, document.body)}
        {editForm}
      </>
    );
  }

  return (
    <FormDialogShell
      title={title ?? (class_ ? "Chỉnh sửa lớp học" : "Thêm lớp học")}
      width={class_ ? "lg" : "standard"}
      isBusy={isSaving}
      dirty={hasUnsavedChanges}
      onClose={onClose}
      suspended={isSchedulePickerOpen}
      frameProps={{
        className: class_ ? editEntityDialogFrameClassName : createEntityDialogFrameClassName,
        inert: isSchedulePickerOpen,
        onKeyDown: (event) => {
          const target = event.target;
          const isArrowKey = [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
          ].includes(event.key);
          const hasActiveCaret = isNativeTextEditingTarget(target);
          if (isArrowKey && !event.defaultPrevented && !hasActiveCaret) {
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
          }
        },
      }}
      overlayExtra={pickerSlides}
    >
      {editForm}
    </FormDialogShell>
  );
}

function inputClass(hasError: boolean) {
  return cn(formTextControlClassName, hasError && formTextControlErrorClassName);
}

function hasConfiguredSchedule(
  schedule: { text: string; slots: ScheduleSlot[] } | null,
) {
  return Boolean(schedule && (schedule.slots.length > 0 || schedule.text.trim()));
}

function scheduleKey(schedule: { text: string; slots: ScheduleSlot[] } | null) {
  return JSON.stringify({
    text: schedule?.text.trim() ?? "",
    slots: [...(schedule?.slots ?? [])]
      .sort((left, right) =>
        `${left.day}-${left.start}-${left.end}`.localeCompare(
          `${right.day}-${right.start}-${right.end}`,
        ),
      )
      .map((s) => ({
        day: s.day,
        start: s.start,
        end: s.end,
        teacher_ids: [...(s.teacher_ids ?? [])].sort(),
        assistant_ids: [...(s.assistant_ids ?? [])].sort(),
      })),
  });
}

function normalizedClassFormKey(values: Partial<ClassFormInputValues>) {
  const type = values.type ?? "MONTHLY";
  return JSON.stringify({
    name: values.name?.trim() ?? "",
    identity_scheme: values.identity_scheme ?? "LEGACY",
    class_category: values.class_category ?? null,
    grade_mode: values.grade_mode ?? null,
    grade_level: values.grade_level ?? null,
    academic_year_start: values.academic_year_start ?? null,
    start_date: values.start_date ?? "",
    start_date_change_reason: values.start_date_change_reason ?? "",
    type,
    base_fee: values.base_fee ?? null,
    billing_cycle_months: 1,
    billing_cycle_weeks:
      type === "COURSE"
        ? normalizeCourseBillingWeeks(
            values.billing_cycle_weeks,
            values.billing_cycle_months,
          )
        : null,
  });
}

function getDefaultAcademicYearStart(now = new Date()) {
  const month = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Ho_Chi_Minh",
      month: "numeric",
    }).format(now),
  );
  const year = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
    }).format(now),
  );
  return month >= 8 ? year : year - 1;
}

function getAcademicYearOptions() {
  const current = getDefaultAcademicYearStart();
  return [current - 1, current, current + 1];
}

function getVietnamTodayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
