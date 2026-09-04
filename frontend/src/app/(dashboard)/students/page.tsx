"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import axios from "axios";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  RiArrowLeftLine as ArrowLeft,
  RiEyeLine as Eye,
  RiEyeOffLine as EyeOff,
  RiAddLine as Plus,
  RiSearchLine as SearchX,
  RiTeamLine as UsersRound,
} from "react-icons/ri";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useForm, UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ExcelExportButton } from "@/components/ui/excel-export-button";
import {
  createEntityDialogFrameClassName,
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { FormSection } from "@/components/ui/form-section";
import {
  formTextControlClassName,
  formTextControlErrorClassName,
} from "@/components/ui/form-text-control";
import { LoadingLabel } from "@/components/ui/loading-label";
import { QuickActionFab } from "@/components/ui/quick-action-fab";
import { SaveButton } from "@/components/ui/save-button";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { SmartMoneyInput } from "@/components/ui/smart-money-input";
import { comparableManualDate, ManualDateInput, isValidIsoDate } from "@/components/ui/manual-date-input";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { SplitTextField } from "@/components/ui/split-text-field";
import { FormNotice } from "@/components/ui/form-notice";
import { StatusPill } from "@/components/ui/status-pill";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderLoadingStatus } from "@/components/layout/header-loading-status";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { ClassSelectionView } from "@/components/students/class-selection-view";
import { StudentReactivationSlide } from "@/components/students/student-reactivation-slide";
import { StudentStartDateDialog, DECISION_STRATEGIES } from "@/components/students/student-start-date-dialog";
import { StudentWorkspaceDialog } from "@/components/students/student-workspace-dialog";
import {
  StudentClassDetailSkeleton,
  StudentClassSelectionSkeleton,
  StudentHeaderLoadingSkeleton,
  StudentProfileScopeSkeleton,
  StudentProfileTableSkeleton,
  StudentTableSkeleton,
  StudentsRouteSkeleton,
} from "@/components/students/students-route-skeleton";
import {
  STUDENTS_TABLE_GRID_CLASS,
  STUDENTS_TABLE_VIEWER_GRID_CLASS,
} from "@/components/students/students-table-layout";
import { getClasses, getClassHistory } from "@/lib/api/classes";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { exportExcelWorkbook, sanitizeExcelFileName } from "@/lib/excel/workbook";
import { useClickableRowProps } from "@/lib/ui/click-guard";
import {
  createStudent,
  dropEnrollment,
  archiveStudent,
  applyStudentMembershipCommand,
  previewStudentMembership,
  getStudent,
  getStudentScopeSummary,
  getStudentIdentityConflict,
  getStudentsPage,
  reactivateStudent,
  restoreStudent,
} from "@/lib/api/students";
import {
  computeDraftKey,
  filterEffectiveSlotsForDate,
  getBusinessTodayInVietnam,
  getDefaultTargetEnrollmentDate,
  parseMembershipError,
  validateTargetEnrollmentDate,
} from "@/lib/students/enrollment-target-helper";
import { formatStudentCode } from "@/lib/students/student-code";
import { getEnrollmentFeeSuggestion } from "@/lib/students/enrollment-pricing";
import { studentQueryKeys, type StudentListFilters } from "@/lib/students/query-keys";
import { useAuth } from "@/lib/hooks/useAuth";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { isManagementUser } from "@/lib/auth/permissions";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import { useScopedTextSelection } from "@/lib/hooks/useScopedTextSelection";
import {
  getSelectedStudentClassFromSearchParams,
  readRememberedStudentClass,
  rememberStudentClass,
  replaceSelectedStudentClassInSearchParams,
} from "@/lib/students/selected-class-route";
import type {
  ClassResponse,
  ClassType,
  StudentCreate,
  StudentHiddenField,
  StudentIdentityCandidate,
  StudentIdentityConflict,
  StudentEnrollmentInfo,
  AffectedEnrollmentImpact,
  StudentMembershipPreviewResponse,
  StudentResponse,
  StudentListPageResponse,
  StudentListState,
  StudentScopeSummary,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { getClassSortKey } from "@/lib/utils/class-groups";
import {
  getClassBillingDurationLabel,
  getClassGroupInfoForRecord,
} from "@/lib/classes/presentation";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { validationMessages } from "@/lib/forms/validation-messages";
import type { EnrollmentFeeValues } from "@/lib/students/enrollment-fees";
import {
  getStudentExportValue,
  isStudentFieldHidden,
} from "@/lib/students/privacy";
import {
  type ContactSuggestionSource,
  type ContactPairSuggestion,
  handleContactSuggestionTab,
  useContactPairSuggestion,
} from "@/lib/forms/use-contact-pair-suggestion";
import type { ContactSuggestionOwner } from "@/lib/api/contact-suggestions";
import {
  getCompleteContactPair,
  getContactPairError,
} from "@/lib/forms/contact-pair";
import {
  noSavedInfoFormProps,
  savedInfoAutocomplete,
} from "@/lib/forms/saved-info-policy";
import { useFormFieldFeedback } from "@/lib/forms/use-form-field-feedback";
import { moveFocusByFormArrow } from "@/lib/forms/field-navigation";
import { useToast } from "@/components/providers/toast-provider";
import {
  getSlideBackdropStyle,
  getSlidePanelStyle,
  useSlidePanelDuration,
} from "@/lib/ui/slide-panel-motion";

type EnrollmentActionMode = "transfer" | "supplement";
type EnrollmentTargetConfig = {
  class_id: string;
  enrollment_date: string | null;
  custom_fee: number | null;
  selected_slot_ids: string[];
};
type ActionPlanPreviewMeta = {
  previewFingerprint: string;
  previewExpiresAt: string;
  previewDraftKey: string;
  previewResponse: StudentMembershipPreviewResponse;
};
type EnrollmentActionPlan = {
  mode: EnrollmentActionMode;
  targetClassIds: string[];
  targetConfigs: Record<string, EnrollmentTargetConfig>;
  previewMeta?: ActionPlanPreviewMeta | null;
  enrollmentDateDecisions?: Record<string, string> | null;
  billingChangeReason?: string | null;
};

type PendingStudentIdentityConflict = {
  conflict: StudentIdentityConflict;
  values: StudentCreate;
};

type StudentView = "class" | "unassigned" | "stopped";

const STUDENT_VIEWS: Array<{
  value: StudentView;
  label: string;
  state?: StudentListState;
  countKey?: "unassigned" | "stopped";
}> = [
  { value: "class", label: "Học viên đang học" },
  { value: "unassigned", label: "Học viên chưa xếp lớp", state: "UNASSIGNED", countKey: "unassigned" },
  { value: "stopped", label: "Học viên ngừng học trung tâm", state: "STOPPED", countKey: "stopped" },
];

const STUDENT_FEEDBACK_FIELDS = [
  "full_name",
  "birth_date",
  "school",
  "custom_fee",
  "student_contact",
  "parent_contact",
  "notes",
  "enrollment_date",
] as const;

const studentHiddenFieldSchema = z.enum([
  "birth_date",
  "school",
  "enrollment_date",
  "custom_fee",
  "student_contact",
  "parent_contact",
  "notes",
]);

const STUDENT_PRIVACY_FIELDS = new Set<StudentHiddenField>([
  "birth_date",
  "school",
  "student_contact",
  "parent_contact",
  "notes",
]);

function normalizeStudentHiddenFields(
  fields: readonly StudentHiddenField[] | null | undefined,
) {
  return (fields ?? []).filter((field) => STUDENT_PRIVACY_FIELDS.has(field));
}

const studentFormObjectSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, validationMessages.required("họ và tên"))
    .max(120, "Họ và tên không được vượt quá 120 ký tự."),
  birth_date: z
    .string()
    .optional()
    .nullable()
    .refine((value) => !value || isValidBirthDate(value), validationMessages.birthDateFormat),
  school: z.string().trim().max(160, "Tên trường không được vượt quá 160 ký tự.").optional(),
  student_zalo: z.string().trim().max(100, "Tên Zalo không được vượt quá 100 ký tự.").optional(),
  student_phone: z
    .string()
    .max(32, validationMessages.studentPhoneFormat)
    .optional()
    .refine(
      (value) => !value || isValidVietnamMobilePhone(value),
      validationMessages.studentPhoneFormat,
    ),
  parent_phone: z
    .string()
    .max(32, validationMessages.parentPhoneFormat)
    .optional()
    .refine(
      (value) => !value || isValidVietnamMobilePhone(value),
      validationMessages.parentPhoneFormat,
    ),
  parent_zalo: z.string().trim().max(100, "Tên Zalo không được vượt quá 100 ký tự.").optional(),
  notes: z.string().trim().max(1000, "Ghi chú không được vượt quá 1.000 ký tự.").optional(),
  hidden_fields: z.array(studentHiddenFieldSchema).max(7),
  custom_fee: z
    // `null` is intentional: it means "use the selected class fee", not missing data.
    .number({ message: validationMessages.feeFormat })
    .min(0, validationMessages.feeNonNegative)
    .nullable(),
  enrollment_date: z
    .string()
    .optional()
    .refine(
      (value) => !value || isValidIsoDate(value),
      "Ngày bắt đầu không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy.",
    ),
});

type StudentFormObjectValues = z.infer<typeof studentFormObjectSchema>;

function addStudentFormIssues(
  values: StudentFormObjectValues,
  context: z.RefinementCtx,
  requireCreateFields: boolean,
  requireEnrollment = requireCreateFields,
) {
  if (requireCreateFields) {
    const requiredFields = [
      {
        missing: !values.birth_date,
        path: "birth_date" as const,
        message: validationMessages.required("ngày sinh"),
      },
      {
        missing: !values.school?.trim(),
        path: "school" as const,
        message: validationMessages.required("trường"),
      },
      {
        missing: !values.parent_zalo?.trim(),
        path: "parent_zalo" as const,
        message: validationMessages.required("tên Zalo phụ huynh"),
      },
      {
        missing: !values.parent_phone?.trim(),
        path: "parent_phone" as const,
        message: validationMessages.required("số điện thoại phụ huynh"),
      },
      ...(requireEnrollment ? [{
        missing: !values.enrollment_date,
        path: "enrollment_date" as const,
        message: validationMessages.required("ngày bắt đầu"),
      }] : []),
    ];

    for (const field of requiredFields) {
      if (field.missing) {
        context.addIssue({
          code: "custom",
          message: field.message,
          path: [field.path],
        });
      }
    }
  }

  const contactPairs = [
    {
      error: getContactPairError(values.student_zalo, values.student_phone, "học viên"),
      zaloPath: "student_zalo" as const,
      phonePath: "student_phone" as const,
    },
    {
      error: getContactPairError(values.parent_zalo, values.parent_phone, "phụ huynh"),
      zaloPath: "parent_zalo" as const,
      phonePath: "parent_phone" as const,
    },
  ];

  for (const pair of contactPairs) {
    if (!pair.error) {
      continue;
    }

    context.addIssue({
      code: "custom",
      message: pair.error.message,
      path: [pair.error.missingField === "zalo" ? pair.zaloPath : pair.phonePath],
    });
  }
}

const studentSchema = studentFormObjectSchema.superRefine((values, context) => {
  addStudentFormIssues(values, context, false);
});

const studentCreateSchema = studentFormObjectSchema.superRefine((values, context) => {
  addStudentFormIssues(values, context, true);
});

const studentProfileCreateSchema = studentFormObjectSchema.superRefine((values, context) => {
  addStudentFormIssues(values, context, true, false);
});

type StudentFormValues = z.infer<typeof studentSchema>;

const defaultStudentValues: StudentFormValues = {
  full_name: "",
  birth_date: null,
  school: "",
  student_zalo: "",
  student_phone: "",
  parent_phone: "",
  parent_zalo: "",
  notes: "",
  hidden_fields: [],
  custom_fee: null,
  enrollment_date: getTodayInputValue(),
};

export default function StudentsPage() {
  return (
    <Suspense fallback={<StudentsRouteSkeleton />}>
      <StudentsContent />
    </Suspense>
  );
}

function StudentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = isManagementUser(user);
  const [search, setSearch] = usePersistentState("tpro:students:selected-class-search", "");
  const [classSearch, setClassSearch] = usePersistentState("tpro:students:class-search", "");
  const deferredSearch = useDebouncedValue(search, 200);
  const requestedViewParam = searchParams.get("view");
  // One-release compatibility for old bookmarks. Enrollment history now
  // lives inside the unassigned profile instead of occupying a fourth tab.
  const requestedView = requestedViewParam === "former"
    ? "unassigned"
    : requestedViewParam === "archived"
      ? "stopped"
      : requestedViewParam;
  const routeView: StudentView = STUDENT_VIEWS.some((item) => item.value === requestedView)
    ? (requestedView as StudentView)
    : "class";
  const [view, setView] = useState<StudentView>(routeView);
  const activeView = STUDENT_VIEWS.find((item) => item.value === view) ?? STUDENT_VIEWS[0];
  const [classType, setClassType] = useState<ClassType | "">("");
  const [classDuration, setClassDuration] = useState("");
  const routeClassId = getSelectedStudentClassFromSearchParams(
    new URLSearchParams(searchParams.toString()),
  );
  const [classId, setClassId] = useState(routeClassId);
  const [workspaceStudent, setWorkspaceStudent] = useState<StudentResponse | null>(null);
  const requestedStudentId = searchParams.get("student_id");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [pendingIdentityConflict, setPendingIdentityConflict] =
    useState<PendingStudentIdentityConflict | null>(null);
  const [isExportingStudents, setIsExportingStudents] = useState(false);
  const [isNavigationPending, startNavigationTransition] = useTransition();
  const notify = useToast();

  // URL changes (browser Back/Forward or a deep link) remain authoritative,
  // while click handlers below update local state before starting navigation.
  // Waiting for router.replace inside a transition made the selected tab feel
  // delayed even though the target query had already started loading.
  useEffect(() => {
    if (isNavigationPending) return;
    setView(routeView);
    setClassId(routeClassId);
  }, [isNavigationPending, routeClassId, routeView]);

  const updateSelectedClass = useCallback(
    (nextClassId: string, clearStudentSearch = true) => {
      const nextHref = replaceSelectedStudentClassInSearchParams(
        new URLSearchParams(searchParams.toString()),
        nextClassId,
      );
      rememberStudentClass(user?.id, nextClassId);
      if (clearStudentSearch) {
        setSearch("");
      }
      setClassId(nextClassId);
      startNavigationTransition(() => {
        router.replace(nextHref, { scroll: false });
      });
    },
    [router, searchParams, setSearch, startNavigationTransition, user?.id],
  );

  const updateView = useCallback((nextView: StudentView) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", nextView);
    if (nextView !== "class") params.delete("class_id");
    setSearch("");
    setView(nextView);
    if (nextView !== "class") setClassId("");
    startNavigationTransition(() => {
      router.replace(`/students?${params.toString()}`, { scroll: false });
    });
  }, [router, searchParams, setSearch, startNavigationTransition]);

  const filters = useMemo<StudentListFilters>(() => ({
    class_id: view === "class" ? classId : undefined,
    status: view === "class" ? ("active" as const) : undefined,
    list_state: view === "class" ? undefined : activeView.state,
    search: deferredSearch.trim() || undefined,
    limit: 80,
  }), [activeView.state, classId, deferredSearch, view]);

  const studentsQuery = useInfiniteQuery({
    queryKey: studentQueryKeys.list(filters),
    queryFn: ({ pageParam, signal }) => getStudentsPage({ ...filters, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.has_more ? page.next_cursor ?? undefined : undefined,
    enabled: Boolean(user) && (view !== "class" || Boolean(classId)),
    staleTime: 5 * 60_000,
  });

  const scopeSummaryQuery = useQuery({
    queryKey: studentQueryKeys.summary(),
    queryFn: ({ signal }) => getStudentScopeSummary(signal),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });

  const requestedStudentQuery = useQuery({
    queryKey: studentQueryKeys.detail(requestedStudentId),
    queryFn: ({ signal }) => getStudent(requestedStudentId!, signal),
    enabled: Boolean(user && isAdmin && requestedStudentId),
    retry: false,
    staleTime: 10 * 60_000,
  });

  useLayoutEffect(() => {
    if (requestedStudentQuery.data) {
      setWorkspaceStudent(requestedStudentQuery.data);
    }
  }, [requestedStudentQuery.data]);

  const openStudentWorkspace = useCallback((student: StudentResponse) => {
    setWorkspaceStudent(student);
    const params = new URLSearchParams(searchParams.toString());
    params.set("student_id", student.id);
    queryClient.setQueryData(studentQueryKeys.detail(student.id), student);
    startNavigationTransition(() => router.replace(`/students?${params.toString()}`, { scroll: false }));
  }, [queryClient, router, searchParams, startNavigationTransition]);

  const closeStudentWorkspace = useCallback(() => {
    setWorkspaceStudent(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("student_id");
    const query = params.toString();
    startNavigationTransition(() => router.replace(query ? `/students?${query}` : "/students", { scroll: false }));
  }, [router, searchParams, startNavigationTransition]);

  const classesQuery = useQuery({
    queryKey: classQueryKeys.list("enrollable"),
    queryFn: () => getClasses({ scope: "enrollable" }),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
    initialData: () => queryClient.getQueryData<ClassResponse[]>(classQueryKeys.list("enrollable")),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(classQueryKeys.list("enrollable"))?.dataUpdatedAt,
  });

  const createMutation = useMutation({
    mutationFn: createStudent,
    onSuccess: (createdStudent, variables) => {
      setIsFormOpen(false);
      setPendingIdentityConflict(null);
      notify.success(
        variables.class_id
          ? `Đã thêm ${variables.full_name.trim()} vào lớp.`
          : `Đã tạo hồ sơ ${formatStudentCode(createdStudent.student_code)}.`,
      );
      openStudentWorkspace(createdStudent);
      void invalidateStudentDependencies({
        affectsClasses: Boolean(variables.class_id),
        affectsFees: Boolean(variables.class_id),
      });
    },
    onError: (error, variables) => {
      const conflict = getStudentIdentityConflict(error);
      if (conflict) {
        setPendingIdentityConflict({
          conflict,
          values: {
            ...variables,
            duplicate_resolution: undefined,
          },
        });
        return;
      }
      notify.error(getApiErrorMessage(error, "Không thể thêm học viên. Vui lòng thử lại."));
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: ({
      candidate,
      values,
    }: {
      candidate: StudentIdentityCandidate;
      values: StudentCreate;
    }) => {
      const { duplicate_resolution, ...student } = values;
      void duplicate_resolution;
      return reactivateStudent(candidate.id, {
        student: {
          ...student,
        },
        expected_updated_at: candidate.updated_at,
      });
    },
    onSuccess: (restoredStudent, variables) => {
      setPendingIdentityConflict(null);
      setIsFormOpen(false);
      closeStudentWorkspace();
      notify.success(
        view !== "class"
          ? `Đã sử dụng hồ sơ ${restoredStudent.full_name}.`
          : variables.candidate.status === "inactive"
          ? `Đã tiếp nhận lại học viên ${restoredStudent.full_name}.`
          : `Đã thêm ${restoredStudent.full_name} vào lớp.`,
      );
      void invalidateStudentDependencies({
        affectsClasses: Boolean(variables.values.class_id),
        affectsFees: Boolean(variables.values.class_id),
      });
    },
    onError: (error, variables) => {
      const conflict = getStudentIdentityConflict(error);
      if (conflict) {
        setPendingIdentityConflict({
          conflict,
          values: variables.values,
        });
        notify.warning("Hồ sơ đã thay đổi. Danh sách vừa được cập nhật.");
        return;
      }
      notify.error(
        getApiErrorMessage(
          error,
          "Không thể tiếp nhận lại hồ sơ học viên. Vui lòng thử lại.",
        ),
      );
    },
  });

  const submitRequestIdRef = useRef<string | null>(null);
  const lastSubmittedPayloadHashRef = useRef<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: async ({
      enrollmentActionPlan,
      enrollmentFees,
      id,
      values,
    }: {
      enrollmentActionPlan: EnrollmentActionPlan;
      enrollmentFees: EnrollmentFeeValues;
      id: string;
      values: StudentFormValues;
    }) => {
      const activeEnrollments = workspaceStudent?.active_enrollments ?? [];
      const dateDecisions = enrollmentActionPlan.enrollmentDateDecisions ?? {};
      const enrollmentUpdates = activeEnrollments.flatMap((enrollment) => {
        const billingValues = enrollmentFees[enrollment.id];
        if (!billingValues) {
          return [];
        }
        const payload: { custom_fee?: number | null; enrollment_date?: string | null; selected_slot_ids?: string[]; billing_change_reason?: string; decision_code?: string } = {};
        if (billingValues.custom_fee !== enrollment.custom_fee) {
          payload.custom_fee = billingValues.custom_fee;
        }
        if (billingValues.enrollment_date !== enrollment.enrollment_date) {
          payload.enrollment_date = billingValues.enrollment_date;
          payload.billing_change_reason =
            enrollmentActionPlan.billingChangeReason || "Điều chỉnh ngày bắt đầu theo hồ sơ học viên";
          if (dateDecisions[enrollment.id]) {
            payload.decision_code = dateDecisions[enrollment.id];
          }
        }
        const previousSlots = [...enrollment.selected_slot_ids].sort();
        const nextSlots = [...billingValues.selected_slot_ids].sort();
        if (previousSlots.length !== nextSlots.length || previousSlots.some((slotId, index) => slotId !== nextSlots[index])) {
          payload.selected_slot_ids = billingValues.selected_slot_ids;
        }
        return Object.keys(payload).length > 0
          ? [{ enrollment_id: enrollment.id, ...payload }]
          : [];
      });
      const sourceEnrollment = enrollmentActionPlan.mode === "transfer" && selectedClass
        ? activeEnrollments.find((enrollment) => enrollment.class_id === selectedClass.id)
        : null;

      const hasTargets = enrollmentActionPlan.targetClassIds.length > 0;
      const targets = enrollmentActionPlan.targetClassIds.map((class_id) => ({
        class_id,
        custom_fee: enrollmentActionPlan.targetConfigs[class_id]?.custom_fee ?? null,
        enrollment_date: enrollmentActionPlan.targetConfigs[class_id]?.enrollment_date ?? null,
        selected_slot_ids: enrollmentActionPlan.targetConfigs[class_id]?.selected_slot_ids ?? null,
      }));

      const hasDateChange = enrollmentUpdates.some((item) => "enrollment_date" in item && Boolean(item.enrollment_date));
      const contractVersion = (hasTargets || hasDateChange) ? 3 : 1;

      // Quản lý request_id ổn định theo payload thực tế cho retry/timeout
      const rawPayload = {
        student_id: id,
        expected_updated_at: workspaceStudent?.updated_at ?? "",
        profile: toStudentPayload(values),
        enrollment_updates: enrollmentUpdates,
        targets,
        mode: enrollmentActionPlan.mode,
        source_enrollment_id: sourceEnrollment?.id ?? null,
        contract_version: contractVersion,
        expected_preview_fingerprint: enrollmentActionPlan.previewMeta?.previewFingerprint ?? null,
      };

      const payloadHash = JSON.stringify(rawPayload);
      if (!submitRequestIdRef.current || lastSubmittedPayloadHashRef.current !== payloadHash) {
        submitRequestIdRef.current = crypto.randomUUID();
        lastSubmittedPayloadHashRef.current = payloadHash;
      }
      const requestId = submitRequestIdRef.current;

      const updatedStudent = await applyStudentMembershipCommand(id, {
        request_id: requestId,
        contract_version: contractVersion,
        expected_preview_fingerprint: enrollmentActionPlan.previewMeta?.previewFingerprint ?? null,
        expected_updated_at: workspaceStudent?.updated_at ?? "",
        profile: toStudentPayload(values),
        enrollment_updates: enrollmentUpdates,
        targets,
        mode: enrollmentActionPlan.mode,
        source_enrollment_id: sourceEnrollment?.id ?? null,
        billing_change_reason: enrollmentUpdates.some((item) => "enrollment_date" in item)
          ? enrollmentActionPlan.billingChangeReason || "Điều chỉnh ngày bắt đầu theo hồ sơ học viên"
          : null,
      });

      const studentName = values.full_name.trim();
      const targetClassNames = enrollmentActionPlan.targetClassIds
        .map((targetClassId) => classesQuery.data?.find((class_) => class_.id === targetClassId)?.name ?? null)
        .filter((className): className is string => Boolean(className));

      let message = `Đã cập nhật học viên ${studentName}`;
      if (targetClassNames.length > 0) {
        if (enrollmentActionPlan.mode === "transfer") {
          message = `Đã chuyển ${studentName} sang ${targetClassNames.join(", ")}`;
        } else {
          message = `Đã thêm ${studentName} vào ${targetClassNames.join(", ")}`;
        }
      }

      const affectedClassIds = [
        ...enrollmentActionPlan.targetClassIds,
        ...(sourceEnrollment ? [sourceEnrollment.class_id] : []),
      ];

      return {
        updatedStudent,
        message,
        affectsEnrollment:
          enrollmentUpdates.length > 0 ||
          enrollmentActionPlan.targetClassIds.length > 0 ||
          enrollmentActionPlan.mode === "transfer",
        affectedClassIds,
      };
    },
    onSuccess: ({ updatedStudent, message, affectsEnrollment, affectedClassIds }) => {
      queryClient.setQueryData(studentQueryKeys.detail(updatedStudent.id), updatedStudent);
      setWorkspaceStudent((current) => (current?.id === updatedStudent.id ? updatedStudent : current));
      notify.success(`${message}.`);

      void invalidateStudentDependencies({
        affectsClasses: affectsEnrollment,
        affectsFees: affectsEnrollment,
        affectedClassIds,
      });
    },
    onError: (error) => {
      notify.error(getApiErrorMessage(error, "Không thể cập nhật học viên. Vui lòng thử lại."));
    },
  });

  const dropEnrollmentMutation = useMutation({
    mutationFn: dropEnrollment,
    onSuccess: () => {
      closeStudentWorkspace();
      notify.success("Đã xoá học viên khỏi lớp.");
      void invalidateStudentDependencies({ affectsClasses: true, affectsFees: true });
    },
    onError: (error) => {
      notify.error(getApiErrorMessage(error, "Không thể xoá học viên khỏi lớp. Vui lòng thử lại."));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => archiveStudent(id, reason),
    onSuccess: (student) => {
      closeStudentWorkspace();
      notify.success(`Đã chuyển ${student.full_name} sang nhóm ngừng học.`);
      void invalidateStudentDependencies();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể cập nhật trạng thái ngừng học. Vui lòng thử lại.")),
  });

  const restoreMutation = useMutation({
    mutationFn: async ({
      id,
      reason,
      expected_updated_at,
    }: {
      id: string;
      reason: string;
      expected_updated_at: string;
    }) => {
      try {
        return await restoreStudent(id, reason, expected_updated_at);
      } catch (error) {
        if (axios.isAxiosError(error) && (!error.response || error.code === "ECONNABORTED")) {
          try {
            const freshStudent = await getStudent(id);
            if (freshStudent.status === "active" && freshStudent.list_state === "UNASSIGNED") {
              return freshStudent;
            }
          } catch {
            // Ignore fallback fetch error, will rethrow original error
          }
        }
        throw error;
      }
    },
    onSuccess: (student) => {
      queryClient.setQueryData(studentQueryKeys.detail(student.id), student);
      closeStudentWorkspace();

      // Loại học viên khỏi cache danh sách STOPPED ngay lập tức
      queryClient.setQueriesData<InfiniteData<StudentListPageResponse>>(
        { queryKey: studentQueryKeys.lists() },
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.id !== student.id),
            })),
          };
        },
      );

      // Cập nhật summary: stopped giảm 1, unassigned tăng 1
      queryClient.setQueryData<StudentScopeSummary>(studentQueryKeys.summary(), (old) => {
        if (!old) return old;
        return {
          ...old,
          stopped: Math.max(0, old.stopped - 1),
          unassigned: old.unassigned + 1,
        };
      });

      notify.success(`Đã chuyển ${student.full_name} sang Học viên chưa xếp lớp.`);
      void invalidateStudentDependencies({ affectsFees: true });
    },
    onError: (error) => {
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : null;
      const code = typeof detail === "object" && detail !== null ? (detail as { code?: string }).code : null;

      if (code === "STUDENT_CHANGED") {
        notify.warning("Hồ sơ vừa được cập nhật bởi thao tác khác. Vui lòng kiểm tra lại thông tin mới nhất.");
        if (workspaceStudent?.id) {
          void queryClient.invalidateQueries({ queryKey: studentQueryKeys.detail(workspaceStudent.id) });
        }
        return;
      }

      if (code === "STUDENT_NOT_STOPPED") {
        notify.error("Hồ sơ không còn ở trạng thái ngừng học.");
        if (workspaceStudent?.id) {
          void queryClient.invalidateQueries({ queryKey: studentQueryKeys.detail(workspaceStudent.id) });
        }
        return;
      }

      if (code === "STUDENT_RESTORE_MEMBERSHIP_CONFLICT") {
        notify.error("Hồ sơ đang có ghi danh lớp học hiệu lực. Vui lòng kiểm tra lại trạng thái lớp học trước khi cho học lại.");
        return;
      }

      notify.error(getApiErrorMessage(error, "Không thể chuyển học viên sang trạng thái học lại. Vui lòng thử lại."));
    },
  });

  async function invalidateStudentDependencies({
    affectsClasses = false,
    affectsFees = false,
    affectedClassIds = [],
  }: {
    affectsClasses?: boolean;
    affectsFees?: boolean;
    affectedClassIds?: string[];
  } = {}) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: studentQueryKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: studentQueryKeys.summary() }),
    ]);

    if (affectsClasses) {
      const classInvalidations = [
        queryClient.invalidateQueries({ queryKey: classQueryKeys.list("enrollable") }),
        queryClient.invalidateQueries({ queryKey: classQueryKeys.summary() }),
      ];
      for (const cid of affectedClassIds) {
        if (cid) {
          classInvalidations.push(queryClient.invalidateQueries({ queryKey: classQueryKeys.detail(cid) }));
          classInvalidations.push(queryClient.invalidateQueries({ queryKey: classQueryKeys.history(cid) }));
        }
      }
      await Promise.all(classInvalidations);
    }

    if (affectsFees) {
      await queryClient.invalidateQueries({ queryKey: ["fees"] });
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: ["reports"], refetchType: "none" }),
    ]);
  }

  function openCreateForm() {
    if (view === "class" && !selectedClass) {
      notify.warning("Vui lòng chọn lớp trước khi thêm học viên.");
      return;
    }

    setPendingIdentityConflict(null);
    setIsFormOpen(true);
  }

  // R6-D08: tìm kiếm do server thực hiện (indexed, cursor); FE không lọc
  // hoặc sort lại toàn bộ danh sách bằng JS. Backend giữ thứ tự keyset.
  const students = useMemo(
    () => studentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [studentsQuery.data],
  );
  const contactSuggestionSources = useMemo<ContactSuggestionSource[]>(
    () =>
      students.flatMap((student) => {
        if (student.status !== "active" || student.active_enrollments.length === 0) {
          return [];
        }

        const sources: ContactSuggestionSource[] = [];
        if (!isStudentFieldHidden(student, "student_contact")) {
          sources.push({
            owner: "student",
            phone: student.student_phone,
            zaloName: student.student_zalo,
          });
        }
        if (!isStudentFieldHidden(student, "parent_contact")) {
          sources.push({
            owner: "parent",
            phone: student.parent_phone,
            zaloName: student.parent_zalo,
          });
        }
        return sources;
      }),
    [students],
  );
  const totalStudentCount = students.length;
  const hasStudentQueryData = studentsQuery.data !== undefined;
  const hasBlockingStudentError = studentsQuery.isError && !hasStudentQueryData;
  const hasSettledScopeSummary = scopeSummaryQuery.data !== undefined || scopeSummaryQuery.isError;
  const hasSettledClasses = classesQuery.data !== undefined || classesQuery.isError;
  const isCoordinatedContentLoading =
    !user ||
    !hasSettledScopeSummary ||
    !hasSettledClasses;
  // Keep the search state active while the debounced query catches up in
  // either direction. This prevents a clear action from flashing the base
  // empty-state message before the unfiltered response arrives.
  const hasSearch = Boolean(search.trim() || deferredSearch.trim());
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const selectedClass = classes.find((class_) => class_.id === classId) ?? null;
  const isResolvingSelectedClass = Boolean(classId) && classesQuery.isLoading && !selectedClass;
  const isStudentFormSaving =
    (createMutation.isPending && pendingIdentityConflict === null) ||
    updateMutation.isPending;

  useEffect(() => {
    if (!user || view !== "class") {
      return;
    }

    if (classId) {
      rememberStudentClass(user.id, classId);
      return;
    }

    const rememberedClassId = readRememberedStudentClass(user.id);
    if (rememberedClassId) {
      updateSelectedClass(rememberedClassId, false);
    }
  }, [classId, updateSelectedClass, user, view]);

  useEffect(() => {
    if (!user || view !== "class" || !classId || !classesQuery.isSuccess) {
      return;
    }

    if (!classes.some((class_) => class_.id === classId)) {
      updateSelectedClass("", false);
    }
  }, [classId, classes, classesQuery.isSuccess, updateSelectedClass, user, view]);

  async function handleExportStudents() {
    if (!selectedClass || students.length === 0) {
      return;
    }

    setIsExportingStudents(true);
    try {
      const exportStudentsData: StudentResponse[] = [];
      let cursor: string | undefined;
      do {
        const page = await getStudentsPage({
          class_id: selectedClass.id,
          status: "active",
          search: deferredSearch.trim() || undefined,
          cursor,
          limit: 500,
        });
        exportStudentsData.push(...page.items);
        cursor = page.has_more ? page.next_cursor ?? undefined : undefined;
      } while (cursor);

      await exportStudents(exportStudentsData, selectedClass);
      notify.success(`Đã xuất danh sách ${exportStudentsData.length} học viên ra file Excel.`);
    } catch {
      notify.error("Không thể xuất danh sách học viên. Vui lòng thử lại.");
    } finally {
      setIsExportingStudents(false);
    }
  }

  if (isCoordinatedContentLoading) {
    return (
      <div className="flex flex-col gap-4 overflow-x-hidden md:h-full md:overflow-hidden">
        <StudentScopeTabs
          activeView={view}
          summary={scopeSummaryQuery.data}
          isLoading
          onChange={updateView}
        />
        <StudentHeaderLoadingSkeleton isAdmin={isAdmin} />
        {view === "class" ? (
          classId ? (
            <StudentClassDetailSkeleton isAdmin={isAdmin} />
          ) : (
            <StudentClassSelectionSkeleton includeScopeTabs={false} />
          )
        ) : (
          <StudentProfileScopeSkeleton isAdmin={isAdmin} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 overflow-x-hidden md:h-full md:overflow-hidden">
      <StudentScopeTabs
        activeView={view}
        summary={scopeSummaryQuery.data}
        isLoading={
          scopeSummaryQuery.isFetching ||
          classesQuery.isFetching ||
          studentsQuery.isFetching ||
          isNavigationPending
        }
        onChange={updateView}
      />

      {view === "class" && !classId ? (
        <ClassSelectionView
          classSearch={classSearch}
          classType={classType}
          onClassTypeChange={setClassType}
          classDuration={classDuration}
          onClassDurationChange={setClassDuration}
          classes={classes}
          errorDescription={getApiErrorMessage(
            classesQuery.error,
            "Không thể tải danh sách lớp. Vui lòng thử lại.",
          )}
          isError={classesQuery.isError}
          isLoading={classesQuery.isLoading}
          isRefreshing={classesQuery.isFetching || isNavigationPending}
          onClassSearchChange={setClassSearch}
          onPrefetchClass={(nextClassId) => {
            const nextFilters: StudentListFilters = {
              class_id: nextClassId,
              status: "active",
              limit: 80,
            };
            void queryClient.prefetchInfiniteQuery({
              queryKey: studentQueryKeys.list(nextFilters),
              queryFn: ({ pageParam, signal }) =>
                getStudentsPage({ ...nextFilters, cursor: pageParam }, signal),
              initialPageParam: undefined as string | undefined,
              getNextPageParam: (page: StudentListPageResponse) =>
                page.has_more ? page.next_cursor ?? undefined : undefined,
              staleTime: 5 * 60_000,
            });
          }}
          onRetry={() => void classesQuery.refetch()}
          onSelectClass={(nextClassId) => {
            updateSelectedClass(nextClassId);
            setClassType("");
            setClassDuration("");
          }}
        />
      ) : null}

      {view === "class" && isResolvingSelectedClass ? (
        <>
          <StudentHeaderLoadingSkeleton isAdmin={isAdmin} />
          <StudentClassDetailSkeleton isAdmin={isAdmin} />
        </>
      ) : null}

      {view === "class" && selectedClass ? (
        <>
          <HeaderControlsPortal>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <HeaderFilterControls
                searchPlaceholder={`Tìm học viên trong ${selectedClass.name}...`}
                searchValue={search}
                onSearchChange={setSearch}
                filters={[]}
              />
              <StudentListStatus
                filteredCount={students.length}
                totalCount={totalStudentCount}
              />
              {isAdmin ? <AddStudentButton onClick={openCreateForm} /> : null}
              <StudentLoadingStatus isRefreshing={studentsQuery.isFetching || isNavigationPending} />
            </div>
          </HeaderControlsPortal>

          <SelectedClassBar
            canExport={students.length > 0}
            isExporting={isExportingStudents}
            class_={selectedClass}
            onChangeClass={() => {
              updateSelectedClass("");
            }}
            onExportStudents={() => void handleExportStudents()}
          />

          <div className="flex min-w-0 flex-1 items-center gap-3 md:hidden">
            <HeaderFilterControls
              searchPlaceholder={`Tìm học viên trong ${selectedClass.name}...`}
              searchValue={search}
              onSearchChange={setSearch}
              filters={[]}
            />
            <StudentListStatus
              filteredCount={students.length}
              totalCount={totalStudentCount}
            />
            {isAdmin ? <AddStudentButton compact onClick={openCreateForm} /> : null}
            <StudentLoadingStatus isRefreshing={studentsQuery.isFetching || isNavigationPending} />
          </div>

          <div className="min-h-0 md:flex-1 md:overflow-hidden">
            {studentsQuery.isError && hasStudentQueryData ? (
              <div
                role="status"
                className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
              >
                <p className="helper-text">Chưa cập nhật được dữ liệu mới. Danh sách gần nhất vẫn được giữ lại.</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={studentsQuery.isFetching}
                  onClick={() => void studentsQuery.refetch()}
                  className="shrink-0 text-amber-900 hover:bg-amber-100"
                >
                  {studentsQuery.isFetching ? <LoadingLabel label="Đang thử lại" /> : "Thử lại"}
                </Button>
              </div>
            ) : null}

            {studentsQuery.isLoading && !hasStudentQueryData ? <StudentTableSkeleton isAdmin={isAdmin} /> : null}

            {hasBlockingStudentError ? (
              <DataSectionError
                className="md:h-full"
                title="Chưa tải được danh sách học viên"
                description={getApiErrorMessage(
                  studentsQuery.error,
                  "Không thể tải danh sách học viên. Vui lòng thử lại.",
                )}
                isRetrying={studentsQuery.isFetching}
                onRetry={() => void studentsQuery.refetch()}
              />
            ) : null}

            {!studentsQuery.isLoading && !hasBlockingStudentError && hasStudentQueryData ? (
              students.length > 0 ? (
                <StudentsTable
                  currentClassId={selectedClass.id}
                  students={students}
                  isAdmin={isAdmin}
                  onRowClick={(student) => {
                    if (isAdmin) {
                      openStudentWorkspace(student);
                    }
                  }}
                />
              ) : hasSearch && selectedClass.student_count > 0 ? (
                <DataSectionEmpty
                  className="md:h-full"
                  icon={SearchX}
                  title="Không tìm thấy học viên phù hợp"
                  description="Thử tìm bằng họ tên, mã học viên, số điện thoại hoặc tên Zalo khác."
                  actionLabel="Xóa từ khóa tìm kiếm"
                  onAction={() => setSearch("")}
                />
              ) : (
                <DataSectionEmpty
                  className="md:h-full"
                  icon={UsersRound}
                  title="Lớp chưa có học viên"
                  description={
                    isAdmin
                      ? "Thêm học viên đầu tiên để bắt đầu quản lý danh sách lớp."
                      : "Danh sách sẽ xuất hiện khi quản trị viên thêm học viên vào lớp."
                  }
                  {...(isAdmin ? { actionLabel: "Thêm học viên", onAction: openCreateForm } : {})}
                />
              )
            ) : null}
          </div>
        </>
      ) : null}

      {view !== "class" ? (
        <StudentProfileScope
          view={view}
          students={students}
          search={search}
          hasSearch={hasSearch}
          isAdmin={isAdmin}
          isLoading={studentsQuery.isLoading && !hasStudentQueryData}
          isRefreshing={studentsQuery.isFetching || isNavigationPending}
          error={studentsQuery.error}
          hasError={hasBlockingStudentError}
          hasMore={studentsQuery.hasNextPage}
          isLoadingMore={studentsQuery.isFetchingNextPage}
          onLoadMore={() => void studentsQuery.fetchNextPage()}
          onRetry={() => void studentsQuery.refetch()}
          onSearchChange={setSearch}
          onCreate={openCreateForm}
          onOpen={openStudentWorkspace}
        />
      ) : null}

      {isFormOpen && (view !== "class" || selectedClass) ? (
        <StudentFormDialog
          classes={classes}
          contactSuggestionSources={contactSuggestionSources}
          currentClassId={view === "class" ? selectedClass?.id ?? null : null}
          isSaving={isStudentFormSaving}
          student={null}
          onClose={() => {
            setIsFormOpen(false);
            setPendingIdentityConflict(null);
          }}
          onSubmit={(values, _fees, _plan, slotIds) => {
            createMutation.mutate(
              toStudentCreatePayload(
                values,
                view === "class" ? selectedClass?.id ?? null : null,
                slotIds,
              ),
            );
          }}
        />
      ) : null}

      {workspaceStudent && isAdmin ? (
        <StudentWorkspaceDialog
          student={workspaceStudent}
          initialMode={workspaceStudent.status === "archived" ? "restore" : "edit"}
          selectedClass={view === "class" ? selectedClass : null}
          isSaving={updateMutation.isPending}
          isDeleting={dropEnrollmentMutation.isPending}
          isLifecyclePending={archiveMutation.isPending || restoreMutation.isPending}
          onArchive={(reason) => archiveMutation.mutate({ id: workspaceStudent.id, reason })}
          onRestore={(reason, expected_updated_at) =>
            restoreMutation.mutate({
              id: workspaceStudent.id,
              reason,
              expected_updated_at: expected_updated_at || workspaceStudent.updated_at,
            })
          }
          onClose={closeStudentWorkspace}
          onRemoveFromClass={() => {
            const enrollment = workspaceStudent.active_enrollments.find(
              (e) => e.class_id === classId,
            );
            if (enrollment) {
              dropEnrollmentMutation.mutate(enrollment.id);
            }
          }}
          renderEditPanel={({ embedded, onDirtyChange, onNestedOverlayChange, onClose }) => (
            <StudentFormDialog
              embedded={embedded}
              onDirtyChange={onDirtyChange}
              onNestedOverlayChange={onNestedOverlayChange}
              classes={classes}
              contactSuggestionSources={contactSuggestionSources}
              currentClassId={view === "class" ? selectedClass?.id ?? null : null}
              isSaving={isStudentFormSaving}
              student={workspaceStudent}
              onClose={onClose}
              onSubmit={(values, enrollmentFees, enrollmentActionPlan) => {
                updateMutation.mutate({
                  enrollmentActionPlan,
                  id: workspaceStudent.id,
                  values,
                  enrollmentFees,
                });
              }}
            />
          )}
        />
      ) : null}

      <StudentReactivationSlide
        className={selectedClass?.name ?? "lớp đang chọn"}
        conflict={pendingIdentityConflict?.conflict ?? null}
        isPending={createMutation.isPending || reactivateMutation.isPending}
        onClose={() => setPendingIdentityConflict(null)}
        onCreateNew={(candidateIds) => {
          if (!pendingIdentityConflict) return;
          createMutation.mutate({
            ...pendingIdentityConflict.values,
            duplicate_resolution: {
              action: "create_new",
              candidate_ids: candidateIds,
            },
          });
        }}
        onReactivate={(candidate) => {
          if (!pendingIdentityConflict) return;
          reactivateMutation.mutate({
            candidate,
            values: pendingIdentityConflict.values,
          });
        }}
      />

      {isAdmin && view === "class" ? (
        <QuickActionFab label="Thêm học viên" onClick={openCreateForm} />
      ) : null}

    </div>
  );
}

function StudentScopeTabs({
  activeView,
  isLoading = false,
  summary,
  onChange,
}: {
  activeView: StudentView;
  isLoading?: boolean;
  summary?: { unassigned: number; current: number; stopped: number };
  onChange: (view: StudentView) => void;
}) {
  return (
    <nav
      aria-label="Phạm vi hồ sơ học viên"
      className="shrink-0 rounded-xl border border-gray-200 bg-white p-1.5"
    >
      <div
        className="grid grid-cols-3 gap-1"
        role="tablist"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const tabs = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
          );
          const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
          if (currentIndex < 0) return;
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          tabs[(currentIndex + direction + tabs.length) % tabs.length]?.focus();
        }}
      >
        {STUDENT_VIEWS.map((item) => {
          const count = item.value === "class"
            ? summary?.current
            : item.countKey
              ? summary?.[item.countKey]
              : undefined;
          const selected = item.value === activeView;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.value)}
              className={cn(
                "inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 text-center text-[12px] font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:gap-1.5 sm:px-3 sm:text-sm md:min-h-9",
                selected
                  ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20"
                  : "text-gray-600 hover:bg-primary-soft/60 hover:text-primary",
              )}
            >
              <span className="min-w-0">{item.label}</span>
              {isLoading ? (
                <span
                  aria-hidden="true"
                  className="h-3.5 w-5 shrink-0 animate-pulse rounded bg-gray-200/90"
                />
              ) : count !== undefined ? (
                <span
                  className={cn(
                    "inline-flex min-w-4 shrink-0 items-center justify-center text-xs font-semibold tabular-nums",
                    selected ? "text-primary" : "text-gray-500",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function StudentProfileScope({
  view,
  students,
  search,
  hasSearch,
  isAdmin,
  isLoading,
  isRefreshing,
  error,
  hasError,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onRetry,
  onSearchChange,
  onCreate,
  onOpen,
}: {
  view: Exclude<StudentView, "class">;
  students: StudentResponse[];
  search: string;
  hasSearch: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error: unknown;
  hasError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onOpen: (student: StudentResponse) => void;
}) {
  const labels = {
    unassigned: { title: "Học viên chưa xếp lớp", empty: "Chưa có học viên chờ xếp lớp." },
    stopped: { title: "Học viên ngừng học trung tâm", empty: "Chưa có học viên ngừng học." },
  }[view];

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <HeaderControlsPortal>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <HeaderFilterControls
            searchPlaceholder="Tìm tên, mã học viên, SĐT..."
            searchValue={search}
            onSearchChange={onSearchChange}
            filters={[]}
          />
          <StudentListStatus filteredCount={students.length} totalCount={students.length} />
          {isAdmin && view === "unassigned" ? <AddStudentButton label="Thêm hồ sơ" onClick={onCreate} /> : null}
          <StudentLoadingStatus isRefreshing={isRefreshing} />
        </div>
      </HeaderControlsPortal>

      <div className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-ui min-w-0 text-base font-semibold leading-5 text-gray-950">{labels.title}</h1>
            <p className="mt-0.5 text-sm font-medium text-gray-500">Mã học viên được giữ nguyên trong suốt quá trình học.</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? <StudentProfileTableSkeleton /> : null}
        {hasError ? (
          <DataSectionError
            className="h-full"
            title="Chưa tải được danh sách học viên"
            description={getApiErrorMessage(error, "Không thể tải danh sách học viên. Vui lòng thử lại.")}
            isRetrying={isRefreshing}
            onRetry={onRetry}
          />
        ) : null}
        {!isLoading && !hasError && students.length === 0 ? (
          <DataSectionEmpty
            className="h-full"
            icon={UsersRound}
            title={hasSearch ? "Không tìm thấy học viên phù hợp" : labels.empty}
            description={hasSearch ? "Thử tìm bằng tên, mã học viên hoặc số điện thoại khác." : "Danh sách sẽ tự cập nhật khi trạng thái hồ sơ thay đổi."}
            {...(hasSearch ? { actionLabel: "Xóa từ khóa tìm kiếm", onAction: () => onSearchChange("") } : {})}
          />
        ) : null}
        {!isLoading && !hasError && students.length > 0 ? (
          <StudentProfileTable students={students} view={view} isAdmin={isAdmin} onOpen={onOpen} />
        ) : null}
      </div>
      {hasMore ? (
        <div className="flex shrink-0 justify-center">
          <Button type="button" variant="outline" className="h-8 rounded-md px-4 text-sm" disabled={isLoadingMore} onClick={onLoadMore}>
            {isLoadingMore ? <LoadingLabel label="Đang tải" /> : "Tải thêm"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

const PROFILE_TABLE_GRID_CLASS = "grid grid-cols-5 gap-x-4";

function StudentProfileTable({
  students,
  view,
  isAdmin,
  onOpen,
}: {
  students: StudentResponse[];
  view: Exclude<StudentView, "class">;
  isAdmin: boolean;
  onOpen: (student: StudentResponse) => void;
}) {
  const selectionContainerRef = useRef<HTMLDivElement>(null);
  useScopedTextSelection(selectionContainerRef);

  return (
    <div
      ref={selectionContainerRef}
      className="text-selection-container scrollbar-hidden overflow-x-hidden md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-contain xl:overflow-hidden"
    >
      <div className="grid gap-3 xl:hidden">
        {students.map((student) => (
          <StudentProfileCard
            key={student.id}
            view={view}
            isAdmin={isAdmin}
            student={student}
            onOpen={onOpen}
          />
        ))}
      </div>

      <div
        role="table"
        aria-label={view === "stopped" ? "Danh sách học viên ngừng học trung tâm" : "Danh sách học viên chưa xếp lớp"}
        className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white xl:h-full xl:min-h-0 xl:flex xl:flex-col"
      >
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-100">
          <div role="row" className={`${PROFILE_TABLE_GRID_CLASS} table-heading-text text-left text-gray-800`}>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Mã HV</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Họ tên</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Ngày sinh</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Trường</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">
              {view === "stopped" ? "Thông tin ngừng học" : "Liên hệ / lớp gần nhất"}
            </div>
          </div>
        </div>

        <div role="rowgroup" className="scrollbar-hidden min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain bg-white">
          <div role="presentation" className="divide-y divide-gray-200 text-[15px] font-medium leading-5">
            {students.map((student) => (
              <StudentProfileTableRow
                key={student.id}
                view={view}
                isAdmin={isAdmin}
                student={student}
                onOpen={onOpen}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StudentProfileTableRow({
  student,
  view,
  isAdmin,
  onOpen,
}: {
  student: StudentResponse;
  view: Exclude<StudentView, "class">;
  isAdmin: boolean;
  onOpen: (student: StudentResponse) => void;
}) {
  const clickableProps = useClickableRowProps(isAdmin ? () => onOpen(student) : undefined);

  return (
    <div
      role="row"
      {...clickableProps}
      tabIndex={isAdmin ? 0 : undefined}
      onKeyDown={(event) => {
        if (isAdmin && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen(student);
        }
      }}
      className={`${PROFILE_TABLE_GRID_CLASS} cv-auto items-start ${
        isAdmin
          ? "cursor-pointer hover:bg-gray-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
          : ""
      }`}
    >
      <div role="cell" className="min-w-0 whitespace-nowrap px-2.5 py-3 font-semibold tabular-nums text-primary">
        <SelectableStudentValue value={formatStudentCode(student.student_code)} />
      </div>
      <div role="cell" className="min-w-0 break-words px-2.5 py-3 font-medium text-gray-900">
        <SelectableStudentValue value={student.full_name} />
      </div>
      <div role="cell" className="min-w-0 whitespace-nowrap px-2.5 py-3 text-gray-700">
        {isStudentFieldHidden(student, "birth_date") ? (
          <HiddenStudentValue />
        ) : (
          <SelectableStudentValue value={formatDate(student.birth_date)} />
        )}
      </div>
      <div role="cell" className="min-w-0 break-words px-2.5 py-3 text-gray-700">
        {isStudentFieldHidden(student, "school") ? (
          <HiddenStudentValue />
        ) : (
          <SelectableStudentValue value={student.school || "—"} />
        )}
      </div>
      <div role="cell" className="min-w-0 px-2.5 py-3 text-gray-700">
        {view === "stopped" ? (
          <div className="min-w-0 space-y-0.5 leading-5">
            <span className="font-medium text-gray-900">
              <SelectableStudentValue value={formatDate(student.archived_at?.slice(0, 10) ?? null)} />
            </span>
            {student.archived_reason ? (
              <span className="ml-2 text-gray-500">
                · <SelectableStudentValue value={student.archived_reason} />
              </span>
            ) : null}
          </div>
        ) : student.last_enrollment ? (
          <div className="min-w-0 space-y-0.5 leading-5">
            <span className="font-medium text-gray-900">
              <SelectableStudentValue value={student.last_enrollment.class_name} />
            </span>
            {student.last_enrollment.ended_at ? (
              <span className="ml-2 text-gray-500">
                · <SelectableStudentValue value={formatDate(student.last_enrollment.ended_at.slice(0, 10))} />
              </span>
            ) : null}
          </div>
        ) : (
          formatContactCell(student, "parent_contact", student.parent_zalo, student.parent_phone)
        )}
      </div>
    </div>
  );
}

function StudentProfileCard({
  student,
  view,
  isAdmin,
  onOpen,
}: {
  student: StudentResponse;
  view: Exclude<StudentView, "class">;
  isAdmin: boolean;
  onOpen: (student: StudentResponse) => void;
}) {
  const clickableProps = useClickableRowProps(isAdmin ? () => onOpen(student) : undefined);

  return (
    <article
      {...clickableProps}
      tabIndex={isAdmin ? 0 : undefined}
      onKeyDown={(event) => {
        if (isAdmin && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen(student);
        }
      }}
      className={`rounded-md border border-gray-200 bg-white p-4 ${
        isAdmin
          ? "cursor-pointer transition hover:bg-gray-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold text-gray-900">
            <SelectableStudentValue value={student.full_name} />
          </h2>
          {student.student_code ? (
            <p className="mt-0.5 text-[13px] font-medium tabular-nums text-gray-500">
              Mã: <SelectableStudentValue value={formatStudentCode(student.student_code)} />
            </p>
          ) : null}
          <p className="mt-1 break-words text-[15px] font-medium text-gray-600">
            <SelectableStudentValue {...getStudentCardSummary(student)} />
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-[15px] font-medium">
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase text-gray-500">
            {view === "stopped" ? "Ngày ngừng học" : "Lớp gần nhất"}
          </dt>
          <dd className="mt-1 text-gray-800">
            {view === "stopped" ? (
              <SelectableStudentValue value={formatDate(student.archived_at?.slice(0, 10) ?? null)} />
            ) : student.last_enrollment ? (
              <span className="font-medium text-gray-900">
                <SelectableStudentValue value={student.last_enrollment.class_name} />
                {student.last_enrollment.ended_at ? (
                  <span className="ml-1 text-gray-500">
                    · {formatDate(student.last_enrollment.ended_at.slice(0, 10))}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-gray-400">Chưa từng học</span>
            )}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase text-gray-500">
            {view === "stopped" ? "Lý do ngừng học" : "Liên hệ"}
          </dt>
          <dd className="mt-1 break-words text-gray-800">
            {view === "stopped" ? (
              <SelectableStudentValue value={student.archived_reason || "—"} />
            ) : isStudentFieldHidden(student, "parent_contact") ? (
              <HiddenStudentValue />
            ) : (
              <SelectableStudentValue
                value={formatContactText(student.parent_zalo, student.parent_phone)}
              />
            )}
          </dd>
        </div>

        {view !== "stopped" && student.student_phone ? (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs font-medium uppercase text-gray-500">Thông tin học viên</dt>
            <dd className="mt-1 break-words text-gray-800">
              {isStudentFieldHidden(student, "student_contact") ? (
                <HiddenStudentValue />
              ) : (
                <SelectableStudentValue
                  value={formatContactText(student.student_zalo, student.student_phone)}
                />
              )}
            </dd>
          </div>
        ) : null}

        {student.notes ? (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs font-medium uppercase text-gray-500">Ghi chú</dt>
            <dd className="mt-1 break-words text-gray-800">
              {isStudentFieldHidden(student, "notes") ? (
                <HiddenStudentValue />
              ) : (
                <SelectableStudentValue value={student.notes} />
              )}
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function AddStudentButton({
  compact = false,
  label = "Thêm học viên",
  onClick,
}: {
  compact?: boolean;
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Thêm học viên"
      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      {compact ? "Thêm" : label}
    </button>
  );
}

function SelectedClassBar({
  canExport,
  isExporting,
  class_,
  onChangeClass,
  onExportStudents,
}: {
  canExport: boolean;
  isExporting: boolean;
  class_: ClassResponse;
  onChangeClass: () => void;
  onExportStudents: () => void;
}) {
  const group = getClassGroupInfoForRecord(class_);
  const teacherNames = Array.from(
    new Set(
      (class_.teacher_names?.length ? class_.teacher_names : [class_.teacher_name])
        .filter((name): name is string => Boolean(name?.trim()))
        .map((name) => name.trim()),
    ),
  );
  const teacherLabel = teacherNames.length > 0
    ? teacherNames.join(" · ")
    : "Chưa có giáo viên";

  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 select-none flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color.border }} aria-hidden="true" />
          <p className="font-ui min-w-0 text-base font-semibold leading-5 text-gray-950">{class_.name}</p>
          <span className="hidden h-4 w-px bg-gray-200 sm:block" aria-hidden="true" />
          <span className="break-words text-sm font-medium text-gray-600" title={teacherLabel}>
            {teacherLabel}
          </span>
          <span className="hidden h-4 w-px bg-gray-200 sm:block" aria-hidden="true" />
          <span className="whitespace-nowrap text-sm font-medium text-gray-700">
            {formatCurrencyVnd(class_.base_fee)} <span className="text-gray-500">/ {getClassBillingDurationLabel(class_)}</span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <ExcelExportButton disabled={!canExport} isExporting={isExporting} onClick={onExportStudents} />
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-md px-3 text-sm font-medium"
            onClick={onChangeClass}
            aria-label="Quay lại danh sách lớp"
            title="Quay lại danh sách lớp"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Quay lại
          </Button>
        </div>
      </div>
    </div>
  );
}

function StudentListStatus({
  filteredCount,
  totalCount,
}: {
  filteredCount: number;
  totalCount: number;
}) {
  const label = filteredCount === totalCount
    ? `${totalCount} học viên`
    : `${filteredCount}/${totalCount} học viên`;

  return (
    <span
      aria-live="polite"
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-gray-600"
    >
      <span
        className={`h-2 w-2 rounded-full ${totalCount > 0 ? "bg-emerald-500" : "bg-gray-300"}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}

function StudentLoadingStatus({ isRefreshing }: { isRefreshing: boolean }) {
  return <HeaderLoadingStatus isLoading={isRefreshing} />;
}

function HiddenStudentValue() {
  return (
    <span className="inline-flex select-none items-center gap-1 text-[13px] font-medium text-gray-400">
      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
      Đã ẩn
    </span>
  );
}

function SelectableStudentValue({
  inline = false,
  selectable,
  value,
}: {
  inline?: boolean;
  selectable?: boolean;
  value: string | null | undefined;
}) {
  const displayValue = value?.trim() || "—";
  const canSelect = selectable ?? displayValue !== "—";

  return (
    <span
      className={canSelect ? `text-selection-scope${inline ? " text-selection-scope--inline" : ""}` : "select-none font-normal text-gray-400"}
      data-text-selection-scope={canSelect || undefined}
    >
      {canSelect ? (
        <span className="text-selection-value" data-text-selection-value="true">
          {displayValue}
        </span>
      ) : displayValue}
    </span>
  );
}

function StudentCustomFeeLine({
  classId,
  student,
}: {
  classId: string;
  student: StudentResponse;
}) {
  const customFee = getEnrollmentCustomFeeForClass(student, classId);
  if (customFee === null) {
    return null;
  }

  return (
    <div
      className="text-selection-scope text-selection-scope--inline mt-0.5 min-w-0 text-[13px] font-medium leading-4 text-gray-500"
      data-text-selection-scope="true"
    >
      <span className="text-selection-value" data-text-selection-value="true">
        Học phí: {formatCurrencyVnd(customFee)}
      </span>
    </div>
  );
}

function formatContactCell(
  student: StudentResponse,
  field: "student_contact" | "parent_contact",
  zalo: string | null,
  phone: string | null,
) {
  if (isStudentFieldHidden(student, field)) {
    return <HiddenStudentValue />;
  }

  const contact = getCompleteContactPair(zalo, phone);
  if (!contact) {
    return <span className="select-none text-gray-400">—</span>;
  }

  return (
    <div className="min-w-0 space-y-0.5 text-[15px] leading-5 text-gray-700">
      <p className="text-selection-scope break-words" data-text-selection-scope="true">
        <span className="select-none text-gray-500">Zalo:</span>{" "}
        <span className="text-selection-value" data-text-selection-value="true">{contact.zalo}</span>
      </p>
      <p className="text-selection-scope break-all" data-text-selection-scope="true">
        <span className="select-none text-gray-500">SĐT:</span>{" "}
        <span className="text-selection-value" data-text-selection-value="true">{contact.phone}</span>
      </p>
    </div>
  );
}

function formatContactText(zalo: string | null, phone: string | null) {
  const contact = getCompleteContactPair(zalo, phone);
  return contact ? `${contact.zalo} | ${contact.phone}` : "—";
}

function getStudentCardSummary(student: StudentResponse) {
  const values = [
    isStudentFieldHidden(student, "birth_date") ? null : formatDate(student.birth_date),
    isStudentFieldHidden(student, "school") ? null : student.school,
  ].filter((value) => value && value !== "—");

  if (values.length > 0) {
    return { selectable: true, value: values.join(" - ") };
  }

  return {
    selectable: false,
    value:
      isStudentFieldHidden(student, "birth_date") || isStudentFieldHidden(student, "school")
        ? "Thông tin đã ẩn"
        : "Chưa có thông tin",
  };
}

function BirthDateInput({
  value,
  onChange,
  onBlur,
  error,
  dataRow,
  dataCol = 0,
  privacyToggle,
  isContentHidden = false,
}: {
  value: string | null;
  onChange: (val: string | null) => void;
  onBlur?: () => void;
  error?: string;
  dataRow?: number;
  dataCol?: number;
  privacyToggle?: React.ReactNode;
  isContentHidden?: boolean;
}) {
  return (
    <div>
      <FormField controlId="student-birth-date" label="Ngày sinh" error={error} errorId="student-birth-date-error">
        <ManualDateInput
          id="student-birth-date"
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          error={Boolean(error)}
          ariaDescribedBy={error ? "student-birth-date-error" : undefined}
          dataRow={dataRow}
          dataCol={dataCol}
          privacyToggle={privacyToggle}
          isContentHidden={isContentHidden}
        />
      </FormField>
    </div>
  );
}

function ContactFields({
  phoneKey,
  zaloPlaceholder,
  phonePlaceholder,
  label,
  zaloField,
  phoneField,
  error,
  onBlur,
  dataRow,
  privacyToggle,
  isContentHidden = false,
  suggestion,
  onAcceptSuggestion,
}: {
  phoneKey: "student_phone" | "parent_phone";
  zaloPlaceholder: string;
  phonePlaceholder?: string;
  label: string;
  zaloField: UseFormRegisterReturn;
  phoneField: UseFormRegisterReturn;
  error?: string;
  onBlur?: () => void;
  dataRow?: number;
  privacyToggle?: React.ReactNode;
  isContentHidden?: boolean;
  suggestion?: ContactPairSuggestion | null;
  onAcceptSuggestion?: () => void;
}) {
  const errorId = `${phoneKey}-contact-error`;
  const suggestionId = `${phoneKey}-contact-suggestion`;
  const describedBy = [error ? errorId : null, suggestion ? suggestionId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div className="sm:col-span-2">
      <div className="block space-y-1">
        <span className="form-label-text block select-none text-[15px] text-gray-700">{label}</span>
        <SplitTextField
          role="group"
          aria-describedby={describedBy}
          onKeyDown={(event) =>
            handleContactSuggestionTab(
              event,
              suggestion,
              () => onAcceptSuggestion?.(),
            )
          }
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.();
          }}
          className={`relative h-8 rounded-md border bg-white transition-shadow focus-within:ring-1 ${error ? "border-destructive focus-within:!border-destructive focus-within:!ring-destructive/15" : "border-gray-200 focus-within:border-primary/60 focus-within:ring-primary/15"}`}
          left={
            <input
              {...zaloField}
              aria-label={zaloPlaceholder}
              placeholder={suggestion?.target === "zalo" ? suggestion.value : zaloPlaceholder}
              autoComplete={savedInfoAutocomplete.disabled}
              maxLength={100}
              data-row={dataRow}
              data-col={0}
              data-private-hidden={isContentHidden}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              aria-autocomplete={suggestion?.target === "zalo" ? "inline" : undefined}
              aria-keyshortcuts={suggestion ? "Tab" : undefined}
              data-contact-part="zalo"
              className="form-input-text h-full w-full min-w-0 bg-transparent px-3 py-0 text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400"
            />
          }
          right={
            <input
              {...phoneField}
              aria-label={`Số điện thoại ${zaloPlaceholder.replace("Zalo ", "")}`}
              placeholder={
                suggestion?.target === "phone"
                  ? suggestion.value
                  : phonePlaceholder ?? `SĐT ${zaloPlaceholder.replace("Zalo ", "")} (nếu có)`
              }
              autoComplete={savedInfoAutocomplete.disabled}
              inputMode="tel"
              maxLength={32}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              aria-autocomplete={suggestion?.target === "phone" ? "inline" : undefined}
              aria-keyshortcuts={suggestion ? "Tab" : undefined}
              data-contact-part="phone"
              data-row={dataRow}
              data-col={1}
              data-private-hidden={isContentHidden}
              className={`form-input-text h-full w-full min-w-0 bg-transparent px-3 py-0 text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400 ${privacyToggle ? "pr-10" : ""}`}
            />
          }
          endAdornment={
            privacyToggle ? (
              <div className="absolute inset-y-0 right-1 flex items-center">{privacyToggle}</div>
            ) : null
          }
        />
        {error && (
          <span id={errorId} role="alert" className="helper-text block text-destructive">{error}</span>
        )}
        {suggestion ? (
          <span id={suggestionId} className="sr-only" aria-live="polite">
            Gợi ý {suggestion.value}. Nhấn Tab để điền nhanh.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StudentContactFields({
  zaloField,
  phoneField,
  error,
  onBlur,
  privacyToggle,
  isContentHidden,
  suggestion,
  onAcceptSuggestion,
}: {
  zaloField: UseFormRegisterReturn;
  phoneField: UseFormRegisterReturn;
  error?: string;
  onBlur?: () => void;
  privacyToggle?: React.ReactNode;
  isContentHidden?: boolean;
  suggestion?: ContactPairSuggestion | null;
  onAcceptSuggestion?: () => void;
}) {
  return (
    <ContactFields
      phoneKey="student_phone"
      zaloPlaceholder="Zalo học sinh"
      label="Zalo học viên"
      zaloField={zaloField}
      phoneField={phoneField}
      error={error}
      onBlur={onBlur}
      dataRow={3}
      privacyToggle={privacyToggle}
      isContentHidden={isContentHidden}
      suggestion={suggestion}
      onAcceptSuggestion={onAcceptSuggestion}
    />
  );
}

function ParentContactFields({
  zaloField,
  phoneField,
  error,
  onBlur,
  privacyToggle,
  isContentHidden,
  suggestion,
  onAcceptSuggestion,
}: {
  zaloField: UseFormRegisterReturn;
  phoneField: UseFormRegisterReturn;
  error?: string;
  onBlur?: () => void;
  privacyToggle?: React.ReactNode;
  isContentHidden?: boolean;
  suggestion?: ContactPairSuggestion | null;
  onAcceptSuggestion?: () => void;
}) {
  return (
    <ContactFields
      phoneKey="parent_phone"
      zaloPlaceholder="Zalo phụ huynh"
      phonePlaceholder="SĐT phụ huynh"
      label="Zalo phụ huynh"
      zaloField={zaloField}
      phoneField={phoneField}
      error={error}
      onBlur={onBlur}
      dataRow={4}
      privacyToggle={privacyToggle}
      isContentHidden={isContentHidden}
      suggestion={suggestion}
      onAcceptSuggestion={onAcceptSuggestion}
    />
  );
}

function StudentsTable({
  currentClassId,
  isAdmin,
  onRowClick,
  students,
}: {
  currentClassId: string;
  isAdmin: boolean;
  onRowClick: (student: StudentResponse) => void;
  students: StudentResponse[];
}) {
  const selectionContainerRef = useRef<HTMLDivElement>(null);
  useScopedTextSelection(selectionContainerRef);
  const tableGridClass = isAdmin
    ? STUDENTS_TABLE_GRID_CLASS
    : STUDENTS_TABLE_VIEWER_GRID_CLASS;

  return (
    <div ref={selectionContainerRef} className="text-selection-container scrollbar-hidden overflow-x-hidden md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-contain xl:overflow-hidden">
      <div className="grid gap-3 xl:hidden">
        {students.map((student) => (
          <StudentCard key={student.id} currentClassId={currentClassId} isAdmin={isAdmin} student={student} onRowClick={onRowClick} />
        ))}
      </div>

      <div
        role="table"
        aria-label="Danh sách học viên trong lớp"
        className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white xl:h-full xl:min-h-0 xl:flex xl:flex-col"
      >
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-100">
          <div role="row" className={`${tableGridClass} table-heading-text text-left text-gray-800`}>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Mã HV</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Họ tên</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Ngày sinh</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Trường</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Ngày bắt đầu</div>
            <div role="columnheader" className="whitespace-nowrap py-3 pl-4 pr-2.5">Thông tin học viên</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Thông tin phụ huynh</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Ghi chú</div>
          </div>
        </div>

        <div role="rowgroup" className="scrollbar-hidden min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain bg-white">
          <div role="presentation" className="divide-y divide-gray-200 text-[15px] font-medium leading-5">
            {students.map((student) => (
              <StudentTableRow key={student.id} currentClassId={currentClassId} isAdmin={isAdmin} student={student} onRowClick={onRowClick} tableGridClass={tableGridClass} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StudentCard({
  currentClassId,
  isAdmin,
  onRowClick,
  student,
}: {
  currentClassId: string;
  isAdmin: boolean;
  onRowClick: (student: StudentResponse) => void;
  student: StudentResponse;
}) {
  const clickableProps = useClickableRowProps(isAdmin ? () => onRowClick(student) : undefined);
  return (
    <article
      {...clickableProps}
      tabIndex={isAdmin ? 0 : undefined}
      onKeyDown={(event) => {
        if (isAdmin && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onRowClick(student);
        }
      }}
      className={`rounded-md border border-gray-200 bg-white p-4 ${isAdmin ? "cursor-pointer transition hover:bg-gray-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold text-gray-900">
            <SelectableStudentValue value={student.full_name} />
          </h2>
          {student.student_code ? (
            <p className="mt-0.5 text-[13px] font-medium tabular-nums text-gray-500">
              Mã: <SelectableStudentValue value={formatStudentCode(student.student_code)} />
            </p>
          ) : null}
          <StudentCustomFeeLine classId={currentClassId} student={student} />
          <p className="mt-1 break-words text-[15px] font-medium text-gray-600">
            <SelectableStudentValue {...getStudentCardSummary(student)} />
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-[15px] font-medium">
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase text-gray-500">Ngày bắt đầu</dt>
          <dd className="mt-1 text-gray-800">
            <StudentEnrollmentDate currentClassId={currentClassId} student={student} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase text-gray-500">Thông tin học viên</dt>
          <dd className="mt-1 break-words text-gray-800">
            {isStudentFieldHidden(student, "student_contact")
              ? <HiddenStudentValue />
              : <SelectableStudentValue value={formatContactText(student.student_zalo, student.student_phone)} />}
          </dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-xs font-medium uppercase text-gray-500">Thông tin phụ huynh</dt>
          <dd className="mt-1 min-w-0 text-gray-800">
            {isStudentFieldHidden(student, "parent_contact")
              ? <HiddenStudentValue />
              : <span className="block break-words"><SelectableStudentValue value={formatContactText(student.parent_zalo, student.parent_phone)} /></span>}
          </dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-xs font-medium uppercase text-gray-500">Ghi chú</dt>
          <dd className="mt-1 break-words text-gray-800">
            {isStudentFieldHidden(student, "notes")
              ? <HiddenStudentValue />
              : <SelectableStudentValue value={student.notes} />}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function StudentTableRow({
  currentClassId,
  isAdmin,
  onRowClick,
  student,
  tableGridClass,
}: {
  currentClassId: string;
  isAdmin: boolean;
  onRowClick: (student: StudentResponse) => void;
  student: StudentResponse;
  tableGridClass: string;
}) {
  const clickableProps = useClickableRowProps(isAdmin ? () => onRowClick(student) : undefined);
  return (
    <div
      role="row"
      {...clickableProps}
      tabIndex={isAdmin ? 0 : undefined}
      onKeyDown={(event) => {
        if (isAdmin && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onRowClick(student);
        }
      }}
      className={`${tableGridClass} cv-auto items-start ${isAdmin ? "cursor-pointer hover:bg-gray-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30" : ""}`}
    >
      <div role="cell" className="min-w-0 whitespace-nowrap px-2.5 py-3 font-semibold tabular-nums text-primary">
        <SelectableStudentValue value={formatStudentCode(student.student_code)} />
      </div>
      <div role="cell" className="min-w-0 break-words px-2.5 py-3 font-medium text-gray-900">
        <SelectableStudentValue value={student.full_name} />
        <StudentCustomFeeLine classId={currentClassId} student={student} />
      </div>
      <div role="cell" className="min-w-0 whitespace-nowrap px-2.5 py-3 text-gray-700">
        {isStudentFieldHidden(student, "birth_date")
          ? <HiddenStudentValue />
          : <SelectableStudentValue value={formatDate(student.birth_date)} />}
      </div>
      <div role="cell" className="min-w-0 break-words px-2.5 py-3 text-gray-700">
        {isStudentFieldHidden(student, "school") ? <HiddenStudentValue /> : <SelectableStudentValue value={student.school} />}
      </div>
      <div role="cell" className="min-w-0 whitespace-nowrap px-2.5 py-3 text-gray-700">
        <StudentEnrollmentDate currentClassId={currentClassId} student={student} />
      </div>
      <div role="cell" className="min-w-0 py-3 pl-4 pr-2.5">{formatContactCell(student, "student_contact", student.student_zalo, student.student_phone)}</div>
      <div role="cell" className="min-w-0 px-2.5 py-3">{formatContactCell(student, "parent_contact", student.parent_zalo, student.parent_phone)}</div>
      <div role="cell" className="min-w-0 break-words px-2.5 py-3 text-gray-700">
        {isStudentFieldHidden(student, "notes") ? <HiddenStudentValue /> : <SelectableStudentValue value={student.notes} />}
      </div>
    </div>
  );
}

function StudentEnrollmentDate({
  currentClassId,
  student,
}: {
  currentClassId: string;
  student: StudentResponse;
}) {
  const enrollmentDate = getEnrollmentDateForClass(student, currentClassId);
  const isUpcoming = Boolean(enrollmentDate && enrollmentDate > getTodayInputValue());

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <SelectableStudentValue value={formatDate(enrollmentDate)} />
      {isUpcoming ? (
        <StatusPill className="text-xs font-semibold" title="Ngày bắt đầu trong tương lai">
          Sắp học
        </StatusPill>
      ) : null}
    </div>
  );
}

function StudentFormDialog({
  classes,
  contactSuggestionSources,
  currentClassId,
  embedded = false,
  isSaving,
  onClose,
  onDirtyChange,
  onNestedOverlayChange,
  onSubmit,
  student,
}: {
  classes: ClassResponse[];
  contactSuggestionSources: ContactSuggestionSource[];
  currentClassId: string | null;
  embedded?: boolean;
  isSaving: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onNestedOverlayChange?: (open: boolean) => void;
  onSubmit: (
    values: StudentFormValues,
    enrollmentFees: EnrollmentFeeValues,
    enrollmentActionPlan: EnrollmentActionPlan,
    selectedSlotIds: string[],
  ) => void;
  student: StudentResponse | null;
}) {
  const notify = useToast();
  const [mounted, setMounted] = useState(false);
  const [enrollmentFees, setEnrollmentFees] = useState<EnrollmentFeeValues>({});
  const [blurredEnrollmentDateIds, setBlurredEnrollmentDateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [enrollmentFeeDraftError, setEnrollmentFeeDraftError] = useState("");
  const [enrollmentActionMode, setEnrollmentActionMode] =
    useState<EnrollmentActionMode>("supplement");
  const [transferTargetClassIds, setTransferTargetClassIds] = useState<string[]>([]);
  const [draftEnrollmentActionMode, setDraftEnrollmentActionMode] =
    useState<EnrollmentActionMode>("supplement");
  const [draftTransferTargetClassIds, setDraftTransferTargetClassIds] = useState<string[]>([]);
  const [targetEnrollmentConfigs, setTargetEnrollmentConfigs] = useState<Record<string, EnrollmentTargetConfig>>({});
  const [draftTargetEnrollmentConfigs, setDraftTargetEnrollmentConfigs] = useState<Record<string, EnrollmentTargetConfig>>({});
  const [actionPlanPreviewMeta, setActionPlanPreviewMeta] = useState<ActionPlanPreviewMeta | null>(null);
  const [transferError, setTransferError] = useState("");
  const [isEnrollmentTransferOpen, setIsEnrollmentTransferOpen] = useState(false);
  const [pendingDateReview, setPendingDateReview] = useState<{
    preview: StudentMembershipPreviewResponse;
    pendingValues?: StudentFormValues;
    pendingEnrollmentFees?: EnrollmentFeeValues;
    pendingSlotIds?: string[];
    enrollmentDateDecisions: Record<string, string>;
    isFromRowButton?: boolean;
  } | null>(null);
  const [chosenDateDecisions, setChosenDateDecisions] = useState<Record<string, { decisionCode: string; reason: string }>>({});
  const [dateReviewImpacts, setDateReviewImpacts] = useState<Record<string, {
    isLoading: boolean;
    hasProtectedFees: boolean;
    impact?: AffectedEnrollmentImpact;
    preview?: StudentMembershipPreviewResponse;
  }>>({});
  const lastCheckedDateMapRef = useRef<Record<string, string | null>>({});
  const [isDateReviewLoading, setIsDateReviewLoading] = useState(false);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const initialSelectedSlotIdsRef = useRef<string[]>([]);
  const currentClass = useMemo(
    () => classes.find((class_) => class_.id === currentClassId) ?? null,
    [classes, currentClassId],
  );
  const isStandaloneProfileCreate = student === null && currentClassId === null;
  const initialCreateFormKeyRef = useRef(normalizedStudentCreateFormKey(defaultStudentValues));
  const initialCreateValuesRef = useRef<StudentFormValues>(defaultStudentValues);

  useEffect(() => {
    setMounted(true);
  }, []);

  // R6-D09: mặc định chọn toàn bộ buổi của lớp khi mở form tạo (bắt user review).
  useEffect(() => {
    if (student) {
      initialSelectedSlotIdsRef.current = [];
      setSelectedSlotIds([]);
      return;
    }
    const defaultSlotIds =
      currentClass?.schedule?.slots
        ?.filter((slot) => slot.id)
        .map((slot) => slot.id as string) ?? [];
    initialSelectedSlotIdsRef.current = defaultSlotIds;
    setSelectedSlotIds(defaultSlotIds);
  }, [currentClass, student]);

  const {
    clearErrors,
    formState: { errors, isSubmitted },
    handleSubmit,
    register,
    reset,
    setError,
    setValue,
    getValues,
    watch,
  } = useForm<StudentFormValues>({
    resolver: zodResolver(student ? studentSchema : currentClass ? studentCreateSchema : studentProfileCreateSchema),
    mode: "onChange",
    shouldFocusError: true,
    defaultValues: defaultStudentValues,
  });
  const {
    markBlur,
    markInput,
    markSubmitted,
    resetFeedback,
    shouldShowError,
  } = useFormFieldFeedback(STUDENT_FEEDBACK_FIELDS);

  useEffect(() => {
    const nextValues: StudentFormValues = student
      ? {
          full_name: student.full_name,
          birth_date: student.birth_date,
          school: student.school ?? "",
          student_zalo: student.student_zalo ?? "",
          student_phone: student.student_phone ?? "",
          parent_phone: student.parent_phone ?? "",
          parent_zalo: student.parent_zalo ?? "",
          notes: student.notes ?? "",
          hidden_fields: normalizeStudentHiddenFields(student.hidden_fields),
          custom_fee: null,
          enrollment_date: getDefaultEnrollmentDate(currentClass),
        }
      : { ...defaultStudentValues, enrollment_date: getDefaultEnrollmentDate(currentClass) };

    if (!student) {
      initialCreateFormKeyRef.current = normalizedStudentCreateFormKey(nextValues);
      initialCreateValuesRef.current = nextValues;
    }

    reset(nextValues);
    setBlurredEnrollmentDateIds(new Set());
    setEnrollmentFeeDraftError("");
    resetFeedback();
  }, [currentClass, reset, resetFeedback, student]);

  useEffect(() => {
    if (!student) {
      setEnrollmentFees({});
      setEnrollmentActionMode("supplement");
      setTransferTargetClassIds([]);
      setDraftEnrollmentActionMode("supplement");
      setDraftTransferTargetClassIds([]);
      setTargetEnrollmentConfigs({});
      setDraftTargetEnrollmentConfigs({});
      setTransferError("");
      setIsEnrollmentTransferOpen(false);
      return;
    }

    setEnrollmentFees(
      Object.fromEntries(
        student.active_enrollments.map((enrollment) => {
          const enrollmentClass = classes.find((c) => c.id === enrollment.class_id);
          const classSlotIds =
            enrollmentClass?.schedule?.slots?.flatMap((slot) => (slot.id ? [slot.id] : [])) ?? [];
          return [
            enrollment.id,
            {
              custom_fee: enrollment.custom_fee,
              enrollment_date: enrollment.enrollment_date,
              selected_slot_ids: enrollment.selected_slot_ids?.length
                ? enrollment.selected_slot_ids
                : classSlotIds,
            },
          ];
        }),
      ),
    );
    setEnrollmentActionMode("supplement");
    setTransferTargetClassIds([]);
    setDraftEnrollmentActionMode("supplement");
    setDraftTransferTargetClassIds([]);
    setTargetEnrollmentConfigs({});
    setDraftTargetEnrollmentConfigs({});
    setTransferError("");
    setIsEnrollmentTransferOpen(false);
    lastCheckedDateMapRef.current = {};
    setDateReviewImpacts({});
    setChosenDateDecisions({});
  }, [classes, student]);

  const activeEnrollments = useMemo(() => student?.active_enrollments ?? [], [student?.active_enrollments]);
  const isUnassignedStudent = Boolean(student && activeEnrollments.length === 0);
  const useFullWidthProfileName = isStandaloneProfileCreate || isUnassignedStudent;
  const primaryEnrollment =
    activeEnrollments.find((enrollment) => enrollment.class_id === currentClassId) ??
    activeEnrollments[0] ??
    null;
  const activeEnrollmentClassIds = new Set(activeEnrollments.map((enrollment) => enrollment.class_id));
  const availableTransferClasses = classes.filter((class_) => {
    if (!student || !class_.is_active) {
      return false;
    }
    if (class_.id === currentClassId) {
      return false;
    }
    return !activeEnrollmentClassIds.has(class_.id);
  });
  const selectedTransferClasses = transferTargetClassIds
    .map((classId) => availableTransferClasses.find((class_) => class_.id === classId) ?? null)
    .filter((class_): class_ is ClassResponse => class_ !== null);
  const draftSelectedTransferClasses = draftTransferTargetClassIds
    .map((classId) => availableTransferClasses.find((class_) => class_.id === classId) ?? null)
    .filter((class_): class_ is ClassResponse => class_ !== null);
  const hasMissingSessionSelection = student
    ? activeEnrollments.some((enrollment) => {
        const enrollmentClass = classes.find((class_) => class_.id === enrollment.class_id);
        const slotCount = enrollmentClass?.schedule?.slots?.filter((slot) => slot.id).length ?? 0;
        const selected = enrollmentFees[enrollment.id]?.selected_slot_ids ?? enrollment.selected_slot_ids;
        return slotCount > 0 && selected.length === 0;
      })
    : Boolean(
        currentClass &&
          (currentClass.schedule?.slots?.filter((slot) => slot.id).length ?? 0) > 0 &&
          selectedSlotIds.length === 0,
      );
  const sessionSelectionError = hasMissingSessionSelection
    ? "Vui lòng chọn ít nhất một buổi học trước khi lưu."
    : "";
  const hasEnrollmentFeeChanges = activeEnrollments.some((enrollment) => {
    const draft = enrollmentFees[enrollment.id];
    return Boolean(
      draft &&
      ((draft.custom_fee ?? null) !== (enrollment.custom_fee ?? null) ||
        comparableManualDate(draft.enrollment_date, enrollment.enrollment_date) !==
          (enrollment.enrollment_date ?? null) ||
        [...draft.selected_slot_ids].sort().join("|") !== [...enrollment.selected_slot_ids].sort().join("|")),
    );
  });
  const invalidEnrollmentDateDraftIds = new Set(
    activeEnrollments.flatMap((enrollment) => {
      const value = enrollmentFees[enrollment.id]?.enrollment_date;
      if (value === undefined) return [];
      if (value === null && enrollment.enrollment_date === null) return [];
      return (!value || !isValidIsoDate(value)) ? [enrollment.id] : [];
    }),
  );
  const invalidEnrollmentDateIds = new Set(
    [...invalidEnrollmentDateDraftIds].filter(
      (enrollmentId) => isSubmitted || blurredEnrollmentDateIds.has(enrollmentId),
    ),
  );

  const checkDateImpact = useCallback(async (enrollmentId: string, inputDate: string | null) => {
    if (!student) return;
    const orig = activeEnrollments.find((e) => e.id === enrollmentId);
    if (!orig) return;

    const isChanged = comparableManualDate(inputDate, orig.enrollment_date) !== (orig.enrollment_date ?? null);
    if (!isChanged) {
      delete lastCheckedDateMapRef.current[enrollmentId];
      setDateReviewImpacts((prev) => {
        if (!prev[enrollmentId]) return prev;
        const next = { ...prev };
        delete next[enrollmentId];
        return next;
      });
      setChosenDateDecisions((prev) => {
        if (!prev[enrollmentId]) return prev;
        const next = { ...prev };
        delete next[enrollmentId];
        return next;
      });
      return;
    }

    if (!inputDate || !isValidIsoDate(inputDate)) {
      return;
    }

    // Already checked for this exact date - prevent re-checking on blur or click outside
    if (lastCheckedDateMapRef.current[enrollmentId] === inputDate) {
      return;
    }

    setDateReviewImpacts((prev) => ({
      ...prev,
      [enrollmentId]: { ...prev[enrollmentId], isLoading: true, hasProtectedFees: false },
    }));

    try {
      const datePreview = await previewStudentMembership(student.id, {
        expected_updated_at: student.updated_at,
        mode: enrollmentActionMode,
        source_enrollment_id: null,
        targets: [],
        enrollment_updates: [{
          enrollment_id: enrollmentId,
          enrollment_date: inputDate,
          custom_fee: enrollmentFees[enrollmentId]?.custom_fee ?? null,
          selected_slot_ids: enrollmentFees[enrollmentId]?.selected_slot_ids ?? null,
        }],
      });
      const update = datePreview.enrollment_updates.find((u) => u.enrollment_id === enrollmentId);
      const hasProtected = Boolean(update && update.protected_fee_count > 0);

      lastCheckedDateMapRef.current[enrollmentId] = inputDate;

      setDateReviewImpacts((prev) => ({
        ...prev,
        [enrollmentId]: {
          isLoading: false,
          hasProtectedFees: hasProtected,
          impact: update,
          preview: datePreview,
        },
      }));

      if (!hasProtected) {
        setChosenDateDecisions((prev) => ({
          ...prev,
          [enrollmentId]: {
            decisionCode: "REANCHOR_CURRENT_CYCLE",
            reason: "Tự động cập nhật theo ngày bắt đầu mới",
          },
        }));
      }
    } catch {
      setDateReviewImpacts((prev) => ({
        ...prev,
        [enrollmentId]: { isLoading: false, hasProtectedFees: false },
      }));
    }
  }, [student, activeEnrollments, enrollmentActionMode, enrollmentFees]);

  const openDateReviewForEnrollment = useCallback(async (enrollmentId: string, fromRow = true) => {
    if (!student) return;
    const impactData = dateReviewImpacts[enrollmentId];
    if (impactData?.preview) {
      setPendingDateReview({
        preview: impactData.preview,
        pendingValues: getValues(),
        pendingEnrollmentFees: enrollmentFees,
        pendingSlotIds: selectedSlotIds,
        enrollmentDateDecisions: {
          [enrollmentId]: chosenDateDecisions[enrollmentId]?.decisionCode || impactData.impact?.recommended_decision || "KEEP_CURRENT_THEN_REANCHOR",
        },
        isFromRowButton: fromRow,
      });
      return;
    }

    setIsDateReviewLoading(true);
    try {
      const datePreview = await previewStudentMembership(student.id, {
        expected_updated_at: student.updated_at,
        mode: enrollmentActionMode,
        source_enrollment_id: null,
        targets: [],
        enrollment_updates: [{
          enrollment_id: enrollmentId,
          enrollment_date: enrollmentFees[enrollmentId]?.enrollment_date ?? null,
          custom_fee: enrollmentFees[enrollmentId]?.custom_fee ?? null,
          selected_slot_ids: enrollmentFees[enrollmentId]?.selected_slot_ids ?? null,
        }],
      });
      const update = datePreview.enrollment_updates.find((u) => u.enrollment_id === enrollmentId);
      setPendingDateReview({
        preview: datePreview,
        pendingValues: getValues(),
        pendingEnrollmentFees: enrollmentFees,
        pendingSlotIds: selectedSlotIds,
        enrollmentDateDecisions: {
          [enrollmentId]: chosenDateDecisions[enrollmentId]?.decisionCode || update?.recommended_decision || "KEEP_CURRENT_THEN_REANCHOR",
        },
        isFromRowButton: fromRow,
      });
    } catch (err) {
      const parsed = parseMembershipError(err);
      notify.error(parsed.message || "Không thể kiểm tra tác động thay đổi ngày bắt đầu.");
    } finally {
      setIsDateReviewLoading(false);
    }
  }, [student, dateReviewImpacts, chosenDateDecisions, enrollmentActionMode, enrollmentFees, getValues, selectedSlotIds, notify]);
  const watchedStudentValues = watch();
  const comparableWatchedStudentValues = student
    ? {
        ...watchedStudentValues,
        birth_date: comparableManualDate(
          watchedStudentValues.birth_date,
          student.birth_date,
        ),
      }
    : {
        ...watchedStudentValues,
        birth_date: comparableManualDate(
          watchedStudentValues.birth_date,
          initialCreateValuesRef.current.birth_date,
        ),
        enrollment_date:
          comparableManualDate(
            watchedStudentValues.enrollment_date,
            initialCreateValuesRef.current.enrollment_date,
          ) ?? undefined,
      };
  const hasUnsavedChanges = student
    ? normalizedStudentFormKey(comparableWatchedStudentValues) !==
        normalizedStudentFormKey({
          full_name: student.full_name,
          birth_date: student.birth_date,
          school: student.school ?? "",
          student_zalo: student.student_zalo ?? "",
          student_phone: student.student_phone ?? "",
          parent_phone: student.parent_phone ?? "",
          parent_zalo: student.parent_zalo ?? "",
          notes: student.notes ?? "",
          hidden_fields: normalizeStudentHiddenFields(student.hidden_fields),
          custom_fee: null,
          enrollment_date: getTodayInputValue(),
        }) ||
        hasEnrollmentFeeChanges ||
        transferTargetClassIds.length > 0
    : normalizedStudentCreateFormKey(comparableWatchedStudentValues) !== initialCreateFormKeyRef.current ||
      (currentClass !== null &&
        normalizedSlotIdsKey(selectedSlotIds) !==
          normalizedSlotIdsKey(initialSelectedSlotIdsRef.current));
  const hasStudentFormErrors =
    !studentSchema.safeParse(watchedStudentValues).success ||
    Object.keys(errors).length > 0 ||
    Boolean(enrollmentFeeDraftError) ||
    invalidEnrollmentDateDraftIds.size > 0;
  const studentPhoneValue = watch("student_phone");
  const studentZaloValue = watch("student_zalo");
  const parentPhoneValue = watch("parent_phone");
  const parentZaloValue = watch("parent_zalo");
  const hiddenFields = watch("hidden_fields");
  const studentContactSuggestion = useContactPairSuggestion({
    enabled: !hiddenFields.includes("student_contact"),
    localSources: contactSuggestionSources,
    owner: "student",
    phoneValue: studentPhoneValue,
    zaloValue: studentZaloValue,
  });
  const parentContactSuggestion = useContactPairSuggestion({
    enabled: !hiddenFields.includes("parent_contact"),
    localSources: contactSuggestionSources,
    owner: "parent",
    phoneValue: parentPhoneValue,
    zaloValue: parentZaloValue,
  });
  const fullNameError = shouldShowError("full_name", isSubmitted)
    ? errors.full_name?.message
    : undefined;
  const birthDateError = shouldShowError("birth_date", isSubmitted)
    ? errors.birth_date?.message
    : undefined;
  const schoolError = shouldShowError("school", isSubmitted)
    ? errors.school?.message
    : undefined;
  const customFeeError = shouldShowError("custom_fee", isSubmitted)
    ? errors.custom_fee?.message
    : undefined;
  const visibleEnrollmentFeeDraftError = shouldShowError("custom_fee", isSubmitted)
    ? enrollmentFeeDraftError
    : undefined;
  const studentContactError = shouldShowError("student_contact", isSubmitted)
    ? (errors.student_phone ?? errors.student_zalo)?.message
    : undefined;
  const parentContactError = shouldShowError("parent_contact", isSubmitted)
    ? (errors.parent_zalo ?? errors.parent_phone)?.message
    : undefined;
  const notesError = shouldShowError("notes", isSubmitted)
    ? errors.notes?.message
    : undefined;
  const enrollmentDateError = shouldShowError("enrollment_date", isSubmitted)
    ? errors.enrollment_date?.message
    : undefined;
  const hasVisibleStudentFormErrors = Boolean(
    fullNameError ||
      birthDateError ||
      schoolError ||
      customFeeError ||
      visibleEnrollmentFeeDraftError ||
      studentContactError ||
      parentContactError ||
      notesError ||
      enrollmentDateError ||
      invalidEnrollmentDateIds.size > 0 ||
      transferError ||
      sessionSelectionError,
  );
  const unsavedNoticeHasErrors = student
    ? hasStudentFormErrors
    : hasVisibleStudentFormErrors;
  const shouldShowUnsavedNotice = shouldShowUnsavedChanges({
    hasChanges: hasUnsavedChanges,
    hasErrors: unsavedNoticeHasErrors,
    isSaving,
  });
  const fullNameField = register("full_name", {
    onChange: (event) => markInput("full_name", event.target.value),
    onBlur: () => markBlur("full_name"),
  });
  const schoolField = register("school", {
    onChange: (event) => markInput("school", event.target.value),
    onBlur: () => markBlur("school"),
  });
  const studentZaloField = register("student_zalo", {
    onChange: (event) =>
      markInput(
        "student_contact",
        [event.target.value, getValues("student_phone")].filter(Boolean),
      ),
  });
  const studentPhoneField = register("student_phone", {
    onChange: (event) =>
      markInput(
        "student_contact",
        [getValues("student_zalo"), event.target.value].filter(Boolean),
      ),
  });
  const parentZaloField = register("parent_zalo", {
    onChange: (event) =>
      markInput(
        "parent_contact",
        [event.target.value, getValues("parent_phone")].filter(Boolean),
      ),
  });
  const parentPhoneField = register("parent_phone", {
    onChange: (event) =>
      markInput(
        "parent_contact",
        [getValues("parent_zalo"), event.target.value].filter(Boolean),
      ),
  });
  const notesField = register("notes", {
    onChange: (event) => markInput("notes", event.target.value),
    onBlur: () => markBlur("notes"),
  });
  function toggleHiddenField(field: StudentHiddenField) {
    if (!STUDENT_PRIVACY_FIELDS.has(field)) {
      return;
    }
    const nextHiddenFields = hiddenFields.includes(field)
      ? hiddenFields.filter((item) => item !== field)
      : [...hiddenFields, field];
    setValue("hidden_fields", nextHiddenFields, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function renderPrivacyToggle(field: StudentHiddenField, label: string) {
    if (!student) {
      return null;
    }
    return (
      <PrivacyToggleButton
        field={field}
        isHidden={hiddenFields.includes(field)}
        label={label}
        onToggle={toggleHiddenField}
      />
    );
  }

  function acceptContactSuggestion(
    owner: Exclude<ContactSuggestionOwner, "staff">,
    suggestion: ContactPairSuggestion | null,
  ) {
    if (!suggestion) {
      return;
    }

    const zaloField = owner === "student" ? "student_zalo" : "parent_zalo";
    const phoneField = owner === "student" ? "student_phone" : "parent_phone";
    const feedbackField = owner === "student" ? "student_contact" : "parent_contact";
    setValue(suggestion.target === "zalo" ? zaloField : phoneField, suggestion.value, {
      shouldDirty: true,
      shouldValidate: true,
    });
    markInput(feedbackField, [
      suggestion.target === "zalo" ? suggestion.value : getValues(zaloField),
      suggestion.target === "phone" ? suggestion.value : getValues(phoneField),
    ].filter(Boolean));
  }

  function smartRequestClose() {
    if (isEnrollmentTransferOpen) {
      closeEnrollmentTransfer();
      return;
    }
    if (!isSaving) {
      onClose();
    }
  }

  function openEnrollmentTransfer() {
    setDraftEnrollmentActionMode(enrollmentActionMode);
    setDraftTransferTargetClassIds([...transferTargetClassIds]);
    setDraftTargetEnrollmentConfigs(structuredClone(targetEnrollmentConfigs));
    setTransferError("");
    setIsEnrollmentTransferOpen(true);
  }

  function closeEnrollmentTransfer() {
    setTransferError("");
    setIsEnrollmentTransferOpen(false);
  }

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    onNestedOverlayChange?.(isEnrollmentTransferOpen || Boolean(pendingDateReview));
  }, [isEnrollmentTransferOpen, onNestedOverlayChange, pendingDateReview]);

  if (!mounted) return null;

  const overlayExtra = (
    <>
      {student && pendingDateReview ? (
        <StudentStartDateDialog
          student={student}
          affectedEnrollments={pendingDateReview.preview.enrollment_updates}
          isApplying={isSaving}
          onConfirm={(selectedDecisions, changeReason) => {
            const currentPending = pendingDateReview;
            setChosenDateDecisions((prev) => {
              const next = { ...prev };
              for (const [eid, code] of Object.entries(selectedDecisions)) {
                next[eid] = { decisionCode: code, reason: changeReason };
              }
              return next;
            });
            if (currentPending.preview) {
              setActionPlanPreviewMeta({
                previewFingerprint: currentPending.preview.preview_fingerprint,
                previewExpiresAt: currentPending.preview.expires_at,
                previewDraftKey: "enrollment-date-review",
                previewResponse: currentPending.preview,
              });
            }
            setPendingDateReview(null);
            if (
              !currentPending.isFromRowButton &&
              currentPending.pendingValues &&
              currentPending.pendingEnrollmentFees &&
              currentPending.pendingSlotIds
            ) {
              const enrollmentActionPlan: EnrollmentActionPlan = {
                mode: enrollmentActionMode,
                targetClassIds: transferTargetClassIds,
                targetConfigs: targetEnrollmentConfigs,
                previewMeta: {
                  previewFingerprint: currentPending.preview.preview_fingerprint,
                  previewExpiresAt: currentPending.preview.expires_at,
                  previewDraftKey: "enrollment-date-review",
                  previewResponse: currentPending.preview,
                },
                enrollmentDateDecisions: selectedDecisions,
                billingChangeReason: changeReason,
              };
              onSubmit(
                currentPending.pendingValues,
                currentPending.pendingEnrollmentFees,
                enrollmentActionPlan,
                currentPending.pendingSlotIds,
              );
            }
          }}
          onClose={() => setPendingDateReview(null)}
        />
      ) : null}
      {student ? (
        <EnrollmentTransferSlide
          availableClasses={availableTransferClasses}
          currentClassId={currentClassId}
          isInitialAssignment={isUnassignedStudent}
          transferError={transferError}
          isOpen={isEnrollmentTransferOpen}
          mode={draftEnrollmentActionMode}
          selectedClasses={draftSelectedTransferClasses}
          targetConfigs={draftTargetEnrollmentConfigs}
          studentId={student.id}
          expectedUpdatedAt={student.updated_at}
          sourceEnrollmentId={
            draftEnrollmentActionMode === "transfer" && primaryEnrollment
              ? primaryEnrollment.id
              : null
          }
          onAddClass={(classId) => {
            setTransferError("");
            const targetClass = availableTransferClasses.find((class_) => class_.id === classId);
            const defaultDate = getDefaultTargetEnrollmentDate(targetClass);
            const slotIds = targetClass?.schedule?.slots?.flatMap((slot) => (slot.id ? [slot.id] : [])) ?? [];
            const newConfig: EnrollmentTargetConfig = {
              class_id: classId,
              enrollment_date: defaultDate,
              custom_fee: null,
              selected_slot_ids: slotIds,
            };

            if (draftEnrollmentActionMode === "transfer") {
              setDraftTransferTargetClassIds([classId]);
              setDraftTargetEnrollmentConfigs({ [classId]: newConfig });
            } else {
              setDraftTransferTargetClassIds((current) =>
                current.includes(classId) ? current : [...current, classId],
              );
              setDraftTargetEnrollmentConfigs((current) => ({
                ...current,
                [classId]: current[classId] ?? newConfig,
              }));
            }
          }}
          onClose={closeEnrollmentTransfer}
          onConfirm={(meta) => {
            if (draftEnrollmentActionMode === "transfer" && draftTransferTargetClassIds.length === 0) {
              setTransferError("Vui lòng chọn ít nhất một lớp mới để chuyển học viên.");
              return;
            }
            const missingSessions = draftTransferTargetClassIds.find(
              (classId) => (draftTargetEnrollmentConfigs[classId]?.selected_slot_ids.length ?? 0) === 0,
            );
            if (missingSessions) {
              setTransferError("Mỗi lớp cần chọn ít nhất một buổi học cho học viên.");
              return;
            }
            const missingDates = draftTransferTargetClassIds.find(
              (classId) =>
                !draftTargetEnrollmentConfigs[classId]?.enrollment_date ||
                !isValidIsoDate(draftTargetEnrollmentConfigs[classId].enrollment_date!),
            );
            if (missingDates) {
              setTransferError("Mỗi lớp được chọn phải có ngày bắt đầu hợp lệ.");
              return;
            }
            setEnrollmentActionMode(draftEnrollmentActionMode);
            setTransferTargetClassIds([...draftTransferTargetClassIds]);
            setTargetEnrollmentConfigs(structuredClone(draftTargetEnrollmentConfigs));
            setActionPlanPreviewMeta(meta ?? null);
            setTransferError("");
            setIsEnrollmentTransferOpen(false);
          }}
          onModeChange={(mode) => {
            setTransferError("");
            setDraftEnrollmentActionMode(mode);
            if (mode === "transfer" && draftTransferTargetClassIds.length > 1) {
              const firstClassId = draftTransferTargetClassIds[0];
              setDraftTransferTargetClassIds([firstClassId]);
              setDraftTargetEnrollmentConfigs((current) => {
                const next: Record<string, EnrollmentTargetConfig> = {};
                if (current[firstClassId]) {
                  next[firstClassId] = current[firstClassId];
                }
                return next;
              });
            }
          }}
          onRemoveClass={(classId) =>
            setDraftTransferTargetClassIds((current) => current.filter((id) => id !== classId))
          }
          onUpdateTarget={(config) =>
            setDraftTargetEnrollmentConfigs((current) => {
              const prev = current[config.class_id];
              if (
                prev &&
                prev.enrollment_date === config.enrollment_date &&
                prev.custom_fee === config.custom_fee &&
                prev.selected_slot_ids.length === config.selected_slot_ids.length &&
                prev.selected_slot_ids.every((id, idx) => id === config.selected_slot_ids[idx])
              ) {
                return current;
              }
              return { ...current, [config.class_id]: config };
            })
          }
        />
      ) : null}

    </>
  );

  const formElement = (
    <form
      {...noSavedInfoFormProps}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const target = e.target as HTMLElement;
          if (target.tagName === "INPUT") {
            e.preventDefault();
          }
        } else if (moveFocusByFormArrow(e)) {
          return;
        }
      }}
      onSubmit={(event) => {
        markSubmitted();
        if (invalidEnrollmentDateDraftIds.size > 0) {
          event.preventDefault();
          setBlurredEnrollmentDateIds(new Set(invalidEnrollmentDateDraftIds));
          const firstInvalidEnrollmentId = invalidEnrollmentDateDraftIds.values().next().value;
          window.requestAnimationFrame(() => {
            if (firstInvalidEnrollmentId) {
              document.getElementById(`enrollment-date-${firstInvalidEnrollmentId}`)?.focus();
            }
          });
          return;
        }
        if (sessionSelectionError) {
          event.preventDefault();
          notify.error(sessionSelectionError);
          return;
        }
        if (enrollmentFeeDraftError) {
          event.preventDefault();
          markBlur("custom_fee");
          window.requestAnimationFrame(() => {
            document.getElementById("student-enrollment-custom-fee")?.focus();
          });
          return;
        }
        void handleSubmit(async (values) => {
          let previewMeta = actionPlanPreviewMeta;

          if (student && transferTargetClassIds.length > 0) {
            const currentDraftKey = computeDraftKey(
              enrollmentActionMode,
              primaryEnrollment?.id ?? null,
              transferTargetClassIds.map((cid) => targetEnrollmentConfigs[cid]).filter(Boolean),
            );
            const isExpired = previewMeta?.previewExpiresAt
              ? new Date() >= new Date(previewMeta.previewExpiresAt)
              : true;
            const isMismatched = previewMeta?.previewDraftKey !== currentDraftKey;

            if (!previewMeta || isExpired || isMismatched) {
              try {
                const freshPreview = await previewStudentMembership(student.id, {
                  expected_updated_at: student.updated_at,
                  mode: enrollmentActionMode,
                  source_enrollment_id:
                    enrollmentActionMode === "transfer" && primaryEnrollment ? primaryEnrollment.id : null,
                  targets: transferTargetClassIds.map((cid) => ({
                    class_id: cid,
                    enrollment_date: targetEnrollmentConfigs[cid]?.enrollment_date ?? null,
                    custom_fee: targetEnrollmentConfigs[cid]?.custom_fee ?? null,
                    selected_slot_ids: targetEnrollmentConfigs[cid]?.selected_slot_ids ?? null,
                  })),
                });
                previewMeta = {
                  previewFingerprint: freshPreview.preview_fingerprint,
                  previewExpiresAt: freshPreview.expires_at,
                  previewDraftKey: currentDraftKey,
                  previewResponse: freshPreview,
                };
                setActionPlanPreviewMeta(previewMeta);
              } catch (err) {
                const parsed = parseMembershipError(err);
                notify.error(parsed.message || "Thông tin lớp hoặc học phí đã thay đổi. Vui lòng kiểm tra lại.");
                openEnrollmentTransfer();
                return;
              }
            }
          }

          const enrollmentActionPlan: EnrollmentActionPlan = {
            mode: enrollmentActionMode,
            targetClassIds: transferTargetClassIds,
            targetConfigs: targetEnrollmentConfigs,
            previewMeta,
          };

          if (
            student &&
            enrollmentActionMode === "transfer" &&
            enrollmentActionPlan.targetClassIds.length === 0
          ) {
            setTransferError("Vui lòng chọn ít nhất một lớp mới để chuyển học viên.");
            setIsEnrollmentTransferOpen(true);
            return;
          }

          // Detect enrollment date changes on existing enrollments
          const enrollmentDateChanges = activeEnrollments.filter((enrollment) => {
            const draft = enrollmentFees[enrollment.id];
            return draft && comparableManualDate(draft.enrollment_date, enrollment.enrollment_date) !== (enrollment.enrollment_date ?? null);
          });

          // If there are date changes and no decision has been made yet, call preview and show review dialog
          if (student && enrollmentDateChanges.length > 0 && !pendingDateReview) {
            // Check if any enrollment has protected fees and user has NOT chosen yet
            const unchosenProtected = enrollmentDateChanges.find((enr) => {
              const impact = dateReviewImpacts[enr.id];
              return impact?.hasProtectedFees && !chosenDateDecisions[enr.id];
            });

            if (unchosenProtected) {
              void openDateReviewForEnrollment(unchosenProtected.id, false);
              return;
            }

            setIsDateReviewLoading(true);
            try {
              const enrollmentUpdatePayload = enrollmentDateChanges.map((enrollment) => ({
                enrollment_id: enrollment.id,
                enrollment_date: enrollmentFees[enrollment.id]?.enrollment_date ?? null,
                custom_fee: enrollmentFees[enrollment.id]?.custom_fee ?? null,
                selected_slot_ids: enrollmentFees[enrollment.id]?.selected_slot_ids ?? null,
              }));
              const datePreview = await previewStudentMembership(student.id, {
                expected_updated_at: student.updated_at,
                mode: enrollmentActionPlan.mode,
                source_enrollment_id: null,
                targets: enrollmentActionPlan.targetClassIds.length > 0
                  ? enrollmentActionPlan.targetClassIds.map((cid) => ({
                      class_id: cid,
                      enrollment_date: targetEnrollmentConfigs[cid]?.enrollment_date ?? null,
                      custom_fee: targetEnrollmentConfigs[cid]?.custom_fee ?? null,
                      selected_slot_ids: targetEnrollmentConfigs[cid]?.selected_slot_ids ?? null,
                    }))
                  : [],
                enrollment_updates: enrollmentUpdatePayload,
              });

              // Check if any enrollment update actually has protected fees that were never reviewed
              const unreviewedUpdate = datePreview.enrollment_updates.find(
                (eu) => eu.protected_fee_count > 0 && !chosenDateDecisions[eu.enrollment_id],
              );
              if (unreviewedUpdate) {
                const defaultDecisions: Record<string, string> = {};
                for (const eu of datePreview.enrollment_updates) {
                  defaultDecisions[eu.enrollment_id] = chosenDateDecisions[eu.enrollment_id]?.decisionCode || eu.recommended_decision;
                }
                setPendingDateReview({
                  preview: datePreview,
                  pendingValues: values,
                  pendingEnrollmentFees: enrollmentFees,
                  pendingSlotIds: selectedSlotIds,
                  enrollmentDateDecisions: defaultDecisions,
                  isFromRowButton: false,
                });
                setActionPlanPreviewMeta({
                  previewFingerprint: datePreview.preview_fingerprint,
                  previewExpiresAt: datePreview.expires_at,
                  previewDraftKey: "enrollment-date-review",
                  previewResponse: datePreview,
                });
                return;
              }

              // All are either auto-updated or already chosen!
              previewMeta = {
                previewFingerprint: datePreview.preview_fingerprint,
                previewExpiresAt: datePreview.expires_at,
                previewDraftKey: "enrollment-date-review",
                previewResponse: datePreview,
              };
              enrollmentActionPlan.previewMeta = previewMeta;
            } catch (err) {
              const parsed = parseMembershipError(err);
              notify.error(parsed.message || "Không thể kiểm tra tác động thay đổi ngày bắt đầu.");
              return;
            } finally {
              setIsDateReviewLoading(false);
            }
          }

          // Attach decisions
          if (enrollmentDateChanges.length > 0) {
            const decisionsMap: Record<string, string> = {};
            for (const enr of enrollmentDateChanges) {
              decisionsMap[enr.id] = chosenDateDecisions[enr.id]?.decisionCode || "REANCHOR_CURRENT_CYCLE";
            }
            enrollmentActionPlan.enrollmentDateDecisions = decisionsMap;
          }

          // If coming from review dialog, attach decisions
          if (pendingDateReview) {
            enrollmentActionPlan.enrollmentDateDecisions = pendingDateReview.enrollmentDateDecisions;
            enrollmentActionPlan.previewMeta = actionPlanPreviewMeta;
            setPendingDateReview(null);
          }

          setTransferError("");
          onSubmit(values, enrollmentFees, enrollmentActionPlan, selectedSlotIds);
        })(event);
      }}
    >
      <FormDialogBody>
        <FormSection label="Hồ sơ học viên" order={1}>
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
            <div className={useFullWidthProfileName ? "sm:col-span-2" : undefined}>
              <FormField controlId="student-full-name" label="Họ và tên" error={fullNameError} errorId="student-full-name-error">
                <input
                  {...fullNameField}
                  id="student-full-name"
                  data-dialog-autofocus
                  aria-invalid={Boolean(fullNameError)}
                  aria-describedby={fullNameError ? "student-full-name-error" : undefined}
                  autoComplete={savedInfoAutocomplete.disabled}
                  maxLength={120}
                  className={getFormInputClass(Boolean(fullNameError))}
                  data-row={0}
                  data-col={0}
                />
              </FormField>
            </div>
            <div className={useFullWidthProfileName ? "sm:col-start-2 sm:row-start-2" : undefined}>
              <BirthDateInput
                value={watch("birth_date") ?? null}
                onChange={(val) => {
                  markInput("birth_date", val);
                  setValue("birth_date", val, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }}
                onBlur={() => markBlur("birth_date")}
                error={birthDateError}
                dataRow={useFullWidthProfileName ? 1 : 0}
                dataCol={1}
                privacyToggle={renderPrivacyToggle("birth_date", "Ngày sinh")}
                isContentHidden={hiddenFields.includes("birth_date")}
              />
            </div>
            <div className={useFullWidthProfileName ? "sm:col-start-1 sm:row-start-2" : undefined}>
              <FormField controlId="student-school" label="Tên trường" error={schoolError} errorId="student-school-error">
                <div className="relative">
                  <input
                    {...schoolField}
                    id="student-school"
                    aria-invalid={Boolean(schoolError)}
                    aria-describedby={schoolError ? "student-school-error" : undefined}
                    maxLength={160}
                    autoComplete={savedInfoAutocomplete.disabled}
                    className={`${getFormInputClass(Boolean(schoolError))} ${student ? "!pr-10" : ""}`}
                    data-private-hidden={hiddenFields.includes("school")}
                    data-row={1}
                    data-col={0}
                  />
                  {student ? (
                    <div className="absolute inset-y-0 right-1 z-20 flex items-center">
                      {renderPrivacyToggle("school", "Tên trường")}
                    </div>
                  ) : null}
                </div>
              </FormField>
            </div>
            {student && primaryEnrollment ? (
              <div>
                <FormField
                  controlId="student-enrollment-custom-fee"
                  label="Học phí riêng"
                  error={visibleEnrollmentFeeDraftError}
                  errorId="student-enrollment-custom-fee-error"
                >
                  <SmartMoneyInput
                    id="student-enrollment-custom-fee"
                    ariaInvalid={Boolean(visibleEnrollmentFeeDraftError)}
                    ariaDescribedBy={
                      visibleEnrollmentFeeDraftError
                        ? "student-enrollment-custom-fee-error"
                        : undefined
                    }
                    value={enrollmentFees[primaryEnrollment.id]?.custom_fee ?? null}
                    onBlur={() => markBlur("custom_fee")}
                    onChange={(val) =>
                      setEnrollmentFees((current) => ({
                        ...current,
                        [primaryEnrollment.id]: {
                          ...current[primaryEnrollment.id],
                          custom_fee: val,
                        },
                      }))
                    }
                    onDraftChange={(rawValue, isComplete) => {
                      markInput("custom_fee", rawValue);
                      if (rawValue && !isComplete) {
                        setEnrollmentFeeDraftError(validationMessages.feeFormat);
                        setError("custom_fee", {
                          type: "manual",
                          message: validationMessages.feeFormat,
                        });
                      } else {
                        setEnrollmentFeeDraftError("");
                        clearErrors("custom_fee");
                      }
                    }}
                    placeholder="Dùng học phí mặc định của lớp"
                    className={numberInputClassName}
                    dataRow={1}
                    dataCol={1}
                  />
                </FormField>
              </div>
            ) : currentClass ? (
              <FormField controlId="student-custom-fee" label="Học phí riêng" error={customFeeError} errorId="student-custom-fee-error">
                <SmartMoneyInput
                  id="student-custom-fee"
                  ariaInvalid={Boolean(customFeeError)}
                  ariaDescribedBy={customFeeError ? "student-custom-fee-error" : undefined}
                  value={watch("custom_fee") ?? null}
                  onBlur={() => markBlur("custom_fee")}
                  onChange={(val) => {
                    setValue("custom_fee", val, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                  onDraftChange={(rawValue, isComplete) => {
                    markInput("custom_fee", rawValue);
                    if (rawValue && !isComplete) {
                      setError("custom_fee", {
                        type: "manual",
                        message: validationMessages.feeFormat,
                      });
                    } else {
                      clearErrors("custom_fee");
                    }
                  }}
                  placeholder="Để trống nếu dùng học phí lớp"
                  className={getNumberInputClass(Boolean(customFeeError))}
                  dataRow={1}
                  dataCol={1}
                />
              </FormField>
            ) : null}
          </div>
        </FormSection>

        <FormSection label="Thông tin liên hệ" order={2}>
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
            <StudentContactFields
              zaloField={studentZaloField}
              phoneField={studentPhoneField}
              error={studentContactError}
              onBlur={() => markBlur("student_contact")}
              suggestion={studentContactSuggestion}
              onAcceptSuggestion={() =>
                acceptContactSuggestion("student", studentContactSuggestion)
              }
              privacyToggle={renderPrivacyToggle("student_contact", "Zalo học viên")}
              isContentHidden={hiddenFields.includes("student_contact")}
            />
            <ParentContactFields
              zaloField={parentZaloField}
              phoneField={parentPhoneField}
              error={parentContactError}
              onBlur={() => markBlur("parent_contact")}
              suggestion={parentContactSuggestion}
              onAcceptSuggestion={() =>
                acceptContactSuggestion("parent", parentContactSuggestion)
              }
              privacyToggle={renderPrivacyToggle("parent_contact", "Zalo phụ huynh")}
              isContentHidden={hiddenFields.includes("parent_contact")}
            />
          </div>
        </FormSection>

        <FormSection label="Quá trình học" order={3}>
          <div className="w-full">
            {!student && currentClass ? (
              <InitialEnrollmentFields
                enrollmentDateValue={watch("enrollment_date") ?? null}
                error={enrollmentDateError}
                onBlur={() => markBlur("enrollment_date")}
                onEnrollmentDateChange={(value) => {
                  markInput("enrollment_date", value ?? "");
                  setValue("enrollment_date", value ?? "", {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }}
              />
            ) : null}

            {!student && currentClass ? (
              <SessionSelector
                class_={currentClass}
                selectedSlotIds={selectedSlotIds}
                onChange={setSelectedSlotIds}
                customFee={watch("custom_fee") ?? null}
                onApplySuggestedFee={(amount) => setValue("custom_fee", amount, {
                  shouldDirty: true,
                  shouldValidate: true,
                })}
              />
            ) : null}

            {student ? (
              <EnrollmentFeeSection
                classes={classes}
                currentClassId={currentClassId}
                enrollments={activeEnrollments}
                isInitialAssignment={isUnassignedStudent}
                isLoading={false}
                onTransferOpen={openEnrollmentTransfer}
                enrollmentActionMode={enrollmentActionMode}
                selectedTransferClasses={selectedTransferClasses}
                targetConfigs={targetEnrollmentConfigs}
                enrollmentFees={enrollmentFees}
                invalidEnrollmentDateIds={invalidEnrollmentDateIds}
                onEnrollmentDateChange={(enrollmentId, enrollment_date) => {
                  setEnrollmentFees((current) => ({
                    ...current,
                    [enrollmentId]: { ...current[enrollmentId], enrollment_date },
                  }));
                  void checkDateImpact(enrollmentId, enrollment_date);
                }}
                onEnrollmentDateBlur={(enrollmentId) => {
                  setBlurredEnrollmentDateIds((current) => {
                    if (current.has(enrollmentId)) return current;
                    const next = new Set(current);
                    next.add(enrollmentId);
                    return next;
                  });
                }}
                dateReviewImpacts={dateReviewImpacts}
                chosenDateDecisions={chosenDateDecisions}
                onOpenStartDateReview={openDateReviewForEnrollment}
                onEnrollmentSlotsChange={(enrollmentId, selected_slot_ids) => setEnrollmentFees((current) => ({
                  ...current,
                  [enrollmentId]: { ...current[enrollmentId], selected_slot_ids },
                }))}
                onEnrollmentCustomFeeChange={(enrollmentId, custom_fee) => setEnrollmentFees((current) => ({
                  ...current,
                  [enrollmentId]: { ...current[enrollmentId], custom_fee },
                }))}
              />
            ) : null}

            <div className={currentClass || student ? "mt-2" : ""}>
              <FormField
                controlId="student-notes"
                label="Ghi chú"
                labelTrailing={renderPrivacyToggle("notes", "Ghi chú")}
                error={notesError}
                errorId="student-notes-error"
              >
                <textarea
                  {...notesField}
                  id="student-notes"
                  aria-invalid={Boolean(notesError)}
                  aria-describedby={notesError ? "student-notes-error" : undefined}
                  maxLength={1000}
                  autoComplete={savedInfoAutocomplete.disabled}
                  rows={2}
                  className={`${getFormInputClass(Boolean(notesError))} block h-16 min-h-16 resize-none py-2 leading-5`}
                  data-private-hidden={hiddenFields.includes("notes")}
                  data-row={5}
                  data-col={0}
                  placeholder="Thông tin cần lưu ý về học viên (nếu có)"
                />
              </FormField>
            </div>
          </div>
        </FormSection>
      </FormDialogBody>

      <FormDialogFooter
        left={
          shouldShowUnsavedNotice ? (
            <UnsavedChangesNotice
              hasChanges={hasUnsavedChanges}
              hasErrors={unsavedNoticeHasErrors}
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
              disabled={isSaving || isDateReviewLoading}
              onClick={smartRequestClose}
            >
              Huỷ
            </Button>
            <SaveButton
              type="submit"
              isSaving={isSaving || isDateReviewLoading}
              disabled={Boolean(student && !hasUnsavedChanges)}
            />
          </>
        }
      />
    </form>
  );

  if (embedded) {
    return (
      <>
        {formElement}
        {overlayExtra}
      </>
    );
  }

  return (
    <FormDialogShell
      title={student ? "Chỉnh sửa học viên" : currentClass ? "Thêm học viên" : "Thêm hồ sơ"}
      width={student ? "lg" : "standard"}
      isBusy={isSaving || isDateReviewLoading}
      dirty={hasUnsavedChanges}
      onClose={smartRequestClose}
      suspended={isEnrollmentTransferOpen || Boolean(pendingDateReview)}
      frameProps={{
        className: student ? undefined : createEntityDialogFrameClassName,
        inert: isEnrollmentTransferOpen || Boolean(pendingDateReview),
      }}
      overlayExtra={overlayExtra}
    >
      {formElement}
    </FormDialogShell>
  );
}

function PrivacyToggleButton({
  field,
  isHidden,
  label,
  onToggle,
}: {
  field: StudentHiddenField;
  isHidden: boolean;
  label: string;
  onToggle: (field: StudentHiddenField) => void;
}) {
  const actionLabel = isHidden
    ? `Hiện ${label} trên danh sách và Excel`
    : `Ẩn ${label} trên danh sách và Excel`;

  return (
    <button
      type="button"
      title={actionLabel}
      aria-label={actionLabel}
      aria-pressed={isHidden}
      onClick={() => onToggle(field)}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 ${
        isHidden
          ? "text-gray-900 hover:text-gray-700"
          : "text-gray-400 hover:text-gray-700"
      }`}
    >
      {isHidden ? (
        <EyeOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Eye className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

function InitialEnrollmentFields({
  enrollmentDateValue,
  error,
  onBlur,
  onEnrollmentDateChange,
}: {
  enrollmentDateValue: string | null;
  error?: string;
  onBlur?: () => void;
  onEnrollmentDateChange: (value: string | null) => void;
}) {
  return (
    <div>
      <FormField
        error={error}
        errorId="initial-enrollment-date-error"
        label="Ngày bắt đầu"
        labelId="initial-enrollment-date-label"
      >
        <ManualDateInput
          id="initial-enrollment-date"
          value={enrollmentDateValue}
          onChange={onEnrollmentDateChange}
          onBlur={onBlur}
          error={Boolean(error)}
          ariaLabel="Ngày bắt đầu"
          ariaDescribedBy={error ? "initial-enrollment-date-error" : undefined}
        />
      </FormField>
    </div>
  );
}

function SessionSelector({
  class_,
  selectedSlotIds,
  onChange,
  customFee,
  onApplySuggestedFee,
  compact = false,
}: {
  class_: ClassResponse | null;
  selectedSlotIds: string[];
  onChange: (slotIds: string[]) => void;
  customFee?: number | null;
  onApplySuggestedFee?: (amount: number) => void;
  compact?: boolean;
}) {
  const slots = class_?.schedule?.slots?.filter((slot) => slot.id) ?? [];
  if (class_ === null || slots.length === 0) {
    return null;
  }

  const availableIds = slots.map((slot) => slot.id as string);
  const allSelected = availableIds.every((id) => selectedSlotIds.includes(id));
  const selectedSlots = slots.filter((slot) => selectedSlotIds.includes(slot.id as string));
  const suggestion = getEnrollmentFeeSuggestion(class_.base_fee, slots, selectedSlots);

  return (
    <div className="mt-3 w-full min-w-0">
      <div className="w-full min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50/50 p-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="table-heading-text min-w-0 text-gray-600">Chọn buổi học trong tuần</p>
          {!allSelected ? (
            <button
              type="button"
              className="h-7 shrink-0 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              onClick={() => onChange(availableIds)}
            >
              Chọn tất cả
            </button>
          ) : null}
        </div>
        <div className="mt-2 w-full min-w-0 overflow-hidden">
          <div
            role="group"
            aria-label="Chọn buổi học trong tuần"
            className={
              compact
                ? "flex flex-wrap items-center gap-1.5"
                : "grid w-full min-w-0 grid-cols-[repeat(4,minmax(0,1fr))] gap-2"
            }
          >
            {slots.map((slot) => {
              const id = slot.id as string;
              const checked = selectedSlotIds.includes(id);
              const isLastSelected = checked && selectedSlotIds.length === 1;
              return (
                <button
                  key={id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`${slot.day} ${slot.start}–${slot.end}`}
                  disabled={isLastSelected}
                  onClick={() =>
                    onChange(checked ? selectedSlotIds.filter((item) => item !== id) : [...selectedSlotIds, id])
                  }
                  title={`${slot.day} ${slot.start}–${slot.end}`}
                  className={`inline-flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border text-[13px] font-medium leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-default ${
                    compact ? "w-auto shrink-0 px-1.5" : "w-full px-1.5"
                  } ${
                    checked
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-gray-200 bg-white text-gray-600 hover:border-primary/40 hover:bg-primary-soft/40"
                  }`}
                >
                  <span className="flex min-w-0 max-w-full items-center justify-center gap-1 whitespace-nowrap">
                    {checked ? <span aria-hidden="true">✓</span> : null}
                    <span>{slot.day}</span>
                  </span>
                  <span className="max-w-full whitespace-nowrap text-xs font-normal leading-3.5 tabular-nums tracking-[-0.01em]">
                    {slot.start}–{slot.end}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {suggestion && onApplySuggestedFee ? (
          <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm text-gray-700">
              Gợi ý <strong className="font-semibold text-gray-950">{formatCurrency(suggestion.amount)}</strong> theo {suggestion.selectedCount}/{suggestion.totalCount} buổi.
            </p>
            <button
              type="button"
              onClick={() => onApplySuggestedFee(suggestion.amount)}
              disabled={customFee === suggestion.amount}
              className="form-input-text inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 font-medium text-primary transition hover:border-primary/30 hover:bg-primary-soft/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/20 disabled:cursor-default disabled:opacity-60"
            >
              {customFee === suggestion.amount ? "Đã áp dụng" : "Áp dụng gợi ý"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EnrollmentTransferSlide({
  availableClasses,
  currentClassId,
  isInitialAssignment,
  transferError,
  isOpen,
  mode,
  selectedClasses,
  targetConfigs,
  studentId,
  expectedUpdatedAt,
  sourceEnrollmentId,
  onAddClass,
  onClose,
  onConfirm,
  onModeChange,
  onRemoveClass,
  onUpdateTarget,
}: {
  availableClasses: ClassResponse[];
  currentClassId: string | null;
  isInitialAssignment: boolean;
  transferError: string;
  isOpen: boolean;
  mode: EnrollmentActionMode;
  selectedClasses: ClassResponse[];
  targetConfigs: Record<string, EnrollmentTargetConfig>;
  studentId?: string;
  expectedUpdatedAt?: string;
  sourceEnrollmentId?: string | null;
  onAddClass: (classId: string) => void;
  onClose: () => void;
  onConfirm: (previewMeta?: ActionPlanPreviewMeta) => void;
  onModeChange: (mode: EnrollmentActionMode) => void;
  onRemoveClass: (classId: string) => void;
  onUpdateTarget: (config: EnrollmentTargetConfig) => void;
}) {
  const queryClient = useQueryClient();
  const sortedAvailableClasses = sortClassesForSelection(availableClasses);
  const actionOptions = isInitialAssignment
    ? [{ label: "Xếp lớp", value: "supplement" as EnrollmentActionMode }]
    : [
        { label: "Đổi lớp", value: "transfer" as EnrollmentActionMode },
        { label: "Học thêm lớp", value: "supplement" as EnrollmentActionMode },
      ];
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const transitionDuration = useSlidePanelDuration(panelRef);

  const [blurredDateTargetIds, setBlurredDateTargetIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [slotAlerts, setSlotAlerts] = useState<Record<string, string>>({});
  const [classHistorySlotsMap, setClassHistorySlotsMap] = useState<
    Record<string, Array<{ id: string; effective_from: string; effective_until: string | null }>>
  >({});
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);

  // Real-time Preview State Machine
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [previewResponse, setPreviewResponse] = useState<StudentMembershipPreviewResponse | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [previewExpiresAt, setPreviewExpiresAt] = useState<string | null>(null);
  const [previewDraftKey, setPreviewDraftKey] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previewCacheRef = useRef<Record<string, StudentMembershipPreviewResponse>>({});

  const initialDraftKeyRef = useRef<string>("");

  const currentDraftKey = useMemo(() => {
    return computeDraftKey(
      mode,
      sourceEnrollmentId ?? null,
      selectedClasses.map((c) => targetConfigs[c.id]).filter(Boolean),
    );
  }, [mode, selectedClasses, sourceEnrollmentId, targetConfigs]);

  const businessToday = useMemo(() => getBusinessTodayInVietnam(), []);

  // Set baseline draft key when slide opens
  useEffect(() => {
    if (isOpen) {
      initialDraftKeyRef.current = currentDraftKey;
      setBlurredDateTargetIds(new Set());
      setSlotAlerts({});
    } else {
      abortControllerRef.current?.abort();
      previewCacheRef.current = {};
      setPreviewState("idle");
      setPreviewResponse(null);
      setPreviewFingerprint(null);
      setPreviewDraftKey(null);
      setPreviewError(null);
    }
  }, [isOpen, currentDraftKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-transfer-initial-focus]")?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      previouslyFocusedElement.current?.focus();
    };
  }, [isOpen]);

  // Handle date change with historical slots filtering
  const handleDateChange = useCallback(
    async (classId: string, rawDate: string | null) => {
      const currentConfig = targetConfigs[classId];
      if (!currentConfig) return;

      const targetClass = selectedClasses.find((c) => c.id === classId);
      const updatedConfig = { ...currentConfig, enrollment_date: rawDate };

      if (rawDate && isValidIsoDate(rawDate) && targetClass) {
        let slots = classHistorySlotsMap[classId];
        if (!slots) {
          try {
            const history = await queryClient.fetchQuery({
              queryKey: classQueryKeys.history(classId),
              queryFn: () => getClassHistory(classId),
              staleTime: 60_000,
            });
            slots = history.schedule_slots.map((s) => ({
              id: s.slot_id,
              effective_from: s.effective_from,
              effective_until: s.effective_until,
            }));
            setClassHistorySlotsMap((prev) => ({ ...prev, [classId]: slots }));
          } catch {
            slots = (targetClass.schedule?.slots ?? []).map((s) => ({
              id: s.id ?? "",
              effective_from: targetClass.start_date ?? "1970-01-01",
              effective_until: null,
            }));
          }
        }

        const effective = filterEffectiveSlotsForDate(slots, rawDate);
        const effectiveIds = new Set(effective.map((s) => s.id));
        const prunedSelected = currentConfig.selected_slot_ids.filter((id) => effectiveIds.has(id));

        if (prunedSelected.length !== currentConfig.selected_slot_ids.length) {
          updatedConfig.selected_slot_ids = prunedSelected;
          setSlotAlerts((prev) => ({
            ...prev,
            [classId]: "Lịch học đã được cập nhật theo ngày bắt đầu.",
          }));
        }
      }

      onUpdateTarget(updatedConfig);
    },
    [classHistorySlotsMap, onUpdateTarget, queryClient, selectedClasses, targetConfigs],
  );

  const handleDateBlur = useCallback((classId: string) => {
    setBlurredDateTargetIds((prev) => {
      if (prev.has(classId)) return prev;
      const next = new Set(prev);
      next.add(classId);
      return next;
    });
  }, []);

  // Debounced real-time preview call
  useEffect(() => {
    if (!isOpen || selectedClasses.length === 0 || !studentId) {
      setPreviewState("idle");
      setPreviewResponse(null);
      setPreviewFingerprint(null);
      setPreviewDraftKey(null);
      setPreviewError(null);
      return;
    }

    if (currentDraftKey === previewDraftKey && previewState === "success") {
      return;
    }

    const cached = previewCacheRef.current[currentDraftKey];
    if (cached && (!cached.expires_at || new Date(cached.expires_at) > new Date())) {
      setPreviewResponse(cached);
      setPreviewFingerprint(cached.preview_fingerprint);
      setPreviewExpiresAt(cached.expires_at);
      setPreviewDraftKey(currentDraftKey);
      setPreviewState("success");
      setPreviewError(null);
      return;
    }

    const configs = selectedClasses.map((c) => targetConfigs[c.id]).filter(Boolean);
    const allDatesValid =
      configs.length > 0 &&
      configs.every((cfg) => cfg.enrollment_date && isValidIsoDate(cfg.enrollment_date));
    const allSlotsSelected = configs.every(
      (cfg) => cfg.selected_slot_ids && cfg.selected_slot_ids.length > 0,
    );

    if (!allDatesValid || !allSlotsSelected) {
      setPreviewState("idle");
      setPreviewResponse(null);
      setPreviewFingerprint(null);
      setPreviewDraftKey(null);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      setPreviewState("loading");
      setPreviewError(null);

      try {
        const response = await previewStudentMembership(
          studentId,
          {
            expected_updated_at: expectedUpdatedAt ?? "",
            mode,
            source_enrollment_id: mode === "transfer" ? (sourceEnrollmentId ?? null) : null,
            targets: configs.map((cfg) => ({
              class_id: cfg.class_id,
              enrollment_date: cfg.enrollment_date,
              custom_fee: cfg.custom_fee,
              selected_slot_ids: cfg.selected_slot_ids,
            })),
          },
          { signal: controller.signal },
        );

        if (!controller.signal.aborted) {
          previewCacheRef.current[currentDraftKey] = response;
          setPreviewResponse(response);
          setPreviewFingerprint(response.preview_fingerprint);
          setPreviewExpiresAt(response.expires_at);
          setPreviewDraftKey(currentDraftKey);
          setPreviewState("success");
          setPreviewError(null);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          const parsed = parseMembershipError(err);
          setPreviewError(parsed.message);
          setPreviewState("error");
          setPreviewFingerprint(null);
          setPreviewResponse(null);
          setPreviewDraftKey(null);
        }
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    currentDraftKey,
    expectedUpdatedAt,
    isOpen,
    mode,
    previewDraftKey,
    previewState,
    selectedClasses,
    sourceEnrollmentId,
    studentId,
    targetConfigs,
  ]);

  const isPreviewExpired = previewExpiresAt ? new Date() >= new Date(previewExpiresAt) : false;
  const isPreviewFingerprintValid = Boolean(
    previewFingerprint && /^[0-9a-f]{64}$/.test(previewFingerprint),
  );
  const isDraftKeyMatching = previewDraftKey === currentDraftKey;

  const hasInvalidDates = selectedClasses.some((c) => {
    const cfg = targetConfigs[c.id];
    return !cfg?.enrollment_date || !isValidIsoDate(cfg.enrollment_date);
  });
  const hasMissingSlots = selectedClasses.some((c) => {
    const cfg = targetConfigs[c.id];
    return !cfg?.selected_slot_ids || cfg.selected_slot_ids.length === 0;
  });

  const canCommitApply =
    selectedClasses.length > 0 &&
    !hasInvalidDates &&
    !hasMissingSlots &&
    previewState === "success" &&
    previewResponse?.can_apply === true &&
    isDraftKeyMatching &&
    isPreviewFingerprintValid &&
    !isPreviewExpired;

  function attemptClose() {
    if (!isOpen) return;
    const isDirty = currentDraftKey !== initialDraftKeyRef.current;
    if (isDirty) {
      setIsDiscardConfirmOpen(true);
    } else {
      onClose();
    }
  }

  function handleTransferKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!isOpen) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      attemptClose();
      return;
    }

    if (event.key !== "Tab" || !panelRef.current) {
      return;
    }

    event.stopPropagation();
    const focusableElements = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) => element.offsetParent !== null && !element.closest("[inert]"),
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);

    if (!firstElement || !lastElement) {
      return;
    }

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  function handleApplyClick() {
    // Đánh dấu blurred cho toàn bộ các lớp để hiển thị lỗi validation nếu có
    setBlurredDateTargetIds(new Set(selectedClasses.map((c) => c.id)));

    // Kiểm tra và focus vào ô ngày lỗi đầu tiên
    for (const c of selectedClasses) {
      const cfg = targetConfigs[c.id];
      const validation = validateTargetEnrollmentDate(cfg?.enrollment_date);
      if (!validation.isValid) {
        document.getElementById(`enrollment-date-${c.id}`)?.focus();
        return;
      }
    }

    for (const c of selectedClasses) {
      const cfg = targetConfigs[c.id];
      if (!cfg?.selected_slot_ids || cfg.selected_slot_ids.length === 0) {
        return;
      }
    }

    if (!canCommitApply || !previewFingerprint || !previewExpiresAt || !previewResponse) {
      return;
    }

    onConfirm({
      previewFingerprint,
      previewExpiresAt,
      previewDraftKey: currentDraftKey,
      previewResponse,
    });
  }

  return createPortal(
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrollment-transfer-title"
        aria-hidden={!isOpen}
        inert={!isOpen}
        onKeyDown={handleTransferKeyDown}
        className={`fixed inset-0 z-[70] flex justify-end ${
          isOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <div
          style={getSlideBackdropStyle(transitionDuration)}
          className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity motion-reduce:transition-none ${
            isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={attemptClose}
        />

        <div
          ref={panelRef}
          style={getSlidePanelStyle(transitionDuration)}
          className={`relative z-10 flex h-full w-full flex-col bg-white shadow-2xl transition-transform motion-reduce:transition-none sm:w-[82vw] lg:w-[76vw] xl:w-[72vw] 2xl:w-[68vw] max-w-[940px] ${
            isOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-primary/15 bg-primary-soft/60 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-transfer-initial-focus
                aria-label={isInitialAssignment ? "Đóng phần xếp lớp" : "Đóng phần chuyển hoặc thêm lớp"}
                title="Đóng"
                onClick={attemptClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-primary-soft hover:text-primary"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <h3 id="enrollment-transfer-title" className="section-title-text text-primary">
                {isInitialAssignment ? "Xếp lớp" : "Chuyển / thêm lớp"}
              </h3>
            </div>
          </div>

          <div className="flex-1 overflow-hidden p-4 sm:p-5">
            <div className="grid h-full gap-4 xl:grid-cols-[440px_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-4 py-3">
                  <p className="text-base font-semibold text-gray-900">Thao tác</p>
                </div>
                <div className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-gray-50 p-4">
                  {!isInitialAssignment ? (
                    <div>
                      <div
                        role="tablist"
                        aria-label="Chế độ thao tác lớp"
                        className="grid h-9 grid-cols-2 gap-1 overflow-hidden rounded-lg border border-gray-200 bg-white p-1"
                      >
                        {actionOptions.map((option) => {
                          const selected = mode === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="tab"
                              aria-selected={selected}
                              onClick={() => onModeChange(option.value)}
                              className={`whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
                                selected
                                  ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20"
                                  : "text-gray-600 hover:bg-primary-soft/60 hover:text-primary"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {selectedClasses.map((class_) => {
                    const config = targetConfigs[class_.id];
                    if (!config) return null;
                    const isBlurred = blurredDateTargetIds.has(class_.id);
                    const dateValidation = validateTargetEnrollmentDate(config.enrollment_date);
                    const dateError = isBlurred && !dateValidation.isValid ? dateValidation.error : null;
                    const isFuture = Boolean(
                      config.enrollment_date &&
                        config.enrollment_date > businessToday &&
                        isValidIsoDate(config.enrollment_date),
                    );
                    const alertMsg = slotAlerts[class_.id];

                    return (
                      <div
                        key={`${class_.id}-configuration`}
                        className="rounded-md border border-gray-200 bg-white p-3.5 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900">{class_.name}</p>
                          <button
                            type="button"
                            onClick={() => onRemoveClass(class_.id)}
                            className="text-xs text-gray-400 hover:text-destructive transition-colors"
                            aria-label={`Bỏ chọn lớp ${class_.name}`}
                          >
                            Bỏ chọn
                          </button>
                        </div>

                        {alertMsg ? (
                          <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs text-amber-800">
                            {alertMsg}
                          </div>
                        ) : null}

                        <SessionSelector
                          class_={class_}
                          selectedSlotIds={config.selected_slot_ids}
                          onChange={(selected_slot_ids) => {
                            setSlotAlerts((prev) => {
                              const next = { ...prev };
                              delete next[class_.id];
                              return next;
                            });
                            onUpdateTarget({ ...config, selected_slot_ids });
                          }}
                          customFee={config.custom_fee}
                          onApplySuggestedFee={(custom_fee) => onUpdateTarget({ ...config, custom_fee })}
                          compact
                        />

                        <div className="mt-2.5 grid grid-cols-1 items-start gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <div className="flex h-5 items-center justify-between gap-1">
                              <label
                                htmlFor={`enrollment-date-${class_.id}`}
                                className="text-xs font-semibold text-gray-700"
                              >
                                Ngày bắt đầu <span className="text-destructive">*</span>
                              </label>
                              {isFuture ? (
                                <StatusPill tone="primary" title="Ngày bắt đầu trong tương lai">Sắp học</StatusPill>
                              ) : null}
                            </div>
                            <ManualDateInput
                              id={`enrollment-date-${class_.id}`}
                              value={config.enrollment_date ?? ""}
                              onChange={(val) => handleDateChange(class_.id, val)}
                              onBlur={() => handleDateBlur(class_.id)}
                              aria-invalid={Boolean(dateError)}
                              aria-describedby={dateError ? `enrollment-date-error-${class_.id}` : undefined}
                            />
                            {dateError ? (
                              <p
                                id={`enrollment-date-error-${class_.id}`}
                                role="alert"
                                className="text-xs font-medium text-destructive"
                              >
                                {dateError}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-1">
                            <div className="flex h-5 items-center justify-between gap-1">
                              <label
                                htmlFor={`custom-fee-${class_.id}`}
                                className="text-xs font-semibold text-gray-700"
                              >
                                Học phí riêng
                              </label>
                            </div>
                            <SmartMoneyInput
                              id={`custom-fee-${class_.id}`}
                              value={config.custom_fee}
                              onChange={(custom_fee) => onUpdateTarget({ ...config, custom_fee })}
                              placeholder="Dùng học phí của lớp"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}



                  {previewError ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                      <p className="font-semibold">Không thể áp dụng:</p>
                      <p className="mt-0.5">{previewError}</p>
                    </div>
                  ) : null}

                  {previewResponse?.warnings && previewResponse.warnings.length > 0 ? (
                    <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
                      <p className="font-semibold">Lưu ý khi áp dụng:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {previewResponse.warnings.map((w, idx) => (
                          <li key={idx}>{w.message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {previewResponse?.source ? (
                    <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-600">
                      <p>
                        Lớp nguồn: <span className="font-semibold text-gray-900">{previewResponse.source.class_name}</span> kết thúc ngày{" "}
                        <span className="font-semibold text-gray-900">{formatDate(previewResponse.source.ends_on ?? "")}</span>.
                        {" "}Cập nhật {previewResponse.source.mutable_fee_count} khoản phí.
                      </p>
                    </div>
                  ) : null}

                  {mode === "transfer" && currentClassId ? (
                    <FormNotice>
                      Lưu xong, học viên sẽ rời lớp hiện tại.
                    </FormNotice>
                  ) : null}

                  {transferError ? (
                    <p id="enrollment-transfer-error" role="alert" className="text-sm text-destructive">
                      {transferError}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex min-h-0 flex-col rounded-md border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="section-title-text text-gray-900">Danh sách lớp</p>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                      {sortedAvailableClasses.length} lớp khả dụng
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {sortedAvailableClasses.length === 0 ? (
                    <div className="rounded-md border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
                      Không còn lớp khả dụng để chọn cho học viên này.
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {sortedAvailableClasses.map((class_) => {
                        const selected = selectedClasses.some((item) => item.id === class_.id);
                        const group = getClassGroupInfoForRecord(class_);
                        const backgroundColor = selected
                          ? `color-mix(in srgb, ${group.color.background} 62%, ${group.color.border})`
                          : group.color.background;
                        return (
                          <button
                            key={class_.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              selected ? onRemoveClass(class_.id) : onAddClass(class_.id)
                            }
                            style={{
                              backgroundColor,
                              borderColor: selected ? group.color.text : group.color.border,
                              color: group.color.text,
                            }}
                            className={`flex min-h-20 flex-col justify-between rounded-md border px-3.5 py-2.5 text-left transition-shadow duration-150 hover:shadow-sm ${
                              selected ? "shadow-sm" : ""
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="min-w-0 break-words text-sm font-semibold">
                                {class_.name}
                              </p>
                              <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold">
                                {class_.student_count}
                              </span>
                            </div>
                            <p className="mt-2 text-sm opacity-85">
                              {formatCurrencyVnd(class_.base_fee)} / {getClassBillingDurationLabel(class_)}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 bg-gray-100 p-4">
            <Button
              type="button"
              className="w-full rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              onClick={handleApplyClick}
              disabled={!canCommitApply}
              aria-describedby={transferError ? "enrollment-transfer-error" : undefined}
            >
              {previewState === "loading" ? <LoadingLabel label="Đang kiểm tra..." /> : "Áp dụng"}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmationDialog
        open={isDiscardConfirmOpen}
        title="Hủy thay đổi lớp?"
        description="Các thiết lập lớp và ngày bắt đầu chưa áp dụng sẽ không được lưu vào form."
        confirmLabel="Hủy thay đổi"
        cancelLabel="Tiếp tục chỉnh sửa"
        tone="danger"
        onConfirm={() => {
          setIsDiscardConfirmOpen(false);
          onClose();
        }}
        onCancel={() => setIsDiscardConfirmOpen(false)}
      />
    </>,
    document.body,
  );
}

function EnrollmentFeeSection({
  classes,
  currentClassId,
  enrollmentActionMode,
  enrollments,
  isInitialAssignment,
  isLoading,
  onTransferOpen,
  onEnrollmentDateChange,
  onEnrollmentDateBlur,
  enrollmentFees,
  invalidEnrollmentDateIds,
  selectedTransferClasses,
  targetConfigs = {},
  onEnrollmentSlotsChange,
  onEnrollmentCustomFeeChange,
  dateReviewImpacts,
  chosenDateDecisions,
  onOpenStartDateReview,
}: {
  classes: ClassResponse[];
  currentClassId: string | null;
  enrollmentActionMode: EnrollmentActionMode;
  enrollments: StudentEnrollmentInfo[];
  isInitialAssignment: boolean;
  isLoading: boolean;
  onTransferOpen: () => void;
  onEnrollmentDateChange: (enrollmentId: string, value: string | null) => void;
  onEnrollmentDateBlur: (enrollmentId: string) => void;
  enrollmentFees: EnrollmentFeeValues;
  invalidEnrollmentDateIds: Set<string>;
  selectedTransferClasses: ClassResponse[];
  targetConfigs?: Record<string, EnrollmentTargetConfig>;
  onEnrollmentSlotsChange: (enrollmentId: string, slotIds: string[]) => void;
  onEnrollmentCustomFeeChange: (enrollmentId: string, fee: number | null) => void;
  dateReviewImpacts?: Record<string, {
    isLoading: boolean;
    hasProtectedFees: boolean;
    impact?: AffectedEnrollmentImpact;
    preview?: StudentMembershipPreviewResponse;
  }>;
  chosenDateDecisions?: Record<string, { decisionCode: string; reason: string }>;
  onOpenStartDateReview?: (enrollmentId: string) => void;
}) {
  const sortedEnrollments = useMemo(() => {
    return [...enrollments].sort((left, right) => {
      const leftIsCurrent = left.class_id === currentClassId;
      const rightIsCurrent = right.class_id === currentClassId;

      if (leftIsCurrent && !rightIsCurrent) {
        return -1;
      }
      if (!leftIsCurrent && rightIsCurrent) {
        return 1;
      }

      const [leftGroupSort, leftNameSort] = getClassSortKey(left.class_name);
      const [rightGroupSort, rightNameSort] = getClassSortKey(right.class_name);

      if (leftGroupSort !== rightGroupSort) {
        return leftGroupSort - rightGroupSort;
      }

      return leftNameSort.localeCompare(rightNameSort, "vi");
    });
  }, [currentClassId, enrollments]);

  const transferSummary = useMemo(() => {
    if (selectedTransferClasses.length === 0) return "";
    const actionText = isInitialAssignment ? "Đã chọn xếp lớp" : enrollmentActionMode === "transfer" ? "Đổi lớp sang" : "Học thêm";

    if (selectedTransferClasses.length === 1) {
      const target = selectedTransferClasses[0];
      const cfg = targetConfigs[target.id];
      const dateFormatted = cfg?.enrollment_date ? formatDate(cfg.enrollment_date) : "";
      return `${actionText} ${target.name}${dateFormatted ? ` · Bắt đầu ${dateFormatted}` : ""}`;
    }

    return `${actionText}: ${selectedTransferClasses.map((c) => c.name).join(", ")}`;
  }, [enrollmentActionMode, isInitialAssignment, selectedTransferClasses, targetConfigs]);
  const visibleEnrollments = sortedEnrollments.slice(0, 3);
  const remainingEnrollmentCount = Math.max(0, sortedEnrollments.length - visibleEnrollments.length);
  const enrollmentNames = sortedEnrollments.map((enrollment) => enrollment.class_name).join(", ");

  return (
    <div className="space-y-2">
      {isLoading ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
          <LoadingLabel label="Đang tải lớp đang học" />
        </div>
      ) : null}

      {!isLoading ? (
        <>
          <div className="select-none rounded-md border border-gray-200 bg-gray-50 p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="form-label-text shrink-0 text-[12px] font-semibold uppercase text-gray-500">
                {isInitialAssignment ? "Lớp học" : "Lớp đang học"}
              </p>
              <div
                className="flex min-w-0 flex-1 flex-wrap gap-1"
                title={enrollmentNames || undefined}
              >
                {sortedEnrollments.length > 0 ? (
                  <>
                    {visibleEnrollments.map((enrollment) => {
                      const color = getClassGroupInfoForRecord({
                        name: enrollment.class_name,
                        class_category: enrollment.class_category,
                        grade_level: enrollment.class_grade_level,
                      } as ClassResponse).color;
                      return (
                        <span
                          key={enrollment.id}
                          className="inline-flex h-7 select-text items-center rounded-md border px-2 text-[13px] font-semibold"
                          style={{
                            backgroundColor: color.background,
                            borderColor: color.border,
                            color: color.text,
                          }}
                        >
                          {enrollment.class_name}
                        </span>
                      );
                    })}
                    {remainingEnrollmentCount > 0 ? (
                      <span className="inline-flex h-7 items-center rounded-md border border-gray-200 bg-white px-2 text-[13px] font-medium text-gray-600">
                        +{remainingEnrollmentCount} lớp
                      </span>
                    ) : null}
                  </>
                ) : (
                  !isInitialAssignment ? <p className="text-sm text-gray-500">Chưa có lớp.</p> : null
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="ml-auto h-7 shrink-0 rounded-md bg-white px-2.5 text-[13px] font-medium"
                onClick={onTransferOpen}
                aria-label={isInitialAssignment ? "Xếp lớp lần đầu cho học viên" : "Thiết lập lớp đang học"}
                aria-haspopup="dialog"
              >
                {isInitialAssignment ? "Xếp lớp" : "Thiết lập"}
              </Button>
            </div>
            {transferSummary ? (
              <p className="mt-1.5 break-words text-xs text-gray-500">{transferSummary}</p>
            ) : null}
          </div>

          {sortedEnrollments.length > 0 ? (
            <div className="grid gap-2">
              {sortedEnrollments.map((enrollment) => {
                const enrollmentDraft = enrollmentFees[enrollment.id];
                const value = enrollmentDraft
                  ? enrollmentDraft.enrollment_date
                  : enrollment.enrollment_date;
                const class_ = classes.find((item) => item.id === enrollment.class_id) ?? null;
                const isPrimary = enrollment.class_id === currentClassId;

                const isDateChanged = Boolean(
                  enrollmentDraft &&
                  comparableManualDate(enrollmentDraft.enrollment_date, enrollment.enrollment_date) !== (enrollment.enrollment_date ?? null),
                );
                const impact = dateReviewImpacts?.[enrollment.id];
                const isLoadingImpact = impact?.isLoading ?? false;
                const hasProtectedFees = impact?.hasProtectedFees ?? false;
                const chosen = chosenDateDecisions?.[enrollment.id];

                // Compute exact old and new billing cycle range for helper text
                const keepOpt = impact?.impact?.decisions?.find((d) => d.decision_code === "KEEP_EXISTING_SCHEDULE");
                let oldCycleStr: string | null = null;
                if (keepOpt?.coverage_start && keepOpt?.coverage_end) {
                  oldCycleStr = `${formatDate(keepOpt.coverage_start)} → ${formatDate(keepOpt.coverage_end)}`;
                } else if (enrollment.enrollment_date && isValidIsoDate(enrollment.enrollment_date)) {
                  const dEnd = new Date(enrollment.enrollment_date);
                  dEnd.setMonth(dEnd.getMonth() + 1);
                  dEnd.setDate(dEnd.getDate() - 1);
                  oldCycleStr = `${formatDate(enrollment.enrollment_date)} → ${formatDate(dEnd.toISOString().slice(0, 10))}`;
                }

                const activeCode = chosen?.decisionCode || impact?.impact?.recommended_decision || "REANCHOR_CURRENT_CYCLE";
                const activeOpt =
                  impact?.impact?.decisions?.find((d) => d.decision_code === activeCode) ||
                  impact?.impact?.decisions?.find((d) => d.decision_code === "REANCHOR_CURRENT_CYCLE") ||
                  impact?.impact?.decisions?.[0];

                let newCycleStr: string | null = null;
                if (activeOpt?.coverage_start && activeOpt?.coverage_end) {
                  newCycleStr = `${formatDate(activeOpt.coverage_start)} → ${formatDate(activeOpt.coverage_end)}`;
                } else if (value && isValidIsoDate(value)) {
                  const dEnd = new Date(value);
                  dEnd.setMonth(dEnd.getMonth() + 1);
                  dEnd.setDate(dEnd.getDate() - 1);
                  newCycleStr = `${formatDate(value)} → ${formatDate(dEnd.toISOString().slice(0, 10))}`;
                }

                return (
                  <div key={enrollment.id} className="rounded-md border border-gray-200 bg-white p-2.5 pb-3.5">
                    <FormField
                      label="Ngày bắt đầu"
                      labelId={`enrollment-date-${enrollment.id}-label`}
                      error={invalidEnrollmentDateIds.has(enrollment.id) ? "Ngày bắt đầu không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy." : undefined}
                      errorId={`enrollment-date-${enrollment.id}-error`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <ManualDateInput
                              id={`enrollment-date-${enrollment.id}`}
                              value={value}
                              onChange={(nextValue) => onEnrollmentDateChange(enrollment.id, nextValue)}
                              onBlur={() => onEnrollmentDateBlur(enrollment.id)}
                              ariaLabel={`Ngày bắt đầu lớp ${enrollment.class_name}`}
                              ariaDescribedBy={invalidEnrollmentDateIds.has(enrollment.id) ? `enrollment-date-${enrollment.id}-error` : undefined}
                              error={invalidEnrollmentDateIds.has(enrollment.id)}
                            />

                            {isDateChanged && !isLoadingImpact ? (
                              !hasProtectedFees ? (
                                <p className="helper-text text-gray-600">
                                  {oldCycleStr && newCycleStr
                                    ? `Kỳ thu: Đổi từ kỳ cũ (${oldCycleStr}) sang kỳ mới (${newCycleStr})`
                                    : newCycleStr
                                      ? `Kỳ thu: Áp dụng kỳ mới (${newCycleStr})`
                                      : "Kỳ thu: Cập nhật theo ngày bắt đầu mới"}
                                </p>
                              ) : chosen ? (
                                <p className="helper-text font-medium text-primary">
                                  {chosen.decisionCode === "KEEP_CURRENT_THEN_REANCHOR" && oldCycleStr
                                    ? `Kỳ thu: Thu nốt kỳ cũ (${oldCycleStr}), kỳ mới áp dụng từ ${formatDate(activeOpt?.coverage_start)}`
                                    : chosen.decisionCode === "REANCHOR_CURRENT_CYCLE" && oldCycleStr && newCycleStr
                                      ? `Kỳ thu: Bỏ qua kỳ cũ (${oldCycleStr}), đổi sang kỳ mới (${newCycleStr})`
                                      : chosen.decisionCode === "KEEP_EXISTING_SCHEDULE" && oldCycleStr
                                        ? `Kỳ thu: Giữ nguyên lịch thu kỳ cũ (${oldCycleStr})`
                                        : `Kỳ thu: ${DECISION_STRATEGIES[chosen.decisionCode as keyof typeof DECISION_STRATEGIES] || chosen.decisionCode}`}
                                </p>
                              ) : (
                                <p className="helper-text text-amber-700">
                                  {oldCycleStr
                                    ? `Kỳ hiện tại (${oldCycleStr}) đã báo phụ huynh. Vui lòng bấm "Xử lý kỳ thu" để chọn cách xử lý.`
                                    : 'Kỳ hiện tại đã báo phụ huynh. Vui lòng bấm "Xử lý kỳ thu" để chọn cách xử lý.'}
                                </p>
                              )
                            ) : null}
                          </div>

                          {isDateChanged ? (
                            isLoadingImpact ? (
                              <span className="form-input-text inline-flex h-8 shrink-0 select-none items-center justify-center rounded-md border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-500">
                                <LoadingLabel label="Đang kiểm tra" />
                              </span>
                            ) : !hasProtectedFees ? (
                              <button
                                type="button"
                                onClick={() => onOpenStartDateReview?.(enrollment.id)}
                                className="form-input-text inline-flex h-8 shrink-0 select-none items-center justify-center rounded-md border border-primary/30 bg-white px-3 text-sm font-medium text-primary transition hover:border-primary/60 hover:bg-primary-soft/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/20"
                              >
                                {chosen ? "Đổi cách xử lý" : "Áp dụng"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onOpenStartDateReview?.(enrollment.id)}
                                className="form-input-text inline-flex h-8 shrink-0 select-none items-center justify-center rounded-md border border-primary/30 bg-white px-3 text-sm font-medium text-primary transition hover:border-primary/60 hover:bg-primary-soft/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/20"
                              >
                                {chosen ? "Đổi cách xử lý" : "Xử lý kỳ thu"}
                              </button>
                            )
                          ) : null}
                        </div>
                      </div>
                    </FormField>
                    <SessionSelector
                      class_={class_}
                      selectedSlotIds={enrollmentFees[enrollment.id]?.selected_slot_ids ?? enrollment.selected_slot_ids}
                      onChange={(slotIds) => onEnrollmentSlotsChange(enrollment.id, slotIds)}
                      customFee={enrollmentFees[enrollment.id]?.custom_fee ?? null}
                      onApplySuggestedFee={(fee) => onEnrollmentCustomFeeChange(enrollment.id, fee)}
                    />
                    {!isPrimary ? (
                      <SmartMoneyInput
                        value={enrollmentFees[enrollment.id]?.custom_fee ?? null}
                        onChange={(fee) => onEnrollmentCustomFeeChange(enrollment.id, fee)}
                        placeholder="Học phí riêng (nếu có)"
                        className="mt-2 px-2.5"
                      />
                    ) : null}
                    </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function toStudentPayload(values: StudentFormValues) {
  return {
    full_name: values.full_name.trim(),
    birth_date: values.birth_date,
    school: normalizeOptionalText(values.school),
    parent_phone: normalizeOptionalText(values.parent_phone),
    parent_zalo: normalizeOptionalText(values.parent_zalo),
    student_phone: normalizeOptionalText(values.student_phone),
    student_zalo: normalizeOptionalText(values.student_zalo),
    notes: normalizeOptionalText(values.notes),
    hidden_fields: values.hidden_fields,
  };
}

function normalizedStudentFormKey(values: StudentFormValues) {
  return JSON.stringify({
    full_name: values.full_name.trim(),
    birth_date: values.birth_date || null,
    school: normalizeOptionalText(values.school),
    parent_phone: normalizeOptionalText(values.parent_phone),
    parent_zalo: normalizeOptionalText(values.parent_zalo),
    student_phone: normalizeOptionalText(values.student_phone),
    student_zalo: normalizeOptionalText(values.student_zalo),
    notes: normalizeOptionalText(values.notes),
    hidden_fields: [...values.hidden_fields].sort(),
  });
}

function normalizedStudentCreateFormKey(values: StudentFormValues) {
  return JSON.stringify({
    student: normalizedStudentFormKey(values),
    custom_fee: values.custom_fee ?? null,
    enrollment_date: values.enrollment_date || null,
  });
}

function normalizedSlotIdsKey(slotIds: string[]) {
  return [...new Set(slotIds)].sort().join("|");
}

function toStudentCreatePayload(
  values: StudentFormValues,
  classId: string | null,
  selectedSlotIds: string[],
) {
  const profile = {
    ...toStudentPayload(values),
    birth_date: values.birth_date ?? "",
    school: values.school?.trim() ?? "",
    parent_phone: normalizeOptionalText(values.parent_phone) ?? "",
    parent_zalo: normalizeOptionalText(values.parent_zalo) ?? "",
  };
  if (!classId) {
    return profile;
  }
  return {
    ...profile,
    class_id: classId,
    custom_fee: values.custom_fee,
    enrollment_date: values.enrollment_date || getTodayInputValue(),
    selected_slot_ids: selectedSlotIds,
  };
}

function getTodayInputValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getDefaultEnrollmentDate(class_: ClassResponse | null) {
  const today = getTodayInputValue();
  return class_?.start_date && class_.start_date > today ? class_.start_date : today;
}

function isValidBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    year >= 1900 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getTime() <= todayUtc
  );
}

function normalizeOptionalText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parsePhoneInput(value: string) {
  return value.replace(/\D/g, "");
}



function normalizeVietnamPhone(value: string) {
  const digitsOnly = parsePhoneInput(value);
  if (!digitsOnly) {
    return "";
  }

  if (digitsOnly.startsWith("84")) {
    return `0${digitsOnly.slice(2)}`;
  }

  return digitsOnly;
}

function isValidVietnamMobilePhone(value: string) {
  const normalized = normalizeVietnamPhone(value);
  return /^0(?:3|5|7|8|9)\d{8}$/.test(normalized);
}

function getEnrollmentDateForClass(student: StudentResponse, classId: string) {
  return (
    student.active_enrollments.find((enrollment) => enrollment.class_id === classId)?.enrollment_date ?? null
  );
}

function getEnrollmentCustomFeeForClass(student: StudentResponse, classId: string) {
  return student.active_enrollments.find((enrollment) => enrollment.class_id === classId)?.custom_fee ?? null;
}

function getOtherClassesText(student: StudentResponse, currentClassId: string) {
  const otherClasses = student.active_enrollments
    .filter((enrollment) => enrollment.class_id !== currentClassId)
    .map((enrollment) => enrollment.class_name)
    .sort((left, right) => {
      const [leftGroupSort, leftNameSort] = getClassSortKey(left);
      const [rightGroupSort, rightNameSort] = getClassSortKey(right);

      if (leftGroupSort !== rightGroupSort) {
        return leftGroupSort - rightGroupSort;
      }

      return leftNameSort.localeCompare(rightNameSort, "vi");
    });

  return otherClasses.length > 0 ? otherClasses.join(", ") : null;
}

async function exportStudents(students: StudentResponse[], selectedClass: ClassResponse) {
  const rows = students.map((student) => {
    const studentContact = getCompleteContactPair(student.student_zalo, student.student_phone);
    const parentContact = getCompleteContactPair(student.parent_zalo, student.parent_phone);

    return {
      "Mã học viên": formatStudentCode(student.student_code),
      "Họ tên": student.full_name,
      "Ngày sinh": getStudentExportValue(
        student,
        "birth_date",
        student.birth_date ? formatDate(student.birth_date) : "",
      ),
      Trường: getStudentExportValue(student, "school", student.school ?? ""),
      "Ngày bắt đầu": formatDate(getEnrollmentDateForClass(student, selectedClass.id)),
      "Học phí riêng": getEnrollmentCustomFeeForClass(student, selectedClass.id) ?? "",
      "Lớp khác": getOtherClassesText(student, selectedClass.id) ?? "",
      "Zalo học sinh": getStudentExportValue(student, "student_contact", studentContact?.zalo ?? ""),
      "SĐT học sinh": getStudentExportValue(student, "student_contact", studentContact?.phone ?? ""),
      "Zalo phụ huynh": getStudentExportValue(student, "parent_contact", parentContact?.zalo ?? ""),
      "SĐT phụ huynh": getStudentExportValue(student, "parent_contact", parentContact?.phone ?? ""),
      "Ghi chú": getStudentExportValue(student, "notes", student.notes ?? ""),
      "Lớp đang học": student.classes.map((class_) => class_.name).join(", "),
    };
  });
  await exportExcelWorkbook([{
    name: "Hoc vien",
    title: "TPRO English · Danh sách học viên",
    description: `Lớp ${selectedClass.name} · ${rows.length} học viên đang xem`,
    rows,
  }], `HocVien_${sanitizeExcelFileName(selectedClass.name)}_${getCurrentMonthKey()}.xlsx`);
}

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrencyVnd(value: number) {
  return `${value.toLocaleString("vi-VN")}đ`;
}

function sortClassesForSelection(classes: ClassResponse[]) {
  return [...classes].sort((a, b) => {
    const [gradeA, nameA] = getClassSortKey(a.name);
    const [gradeB, nameB] = getClassSortKey(b.name);

    if (gradeA !== gradeB) {
      return gradeA - gradeB;
    }

    return nameA.localeCompare(nameB, "vi");
  });
}

const inputClassName = `${formTextControlClassName} select-text`;
const numberInputClassName =
  cn(
    formTextControlClassName,
    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
  );

function getFormInputClass(hasError: boolean) {
  return cn(inputClassName, hasError && formTextControlErrorClassName);
}

function getNumberInputClass(hasError: boolean) {
  return cn(numberInputClassName, hasError && formTextControlErrorClassName);
}
