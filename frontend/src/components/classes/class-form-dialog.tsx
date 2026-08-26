"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { LoadingLabel } from "@/components/ui/loading-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SplitTextField } from "@/components/ui/split-text-field";
import { SmartMoneyInput } from "@/components/ui/smart-money-input";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import type { ScheduleSlot } from "@/components/layout/weekly-schedule-board";
import {
  getClassAssistantIds,
  getClassScheduleSlots,
  getClassScheduleSlotsLabel,
  getClassScheduleText,
  getClassTeacherIds,
  getSlotEffectiveAssistantIds,
  getSlotEffectiveTeacherIds,
  normalizeCourseBillingMonths,
  normalizeCourseBillingWeeks,
} from "@/lib/classes/presentation";
import { classQueryKeys } from "@/lib/classes/query-keys";
import {
  getClassScheduleAvailability,
  previewClassEndDate,
} from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import type {
  ClassCreate,
  ClassCategory,
  ClassGradeMode,
  ClassIdentityScheme,
  ClassResponse,
  ClassType,
  ClassUpdate,
  TeacherOptionResponse,
} from "@/lib/types";
import { validationMessages } from "@/lib/forms/validation-messages";
import {
  getCourseShortcutTotalWeeks,
  getExactEndDateShortcutCount,
  getSuggestedClassEndDate,
} from "@/lib/classes/end-date-shortcut";
import {
  noSavedInfoFormProps,
  savedInfoAutocomplete,
} from "@/lib/forms/saved-info-policy";
import { useFormFieldFeedback } from "@/lib/forms/use-form-field-feedback";
import { moveFocusByFormArrow } from "@/lib/forms/field-navigation";
import { collapseSelectionOnKeyboardFocus } from "@/lib/forms/keyboard-focus";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";

const ScheduleGridSlide = dynamic(
  () =>
    import("@/components/layout/schedule-grid-slide").then(
      (module) => module.ScheduleGridSlide,
    ),
  { ssr: false },
);

const DatePickerSlide = dynamic(
  () =>
    import("@/components/layout/date-picker-slide").then(
      (module) => module.DatePickerSlide,
    ),
  { ssr: false },
);

const TeacherSlide = dynamic(
  () =>
    import("@/components/classes/teacher-slide").then(
      (module) => module.TeacherSlide,
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
  "end_date",
  "end_date_change_reason",
  "type",
  "base_fee",
  "billing_cycle_months",
  "billing_cycle_weeks",
  "teacher_ids",
  "assistant_ids",
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
    end_date: z.string(),
    end_date_change_reason: z
      .string()
      .trim()
      .max(500)
      .refine((value) => value.length === 0 || value.length >= 3, "Vui lòng nêu lý do đổi ngày kết thúc."),
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
    teacher_ids: z
      .array(z.string().uuid())
      .min(1, validationMessages.selectRequired("ít nhất một giáo viên"))
      .max(10, "Mỗi lớp được chọn tối đa 10 giáo viên."),
    assistant_ids: z.array(z.string().uuid()).max(10).default([]),
  })
  .superRefine((values, context) => {
    if (values.class_category === null) {
      context.addIssue({ code: "custom", path: ["class_category"], message: "Vui lòng chọn loại lớp." });
      return;
    }
    if (values.identity_scheme !== "LEGACY") {
      if (!isIsoDate(values.start_date)) {
        context.addIssue({ code: "custom", path: ["start_date"], message: "Vui lòng chọn ngày bắt đầu." });
      }
      if (!isIsoDate(values.end_date)) {
        context.addIssue({ code: "custom", path: ["end_date"], message: "Vui lòng chọn ngày học cuối cùng." });
      }
      if (isIsoDate(values.start_date) && isIsoDate(values.end_date) && values.end_date <= values.start_date) {
        context.addIssue({ code: "custom", path: ["end_date"], message: "Ngày kết thúc phải sau ngày bắt đầu." });
      }
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
        // Khối lớp và năm học phải đi cùng nhau: có khối thì phải có năm học
        // và ngược lại, hoặc cả hai đều để "Không".
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
  end_date: "",
  end_date_change_reason: "",
  type: "MONTHLY",
  base_fee: null,
  billing_cycle_months: 3,
  billing_cycle_weeks: null,
  teacher_ids: [],
  assistant_ids: [],
};

type OccupiedScheduleSlot = ScheduleSlot & {
  classId: string;
  className: string;
  classCategory?: ClassCategory | null;
  gradeLevel?: number | null;
  busyTeacherIds?: string[];
  busyAssistantIds?: string[];
};

type ClassFormDialogProps = {
  class_: ClassResponse | null;
  /** Prefilled create payload used by flows such as "Tạo lớp kế tiếp". */
  initialValues?: ClassCreate | null;
  additionalSection?: ReactNode | ((draft: ClassFormDraftContext) => ReactNode);
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
  onRetryTeachers: () => void;
  onSubmit: (payload: ClassCreate | ClassUpdate) => void;
  teachers: TeacherOptionResponse[];
};

export type ClassFormDraftContext = {
  baseFee: number | null;
  schedule: { text: string; slots: ScheduleSlot[] } | null;
};

export function ClassFormDialog({
  class_,
  initialValues = null,
  additionalSection,
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
  onSubmit,
  teachers,
}: ClassFormDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [isSchedulePickerOpen, setIsSchedulePickerOpen] = useState(false);
  const [isTeacherSlideOpen, setIsTeacherSlideOpen] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<"start" | "end" | null>(null);
  const [endDateShortcutCount, setEndDateShortcutCount] = useState("");
  const [lastEndDateChangeSource, setLastEndDateChangeSource] = useState<
    "shortcut_months" | "shortcut_packages" | "date_picker" | null
  >(null);
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
  const endDate = useWatch({ control, name: "end_date" });
  const endDateChangeReason = useWatch({ control, name: "end_date_change_reason" });
  const baseFee = useWatch({ control, name: "base_fee" });
  const billingCycleWeeks = useWatch({ control, name: "billing_cycle_weeks" });
  const watchedTeacherIds = useWatch({ control, name: "teacher_ids" });
  const watchedAssistantIds = useWatch({ control, name: "assistant_ids" });
  const watchedFormValues = useWatch({ control });
  const activeClassLabel = class_?.name || initialValues?.name || customName?.trim() || "Lớp này";
  const teacherIds = useMemo(() => watchedTeacherIds ?? [], [watchedTeacherIds]);
  const assistantIds = useMemo(
    () => watchedAssistantIds ?? [],
    [watchedAssistantIds],
  );
  const teacherOptions = useMemo(
    () => teachers.filter((teacher) => teacher.staff_type === "TEACHER"),
    [teachers],
  );
  const assistantOptions = useMemo(
    () => teachers.filter((teacher) => teacher.staff_type === "ASSISTANT"),
    [teachers],
  );
  const selectedTeacherNames = useMemo(
    () =>
      teacherOptions
        .filter((teacher) => teacherIds.includes(teacher.id))
        .map((teacher) => teacher.full_name),
    [teacherIds, teacherOptions],
  );
  const selectedAssistantNames = useMemo(
    () =>
      assistantOptions
        .filter((assistant) => assistantIds.includes(assistant.id))
        .map((assistant) => assistant.full_name),
    [assistantIds, assistantOptions],
  );
  // Panel lịch chỉ nhận nhân sự ĐÃ CHỌN cho lớp; pool toàn hệ thống chỉ dùng
  // cho panel chọn nhân sự ở trên.
  const selectedTeacherOptions = useMemo(
    () => teacherOptions.filter((teacher) => teacherIds.includes(teacher.id)),
    [teacherIds, teacherOptions],
  );
  const selectedAssistantOptions = useMemo(
    () => assistantOptions.filter((assistant) => assistantIds.includes(assistant.id)),
    [assistantIds, assistantOptions],
  );
  const availabilityQuery = useQuery({
    queryKey: classQueryKeys.availability({
      classId: class_?.id ?? null,
      startDate,
      endDate,
      teacherIds,
      assistantIds,
    }),
    queryFn: () =>
      getClassScheduleAvailability({
        class_id: class_?.id,
        start_date: startDate,
        end_date: endDate,
        teacher_ids: teacherIds,
        assistant_ids: assistantIds,
      }),
    enabled:
      Boolean(mounted) &&
      isSchedulePickerOpen &&
      Boolean(startDate) &&
      Boolean(endDate) &&
      teacherIds.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
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
  const missingScheduleDates = !startDate || !endDate;
  const occupiedLoading =
    Boolean(availabilityQuery.isFetching) && !availabilityQuery.isSuccess;
  const occupiedError = missingScheduleDates
    ? "Vui lòng chọn ngày bắt đầu và ngày kết thúc trước khi thiết lập lịch học."
    : availabilityQuery.isError
      ? getApiErrorMessage(
          availabilityQuery.error,
          "Không tải được lịch bận. Vui lòng thử lại.",
        )
      : null;
  const scheduleAssignmentError = useMemo(() => {
    if (teacherIds.length === 0) return undefined;
    const slots = scheduleValue?.slots ?? [];
    if (slots.length === 0) return undefined;
    const broken = slots.find((slot) => {
      const effective = getSlotEffectiveTeacherIds(slot, teacherIds);
      return effective.filter((id) => teacherIds.includes(id)).length === 0;
    });
    return broken
      ? `Buổi ${broken.day} ${broken.start}–${broken.end} không còn giáo viên. Vui lòng chọn lại nhân sự cho lớp hoặc xóa buổi này.`
      : undefined;
  }, [scheduleValue, teacherIds]);

  // Xóa nhân sự khỏi lớp → loại ID đó khỏi slot liên quan ngay (không âm thầm
  // gán người khác); nếu slot mất giáo viên cuối cùng, scheduleAssignmentError
  // chặn lưu cho tới khi user xử lý.
  useEffect(() => {
    setScheduleValue((current) => {
      if (!current || current.slots.length === 0) return current;
      const nextSlots = current.slots.map((slot) => ({
        ...slot,
        teacher_ids: (slot.teacher_ids ?? []).filter((id) => teacherIds.includes(id)),
        assistant_ids: (slot.assistant_ids ?? []).filter((id) =>
          assistantIds.includes(id),
        ),
      }));
      const changed = nextSlots.some(
        (slot, index) =>
          JSON.stringify(slot.teacher_ids) !==
            JSON.stringify(current.slots[index].teacher_ids ?? []) ||
          JSON.stringify(slot.assistant_ids) !==
            JSON.stringify(current.slots[index].assistant_ids ?? []),
      );
      return changed ? { ...current, slots: nextSlots } : current;
    });
  }, [assistantIds, teacherIds]);
  const scheduleConflict = useMemo(
      () => findScheduleConflict(scheduleValue?.slots ?? [], occupiedSlots, teacherIds),
    [occupiedSlots, scheduleValue?.slots, teacherIds],
  );
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
          slots: initialRecord.schedule?.slots ?? [],
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
            end_date: initialRecord.end_date ?? "",
            end_date_change_reason: "",
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
    const shortcutCount = initialRecord?.start_date && initialRecord.end_date
      ? getExactEndDateShortcutCount({
          startDate: initialRecord.start_date,
          endDate: initialRecord.end_date,
          type: initialRecord.type,
          billingCycleWeeks: normalizedBillingWeeks,
        })
      : null;
    setEndDateShortcutCount(shortcutCount ? String(shortcutCount) : "");
    setInitialScheduleKey(scheduleKey(nextSchedule));
    resetFeedback();
  }, [class_, initialValues, reset, resetFeedback]);

  const baselineRecord = class_ ?? initialValues;
  const hasUnsavedChanges = Boolean(
    externalDirty ||
    (baselineRecord &&
      (normalizedClassFormKey(watchedFormValues) !==
        normalizedClassFormKey({
          name: baselineRecord.name,
          identity_scheme: baselineRecord.identity_scheme,
          class_category: baselineRecord.class_category,
          grade_mode: baselineRecord.grade_mode ?? (baselineRecord.grade_level ? "GRADE" : "NONE"),
          grade_level: baselineRecord.grade_level ?? null,
          academic_year_start: baselineRecord.academic_year_start ?? null,
          start_date: baselineRecord.start_date ?? "",
          end_date: baselineRecord.end_date ?? "",
          end_date_change_reason: "",
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
  const endDateChanged = Boolean(
    class_ && endDate !== (class_.end_date ?? ""),
  );
  const canPreviewEndDate = Boolean(
    class_ &&
      endDateChanged &&
      isIsoDate(endDate),
  );
  const endDatePreviewQuery = useQuery({
    queryKey: classQueryKeys.endDatePreview(class_?.id ?? "", endDate, class_?.version ?? 0),
    queryFn: () =>
      previewClassEndDate(class_!.id, {
        end_date: endDate,
        expected_version: class_!.version,
      }),
    enabled: canPreviewEndDate,
    retry: false,
    staleTime: 0,
  });
  const isEndDatePreviewBlocked = Boolean(
    canPreviewEndDate &&
      (endDatePreviewQuery.isFetching || endDatePreviewQuery.isError),
  );
  const isEndDatePreviewError = Boolean(
    canPreviewEndDate && endDatePreviewQuery.isError,
  );
  const rawPreviewError = isEndDatePreviewError
    ? getApiErrorMessage(
        endDatePreviewQuery.error,
        "Không thể áp dụng ngày kết thúc này.",
      )
    : null;

  const isEnrollmentHistoryError = Boolean(
    rawPreviewError &&
      (rawPreviewError.includes("lịch sử học viên") ||
        rawPreviewError.includes("ngày bắt đầu gần nhất") ||
        rawPreviewError.includes("học viên")),
  );

  const formattedEndDatePreviewError = useMemo(() => {
    if (!rawPreviewError) return null;
    if (!isEnrollmentHistoryError) return rawPreviewError;

    const dateText = isIsoDate(endDate) ? formatDate(endDate) : endDate;
    if (lastEndDateChangeSource === "shortcut_months") {
      const monthText = endDateShortcutCount ? `${endDateShortcutCount} tháng` : "Số tháng đã chọn";
      return `${monthText} khiến ngày kết thúc (${dateText}) sớm hơn ngày bắt đầu học gần nhất trong lịch sử học viên của lớp. Vui lòng tăng tổng số tháng hoặc chọn lại ngày kết thúc.`;
    }
    if (lastEndDateChangeSource === "shortcut_packages") {
      const packageText = endDateShortcutCount ? `${endDateShortcutCount} gói` : "Số gói đã chọn";
      return `${packageText} khiến ngày kết thúc (${dateText}) sớm hơn ngày bắt đầu học gần nhất trong lịch sử học viên của lớp. Vui lòng tăng số gói hoặc chọn lại ngày kết thúc.`;
    }
    return `Ngày kết thúc (${dateText}) phải sau ngày bắt đầu gần nhất trong lịch sử học viên của lớp. Vui lòng chọn ngày kết thúc muộn hơn.`;
  }, [
    rawPreviewError,
    isEnrollmentHistoryError,
    lastEndDateChangeSource,
    endDateShortcutCount,
    endDate,
  ]);

  const monthCountFieldHasError = Boolean(
    isEndDatePreviewError &&
      lastEndDateChangeSource === "shortcut_months" &&
      isEnrollmentHistoryError,
  );
  const packageCountFieldHasError = Boolean(
    isEndDatePreviewError &&
      lastEndDateChangeSource === "shortcut_packages" &&
      isEnrollmentHistoryError,
  );
  const hasFormErrors =
    !classFormSchema.safeParse(watchedFormValues).success ||
    Object.keys(errors).length > 0 ||
    Boolean(scheduleConflict) ||
    Boolean(scheduleRequiredError) ||
    Boolean(scheduleAssignmentError) ||
    Boolean(
      class_ &&
        endDateChanged &&
        endDateChangeReason.trim().length < 3,
    ) ||
    Boolean(canPreviewEndDate && endDatePreviewQuery.isError) ||
    (isTeachersError && teachers.length === 0);
  const shouldShowUnsavedNotice = shouldShowUnsavedChanges({
    hasChanges: hasUnsavedChanges,
    hasErrors: hasFormErrors,
    isSaving,
  });

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    onNestedOverlayChange?.(
      isSchedulePickerOpen || datePickerTarget !== null || isTeacherSlideOpen,
    );
  }, [
    isSchedulePickerOpen,
    datePickerTarget,
    isTeacherSlideOpen,
    onNestedOverlayChange,
  ]);
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
  const endDateError = shouldShowError("end_date", isSubmitted)
    ? errors.end_date?.message
    : undefined;
  const endDateReasonError =
    class_ &&
    endDate !== (class_.end_date ?? "") &&
    endDateChangeReason.trim().length < 3 &&
    shouldShowError("end_date_change_reason", isSubmitted)
      ? "Vui lòng nêu lý do đổi ngày kết thúc."
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
  const teacherIdsError = shouldShowError("teacher_ids", isSubmitted)
    ? errors.teacher_ids?.message
    : undefined;
  const scheduleError = scheduleConflict
    ? `Lịch học trùng với lớp ${scheduleConflict.className} vào ${scheduleConflict.day}, ${scheduleConflict.start}–${scheduleConflict.end}. Vui lòng chọn ca khác.`
    : scheduleAssignmentError
      ? scheduleAssignmentError
      : shouldShowError("schedule", isSubmitted)
        ? scheduleRequiredError
        : undefined;
  const billingConfigurationLocked = Boolean(
    class_ && class_.effective_status !== "SCHEDULED",
  );
  const endDateLocked = Boolean(class_ && !class_.can_edit_end_date);
  const totalCourseWeeks = getCourseShortcutTotalWeeks(
    billingCycleWeeks,
    endDateShortcutCount,
  );

  function applySelectedEndDate(nextEndDate: string) {
    setLastEndDateChangeSource("date_picker");
    markInput("end_date", nextEndDate);
    setValue("end_date", nextEndDate, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const exactCount = getExactEndDateShortcutCount({
      startDate,
      endDate: nextEndDate,
      type,
      billingCycleWeeks,
    });
    setEndDateShortcutCount(exactCount ? String(exactCount) : "");
  }

  function applyEndDateShortcut(
    rawValue: string,
    source: "shortcut_months" | "shortcut_packages" = "shortcut_months",
  ) {
    setLastEndDateChangeSource(source);
    const normalized = rawValue.replace(/\D/g, "").slice(0, 4);
    setEndDateShortcutCount(normalized);
    const count = normalized ? Number(normalized) : 0;
    const suggested = getSuggestedClassEndDate({
      startDate,
      type,
      count,
      billingCycleWeeks,
    });
    if (!suggested) return;
    markInput("end_date", suggested);
    setValue("end_date", suggested, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

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
        selectedTeachers={selectedTeacherOptions}
        selectedAssistants={selectedAssistantOptions}
        classLabel={activeClassLabel}
        onClose={() => setIsSchedulePickerOpen(false)}
        onSave={(value) => {
          setScheduleValue(value);
          markInput("schedule", value?.slots ?? value?.text ?? "");
        }}
      />
      <DatePickerSlide
        isOpen={datePickerTarget === "start"}
        title="Chọn ngày bắt đầu"
        description="Ngày bắt đầu chỉ được chọn từ hôm nay trở đi và sẽ cố định sau khi mở lớp."
        currentValue={startDate || undefined}
        minDate={getVietnamTodayIso()}
        yearOptions={getClassDatePickerYears(1)}
        onClose={() => setDatePickerTarget(null)}
        onSelectDate={(value) => {
          markInput("start_date", value);
          setValue("start_date", value, { shouldDirty: true, shouldValidate: true });
          if (value !== startDate) {
            setEndDateShortcutCount("");
            setValue("end_date", "", {
              shouldDirty: true,
              shouldValidate: true,
            });
          }
        }}
      />
      <DatePickerSlide
        isOpen={datePickerTarget === "end"}
        title="Chọn ngày kết thúc"
        description="Có thể chọn ngày kết thúc phù hợp với kế hoạch vận hành của lớp."
        currentValue={endDate || undefined}
        onClose={() => setDatePickerTarget(null)}
        onSelectDate={applySelectedEndDate}
      />
      <TeacherSlide
        isOpen={isTeacherSlideOpen}
        options={teachers}
        currentTeacherIds={teacherIds}
        currentAssistantIds={assistantIds}
        onClose={() => setIsTeacherSlideOpen(false)}
        onSave={(nextTeacherIds, nextAssistantIds) => {
          markInput("teacher_ids", nextTeacherIds);
          setValue("teacher_ids", nextTeacherIds, {
            shouldDirty: true,
            shouldValidate: true,
          });
          markInput("assistant_ids", nextAssistantIds);
          setValue("assistant_ids", nextAssistantIds, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }}
      />
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
              if (scheduleRequiredError || scheduleAssignmentError) {
                return;
              }
              if (!values.class_category) {
                return;
              }
              onSubmit({
                name: values.name.trim(),
                type: values.type,
                base_fee: values.base_fee,
                billing_cycle_months: 1,
                billing_cycle_weeks:
                  values.type === "COURSE" ? values.billing_cycle_weeks : null,
                schedule: scheduleValue,
                teacher_id: values.teacher_ids[0] ?? null,
                teacher_ids: values.teacher_ids,
                assistant_ids: values.assistant_ids,
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
                end_date: values.end_date,
                ...(class_
                  ? {
                      expected_version: class_.version,
                      ...(values.end_date !== (class_.end_date ?? "")
                        ? {
                            end_date_change_reason: values.end_date_change_reason.trim(),
                            expected_fingerprint:
                              endDatePreviewQuery.data?.preview_fingerprint ?? "",
                          }
                        : {}),
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
                <div
                  className={`grid gap-3 ${CLASS_FORM_COLUMNS}`}
                >
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
                      <button
                        id="class-start-date"
                        type="button"
                        onBlur={() => markBlur("start_date")}
                        onClick={() => setDatePickerTarget("start")}
                        disabled={Boolean(class_?.start_date)}
                        aria-haspopup="dialog"
                        data-invalid={startDateError ? "true" : undefined}
                        aria-describedby={startDateError ? "class-start-date-error" : undefined}
                        className={`${formTextControlClassName} select-none text-left ${startDateError ? formTextControlErrorClassName : ""}`}
                        data-row={2}
                        data-col={1}
                      >
                        {formatDate(startDate || null, "Chọn ngày")}
                      </button>
                  </FormField>
                </div>
              </>
            ) : null}
            </FormSection>

            <FormSection label="Học phí và thời hạn" order={2}>
            <div className={`grid gap-3 ${CLASS_FORM_COLUMNS}`}>
              <FormField error={typeError} label="Hình thức đóng học phí" labelId="class-type-label">
                <input type="hidden" {...register("type")} />
                <SegmentedControl
                  ariaLabelledBy="class-type-label"
                  disabled={billingConfigurationLocked}
                  options={[
                    { label: "Theo tháng", value: "MONTHLY" },
                    { label: "Theo gói", value: "COURSE" },
                  ]}
                  selected={type}
                  onSelect={(value) => {
                    if (billingConfigurationLocked || value === type) return;
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
                    setValue("end_date", "", {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                    setEndDateShortcutCount("");
                  }}
                />
                {billingConfigurationLocked ? (
                  <p className="helper-text text-gray-500">
                    Hình thức đóng học phí được cố định sau khi lớp bắt đầu.
                  </p>
                ) : null}
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

            {type === "MONTHLY" && identityScheme !== "LEGACY" && classCategory ? (
              <div className={`grid gap-3 ${CLASS_FORM_COLUMNS}`}>
                <FormField controlId="class-total-months" label="Tổng số tháng">
                  <div
                    className={`relative h-8 overflow-hidden rounded-md border bg-white ${
                      monthCountFieldHasError
                        ? "border-destructive ring-1 ring-destructive/40"
                        : "border-gray-200"
                    }`}
                  >
                    <input
                      id="class-total-months"
                      type="text"
                      inputMode="numeric"
                      value={endDateShortcutCount}
                      maxLength={4}
                      autoComplete={savedInfoAutocomplete.disabled}
                      disabled={endDateLocked || !isIsoDate(startDate)}
                      onFocus={collapseSelectionOnKeyboardFocus}
                      onChange={(event) =>
                        applyEndDateShortcut(event.target.value, "shortcut_months")
                      }
                      className="form-input-text h-full w-full bg-white px-3 pr-14 opacity-100 outline-none disabled:bg-white disabled:text-gray-400 disabled:opacity-100"
                      data-row={6}
                      data-col={0}
                      data-vertical-arrow-scope="class-primary"
                      aria-invalid={monthCountFieldHasError ? "true" : undefined}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center bg-white form-input-text text-gray-500">tháng</span>
                  </div>
                </FormField>
                <FormField controlId="class-end-date" error={endDateError} label="Ngày kết thúc">
                  <button
                    id="class-end-date"
                    type="button"
                    aria-label="Ngày kết thúc"
                    aria-describedby={endDateError ? "class-end-date-error" : undefined}
                    data-invalid={endDateError || isEndDatePreviewError ? "true" : undefined}
                    onBlur={() => markBlur("end_date")}
                    onClick={() => {
                      if (!endDateLocked) {
                        setDatePickerTarget("end");
                      }
                    }}
                    disabled={endDateLocked || !isIsoDate(startDate)}
                    aria-haspopup="dialog"
                    className={`${formTextControlClassName} select-none text-left ${
                      endDateError || isEndDatePreviewError ? formTextControlErrorClassName : ""
                    }`}
                    data-row={6}
                    data-col={1}
                    data-vertical-arrow-scope="class-primary"
                  >
                    {isIsoDate(endDate) ? formatDate(endDate) : "Chọn ngày"}
                  </button>
                  {!isIsoDate(startDate) ? (
                    <p className="helper-text text-gray-500">Chọn ngày bắt đầu trước.</p>
                  ) : endDateLocked ? (
                    <p className="helper-text text-gray-500">Ngày kết thúc đã được khóa.</p>
                  ) : null}
                </FormField>
              </div>
            ) : null}

            {type === "COURSE" ? (
              <>
                <input type="hidden" {...register("billing_cycle_months", { valueAsNumber: true })} />
                <div className={`grid gap-3 ${CLASS_FORM_COLUMNS}`}>
                  <FormField
                    label="Thời lượng và tổng số gói"
                    labelId="class-package-settings-label"
                  >
                    <SplitTextField
                      className={`h-8 rounded-md border bg-white ${
                        billingCycleError || packageCountFieldHasError
                          ? "border-destructive ring-1 ring-destructive/40"
                          : "border-input"
                      }`}
                      left={
                        <div className="relative h-full">
                          <input
                            id="class-duration-weeks"
                            aria-label="Thời lượng mỗi gói"
                            type="text"
                            inputMode="numeric"
                            disabled={billingConfigurationLocked}
                            value={billingCycleWeeks ?? ""}
                            maxLength={5}
                            autoComplete={savedInfoAutocomplete.disabled}
                            onFocus={collapseSelectionOnKeyboardFocus}
                            aria-describedby={billingCycleError ? "class-billing-cycle-error" : "class-total-weeks"}
                            onChange={(event) => {
                              if (billingConfigurationLocked) return;
                              const rawValue = event.target.value.replace(/\D/g, "").slice(0, 5);
                              const nextValue = rawValue === "" ? null : Number(rawValue);
                              markInput("billing_cycle_weeks", rawValue);
                              setValue("billing_cycle_weeks", nextValue, { shouldDirty: true, shouldValidate: true });
                              setLastEndDateChangeSource("shortcut_packages");
                              const count = endDateShortcutCount ? Number(endDateShortcutCount) : 0;
                              const suggested = getSuggestedClassEndDate({ startDate, type: "COURSE", count, billingCycleWeeks: nextValue });
                              if (suggested) {
                                markInput("end_date", suggested);
                                setValue("end_date", suggested, { shouldDirty: true, shouldValidate: true });
                              }
                            }}
                            onBlur={() => markBlur("billing_cycle_weeks")}
                            className="form-input-text h-full w-full bg-transparent px-3 pr-12 outline-none disabled:bg-transparent disabled:text-gray-400"
                            data-row={6}
                            data-col={0}
                            data-vertical-arrow-scope="class-primary"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center form-input-text text-gray-500">tuần</span>
                        </div>
                      }
                      right={
                        <div className="relative h-full">
                          <input
                            id="class-package-count"
                            aria-label="Tổng số gói"
                            type="text"
                            inputMode="numeric"
                            value={endDateShortcutCount}
                            maxLength={4}
                            autoComplete={savedInfoAutocomplete.disabled}
                            disabled={endDateLocked || !isIsoDate(startDate)}
                            onFocus={collapseSelectionOnKeyboardFocus}
                            onChange={(event) =>
                              applyEndDateShortcut(event.target.value, "shortcut_packages")
                            }
                            className="form-input-text h-full w-full bg-transparent px-3 pr-10 outline-none disabled:bg-transparent disabled:text-gray-400"
                            data-row={6}
                            data-col={1}
                            data-vertical-arrow-scope="class-primary"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center form-input-text text-gray-500">gói</span>
                        </div>
                      }
                    />
                    <div className="mt-1 min-h-[18px]">
                      {billingCycleError ? (
                        <p id="class-billing-cycle-error" role="alert" className="helper-text text-destructive">
                          {billingCycleError}
                        </p>
                      ) : (
                        <p id="class-total-weeks" className="helper-text text-gray-600">
                          Tổng số tuần: {totalCourseWeeks === null ? "—" : `${totalCourseWeeks} tuần`}
                        </p>
                      )}
                    </div>
                  </FormField>
                  <FormField controlId="class-end-date" error={endDateError} label="Ngày kết thúc">
                    <button
                      id="class-end-date"
                      type="button"
                      aria-label="Ngày kết thúc"
                      aria-describedby={endDateError ? "class-end-date-error" : undefined}
                      data-invalid={endDateError || isEndDatePreviewError ? "true" : undefined}
                      onBlur={() => markBlur("end_date")}
                      onClick={() => {
                        if (!endDateLocked) {
                          setDatePickerTarget("end");
                        }
                      }}
                      disabled={endDateLocked || !isIsoDate(startDate)}
                      aria-haspopup="dialog"
                      className={`${formTextControlClassName} select-none text-left ${
                        endDateError || isEndDatePreviewError ? formTextControlErrorClassName : ""
                      }`}
                      data-row={6}
                      data-col={1}
                      data-vertical-arrow-scope="class-primary"
                    >
                      {isIsoDate(endDate) ? formatDate(endDate) : "Chọn ngày"}
                    </button>
                    {!isIsoDate(startDate) ? (
                      <p className="helper-text text-gray-500">Chọn ngày bắt đầu trước.</p>
                    ) : endDateLocked ? (
                      <p className="helper-text text-gray-500">Ngày kết thúc đã được khóa.</p>
                    ) : null}
                  </FormField>
                </div>
              </>
            ) : null}

            {class_ && endDate !== (class_.end_date ?? "") ? (
              <FormField controlId="class-end-date-reason" error={endDateReasonError} label="Lý do đổi ngày kết thúc">
                <input
                  id="class-end-date-reason"
                  {...register("end_date_change_reason", {
                    onChange: (event) => markInput("end_date_change_reason", event.target.value),
                    onBlur: () => markBlur("end_date_change_reason"),
                  })}
                  maxLength={500}
                  autoComplete={savedInfoAutocomplete.disabled}
                  className={inputClass(false)}
                  data-row={4}
                  data-col={0}
                />
              </FormField>
            ) : null}

            {canPreviewEndDate ? (
              <div aria-live="polite">
                {endDatePreviewQuery.isFetching ? (
                  <FormNotice className="mt-2" loading tone="warning">
                    Đang kiểm tra học viên và các kỳ học phí bị ảnh hưởng.
                  </FormNotice>
                ) : endDatePreviewQuery.isError ? (
                  <InlineFormError
                    className="mt-2"
                    action={
                      <button
                        type="button"
                        disabled={endDatePreviewQuery.isFetching}
                        onClick={() => void endDatePreviewQuery.refetch()}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-destructive hover:bg-destructive-soft disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden="true" />
                        {endDatePreviewQuery.isFetching ? (
                          <LoadingLabel label="Đang thử lại" />
                        ) : (
                          "Thử lại"
                        )}
                      </button>
                    }
                  >
                    {formattedEndDatePreviewError}
                  </InlineFormError>
                ) : endDatePreviewQuery.data ? (
                  <FormNotice>
                    Ngày mới áp dụng cho {endDatePreviewQuery.data.affected_student_count} học viên
                    {endDatePreviewQuery.data.package_count
                      ? `, gồm ${endDatePreviewQuery.data.package_count} gói trọn vẹn`
                      : ""}
                    {endDatePreviewQuery.data.mutable_fee_record_count > 0
                      ? `; hệ thống sẽ hủy ${endDatePreviewQuery.data.mutable_fee_record_count} kỳ học phí chưa phát sinh nằm ngoài thời hạn mới`
                      : ""}
                    {endDatePreviewQuery.data.protected_fee_record_count > 0
                      ? `; còn ${endDatePreviewQuery.data.protected_fee_record_count} kỳ đã báo/đã nộp ngoài thời hạn mới cần review`
                      : ""}
                    .
                  </FormNotice>
                ) : null}
              </div>
            ) : null}
            </FormSection>

            <FormSection label="Nhân sự phụ trách" order={3} summary={`${teacherIds.length + assistantIds.length} nhân sự`}>
            <FormField
              error={teacherIdsError}
              errorId="class-teachers-error"
              label="Giáo viên / Trợ giảng"
              labelId="class-teachers-label"
              visuallyHiddenLabel
            >
              <input type="hidden" {...register("teacher_ids")} />
              <input type="hidden" {...register("assistant_ids")} />
              {isTeachersLoading ? (
                <div role="status" className="form-input-text flex h-8 items-center gap-2 rounded-md border border-gray-200 px-3 text-gray-500">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Đang tải giáo viên
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
                  Không tải được danh sách giáo viên.
                </InlineFormError>
              ) : teachers.length > 0 ? (
                <button
                  type="button"
                  aria-labelledby="class-teachers-label"
                  aria-describedby={teacherIdsError ? "class-teachers-error" : undefined}
                  onClick={() => setIsTeacherSlideOpen(true)}
                  onBlur={() => markBlur("teacher_ids")}
                  aria-haspopup="dialog"
                  data-invalid={teacherIdsError ? "true" : undefined}
                  className={`form-input-text min-h-8 w-full cursor-pointer select-none rounded-md border bg-white px-1.5 py-1.5 text-left text-gray-700 outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 ${teacherIdsError ? "border-destructive" : "border-gray-200"}`}
                >
                  <span className="line-clamp-2 whitespace-normal">
                    {selectedTeacherNames.length > 0
                      ? [
                          `GV: ${selectedTeacherNames.join(", ")}`,
                          ...(selectedAssistantNames.length > 0
                            ? [`TG: ${selectedAssistantNames.join(", ")}`]
                            : []),
                        ].join(" · ")
                      : "Chọn giáo viên và trợ giảng"}
                  </span>
                </button>
              ) : (
                <div className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-500">
                  Chưa có giáo viên đang hoạt động. Hãy thêm tại trang Nhân sự trước.
                </div>
              )}
              {isTeachersError && teachers.length > 0 ? (
                <p className="helper-text mt-1 text-amber-700" aria-live="polite">
                  Chưa cập nhật được danh sách mới nhất; đang dùng dữ liệu đã lưu.
                </p>
              ) : null}
            </FormField>
            </FormSection>

            <FormSection label="Lịch học" order={4} summary={`${scheduleValue?.slots.length ?? 0} buổi/tuần`}>
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
                disabled={isTeachersLoading || teacherIds.length === 0}
                data-invalid={scheduleError ? "true" : undefined}
                aria-describedby={scheduleError ? "class-schedule-error" : undefined}
                onBlur={() => markBlur("schedule")}
                onClick={() => setIsSchedulePickerOpen(true)}
                className={`form-input-text min-h-8 w-full cursor-pointer rounded-md border bg-white px-1.5 py-1.5 text-left text-gray-700 outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 ${scheduleError ? "border-destructive" : "border-gray-200"}`}
              >
                {isTeachersLoading ? (
                  <LoadingLabel label="Đang tải giáo viên" />
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
            </FormField>
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
                  disabled={externalSubmitDisabled || isTeachersLoading || teachers.length === 0 || Boolean(scheduleConflict) || isEndDatePreviewBlocked || Boolean(class_ && !hasUnsavedChanges)}
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
      suspended={isSchedulePickerOpen || datePickerTarget !== null || isTeacherSlideOpen}
      frameProps={{
        className: class_ ? editEntityDialogFrameClassName : createEntityDialogFrameClassName,
        inert: isSchedulePickerOpen || datePickerTarget !== null,
        onKeyDown: (event) => {
          const target = event.target;
          const isArrowKey = [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
          ].includes(event.key);
          const hasActiveCaret =
            target instanceof HTMLElement &&
            target.getAttribute("data-unified-caret-active") === "true";
          // Form navigation prevents the event after moving focus. Do not
          // steal that focus while the old input's caret state is cleared.
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

function findScheduleConflict(
  requestedSlots: ScheduleSlot[],
  occupiedSlots: OccupiedScheduleSlot[],
  teacherIds: string[],
): OccupiedScheduleSlot | null {
  return (
    occupiedSlots.find((occupied) =>
      requestedSlots.some((requested) => {
        if (
          requested.day !== occupied.day ||
          !(requested.start < occupied.end && occupied.start < requested.end)
        ) {
          return false;
        }
        // Canonical block giữ đồng thời busy teacher + assistant. Block không
        // kèm staff (dữ liệu cũ) được coi là bận với mọi nhân sự đã chọn.
        const busyTeachers = occupied.busyTeacherIds ?? [];
        const busyAssistants = occupied.busyAssistantIds ?? [];
        if (busyTeachers.length === 0 && busyAssistants.length === 0) {
          return true;
        }
        return (
          getSlotEffectiveTeacherIds(requested, teacherIds).some((id) =>
            busyTeachers.includes(id),
          ) ||
          getSlotEffectiveAssistantIds(requested).some((id) =>
            busyAssistants.includes(id),
          )
        );
      }),
    ) ?? null
  );
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
    identity_scheme: values.identity_scheme ?? "LEGACY",
    class_category: values.class_category ?? null,
    grade_mode: values.grade_mode ?? null,
    grade_level: values.grade_level ?? null,
    academic_year_start: values.academic_year_start ?? null,
    start_date: values.start_date ?? "",
    end_date: values.end_date ?? "",
    type,
    base_fee: values.base_fee ?? null,
    billing_cycle_months:
      1,
    billing_cycle_weeks:
      type === "COURSE"
        ? normalizeCourseBillingWeeks(
            values.billing_cycle_weeks,
            values.billing_cycle_months,
          )
        : null,
    teacher_ids: [...(values.teacher_ids ?? [])].sort(),
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

function getClassDatePickerYears(
  futureYearCount: number,
  today = getVietnamTodayIso(),
) {
  const currentYear = Number(today.slice(0, 4));
  return Array.from(
    { length: futureYearCount + 1 },
    (_, index) => currentYear + index,
  );
}

function getAcademicYearOptions() {
  const current = getDefaultAcademicYearStart();
  return [current - 1, current, current + 1];
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getVietnamTodayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
