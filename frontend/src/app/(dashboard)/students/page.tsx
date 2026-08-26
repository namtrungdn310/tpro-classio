"use client";

import dynamic from "next/dynamic";
import { startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  RiArrowLeftLine as ArrowLeft,
  RiEyeLine as Eye,
  RiEyeOffLine as EyeOff,
  RiLoader4Line as LoaderCircle,
  RiAddLine as Plus,
  RiSearchLine as SearchX,
  RiTeamLine as UsersRound,
} from "react-icons/ri";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { SplitTextField } from "@/components/ui/split-text-field";
import { FormNotice } from "@/components/ui/form-notice";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { ClassSelectionView } from "@/components/students/class-selection-view";
import { StudentReactivationSlide } from "@/components/students/student-reactivation-slide";
import { StudentWorkspaceDialog } from "@/components/students/student-workspace-dialog";
import {
  StudentClassDetailSkeleton,
  StudentTableSkeleton,
  StudentsRouteSkeleton,
} from "@/components/students/students-route-skeleton";
import {
  STUDENTS_TABLE_GRID_CLASS,
  STUDENTS_TABLE_VIEWER_GRID_CLASS,
} from "@/components/students/students-table-layout";
import { getClasses } from "@/lib/api/classes";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { invalidateDomainQueries } from "@/lib/query/invalidation";
import { getApiErrorMessage } from "@/lib/api/errors";
import { exportExcelWorkbook, sanitizeExcelFileName } from "@/lib/excel/workbook";
import { useClickableRowProps } from "@/lib/ui/click-guard";
import {
  createStudent,
  dropEnrollment,
  archiveStudent,
  applyStudentMembershipCommand,
  getStudent,
  getStudentScopeSummary,
  getStudentIdentityConflict,
  getStudentsPage,
  reactivateStudent,
  restoreStudent,
} from "@/lib/api/students";
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
  StudentResponse,
  StudentListPageResponse,
  StudentListState,
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

const DatePickerSlide = dynamic(
  () =>
    import("@/components/layout/date-picker-slide").then(
      (module) => module.DatePickerSlide,
    ),
  { ssr: false },
);

type EnrollmentActionMode = "transfer" | "supplement";
type EnrollmentTargetConfig = {
  class_id: string;
  custom_fee: number | null;
  selected_slot_ids: string[];
};
type EnrollmentActionPlan = {
  mode: EnrollmentActionMode;
  targetClassIds: string[];
  targetConfigs: Record<string, EnrollmentTargetConfig>;
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
  enrollment_date: z.string().optional(),
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
  const view: StudentView = STUDENT_VIEWS.some((item) => item.value === requestedView)
    ? (requestedView as StudentView)
    : "class";
  const activeView = STUDENT_VIEWS.find((item) => item.value === view) ?? STUDENT_VIEWS[0];
  const [classType, setClassType] = useState<ClassType | "">("");
  const [classDuration, setClassDuration] = useState("");
  const classId = getSelectedStudentClassFromSearchParams(
    new URLSearchParams(searchParams.toString()),
  );
  const [workspaceStudent, setWorkspaceStudent] = useState<StudentResponse | null>(null);
  const requestedStudentId = searchParams.get("student_id");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [pendingIdentityConflict, setPendingIdentityConflict] =
    useState<PendingStudentIdentityConflict | null>(null);
  const [isExportingStudents, setIsExportingStudents] = useState(false);
  const notify = useToast();

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
      startTransition(() => router.replace(nextHref, { scroll: false }));
    },
    [router, searchParams, setSearch, user?.id],
  );

  const updateView = useCallback((nextView: StudentView) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", nextView);
    if (nextView !== "class") params.delete("class_id");
    setSearch("");
    startTransition(() => router.replace(`/students?${params.toString()}`, { scroll: false }));
  }, [router, searchParams, setSearch]);

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
    staleTime: 30_000,
  });

  const scopeSummaryQuery = useQuery({
    queryKey: studentQueryKeys.summary(),
    queryFn: ({ signal }) => getStudentScopeSummary(signal),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const requestedStudentQuery = useQuery({
    queryKey: studentQueryKeys.detail(requestedStudentId),
    queryFn: ({ signal }) => getStudent(requestedStudentId!, signal),
    enabled: Boolean(user && requestedStudentId),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (requestedStudentQuery.data) {
      setWorkspaceStudent(requestedStudentQuery.data);
    }
  }, [requestedStudentQuery.data]);

  const openStudentWorkspace = useCallback((student: StudentResponse) => {
    setWorkspaceStudent(student);
    const params = new URLSearchParams(searchParams.toString());
    params.set("student_id", student.id);
    queryClient.setQueryData(studentQueryKeys.detail(student.id), student);
    startTransition(() => router.replace(`/students?${params.toString()}`, { scroll: false }));
  }, [queryClient, router, searchParams]);

  const closeStudentWorkspace = useCallback(() => {
    setWorkspaceStudent(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("student_id");
    const query = params.toString();
    startTransition(() => router.replace(query ? `/students?${query}` : "/students", { scroll: false }));
  }, [router, searchParams]);

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
      const enrollmentUpdates = activeEnrollments.flatMap((enrollment) => {
        const billingValues = enrollmentFees[enrollment.id];
        if (!billingValues) {
          return [];
        }
        const payload: { custom_fee?: number | null; enrollment_date?: string | null; selected_slot_ids?: string[] } = {};
        if (billingValues.custom_fee !== enrollment.custom_fee) {
          payload.custom_fee = billingValues.custom_fee;
        }
        if (billingValues.enrollment_date !== enrollment.enrollment_date) {
          payload.enrollment_date = billingValues.enrollment_date;
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
      const updatedStudent = await applyStudentMembershipCommand(id, {
        request_id: crypto.randomUUID(),
        expected_updated_at: workspaceStudent?.updated_at ?? "",
        profile: toStudentPayload(values),
        enrollment_updates: enrollmentUpdates,
        targets: enrollmentActionPlan.targetClassIds.map((class_id) => ({
          class_id,
          custom_fee: enrollmentActionPlan.targetConfigs[class_id]?.custom_fee ?? null,
          selected_slot_ids: enrollmentActionPlan.targetConfigs[class_id]?.selected_slot_ids ?? null,
        })),
        mode: enrollmentActionPlan.mode,
        source_enrollment_id: sourceEnrollment?.id ?? null,
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

      return {
        updatedStudent,
        message,
        affectsEnrollment:
          enrollmentUpdates.length > 0 ||
          enrollmentActionPlan.targetClassIds.length > 0 ||
          enrollmentActionPlan.mode === "transfer",
      };
    },
    onSuccess: ({ updatedStudent, message, affectsEnrollment }) => {
      setWorkspaceStudent((current) => (current?.id === updatedStudent.id ? updatedStudent : current));
      notify.success(`${message}.`);

      void invalidateStudentDependencies({
        affectsClasses: affectsEnrollment,
        affectsFees: affectsEnrollment,
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
    mutationFn: ({ id, reason }: { id: string; reason: string }) => restoreStudent(id, reason),
    onSuccess: (student) => {
      closeStudentWorkspace();
      notify.success(`Đã tiếp nhận lại hồ sơ ${student.full_name}.`);
      void invalidateStudentDependencies();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, "Không thể tiếp nhận lại hồ sơ. Vui lòng thử lại.")),
  });

  async function invalidateStudentDependencies({
    affectsClasses = false,
    affectsFees = false,
  }: {
    affectsClasses?: boolean;
    affectsFees?: boolean;
  } = {}) {
    await invalidateDomainQueries(queryClient, {
      students: true,
      classes: affectsClasses,
      fees: affectsFees,
      dashboard: true,
    });
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
  const hasSearch = Boolean(search.trim());
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

  return (
    <div className="flex flex-col gap-4 overflow-x-hidden md:h-full md:overflow-hidden">
      <StudentScopeTabs
        activeView={view}
        summary={scopeSummaryQuery.data}
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
          isRefreshing={classesQuery.isFetching}
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
              staleTime: 30_000,
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

      {view === "class" && isResolvingSelectedClass ? <StudentClassDetailSkeleton isAdmin={isAdmin} /> : null}

      {view === "class" && selectedClass ? (
        <>
          <HeaderControlsPortal>
            <div className="flex min-w-0 items-center gap-2">
              <HeaderFilterControls
                searchPlaceholder={`Tìm học viên trong ${selectedClass.name}...`}
                searchValue={search}
                onSearchChange={setSearch}
                filters={[]}
              />
              <StudentListStatus
                filteredCount={students.length}
                isRefreshing={studentsQuery.isFetching}
                totalCount={totalStudentCount}
              />
              {isAdmin ? <AddStudentButton onClick={openCreateForm} /> : null}
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

          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <HeaderFilterControls
              searchPlaceholder={`Tìm học viên trong ${selectedClass.name}...`}
              searchValue={search}
              onSearchChange={setSearch}
              filters={[]}
            />
            <StudentListStatus
              filteredCount={students.length}
              isRefreshing={studentsQuery.isFetching}
              totalCount={totalStudentCount}
            />
            {isAdmin ? <AddStudentButton compact onClick={openCreateForm} /> : null}
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
              ) : hasSearch && totalStudentCount > 0 ? (
                <DataSectionEmpty
                  className="md:h-full"
                  icon={SearchX}
                  title="Không tìm thấy học viên phù hợp"
                  description="Thử tìm bằng họ tên, trường, số điện thoại hoặc tên Zalo khác."
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
          isAdmin={isAdmin}
          isLoading={studentsQuery.isLoading && !hasStudentQueryData}
          isRefreshing={studentsQuery.isFetching}
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
          onRestore={(reason) => restoreMutation.mutate({ id: workspaceStudent.id, reason })}
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
  summary,
  onChange,
}: {
  activeView: StudentView;
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
              {count !== undefined ? (
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
        <div className="flex min-w-0 items-center gap-2">
          <HeaderFilterControls
            searchPlaceholder="Tìm tên, mã học viên, SĐT..."
            searchValue={search}
            onSearchChange={onSearchChange}
            filters={[]}
          />
          <StudentListStatus filteredCount={students.length} totalCount={students.length} isRefreshing={isRefreshing} />
          {isAdmin && view === "unassigned" ? <AddStudentButton label="Thêm hồ sơ" onClick={onCreate} /> : null}
        </div>
      </HeaderControlsPortal>

      <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold text-gray-950">{labels.title}</h1>
          <p className="mt-0.5 text-sm text-gray-500">Mã học viên được giữ nguyên trong suốt quá trình học.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? <StudentTableSkeleton isAdmin={isAdmin} /> : null}
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
            title={search.trim() ? "Không tìm thấy học viên phù hợp" : labels.empty}
            description={search.trim() ? "Thử tìm bằng tên, mã học viên hoặc số điện thoại khác." : "Danh sách sẽ tự cập nhật khi trạng thái hồ sơ thay đổi."}
            {...(search.trim() ? { actionLabel: "Xóa từ khóa tìm kiếm", onAction: () => onSearchChange("") } : {})}
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

function StudentProfileTable({ students, view, isAdmin, onOpen }: {
  students: StudentResponse[];
  view: Exclude<StudentView, "class">;
  isAdmin: boolean;
  onOpen: (student: StudentResponse) => void;
}) {
  return (
    <div className="scrollbar-hidden h-full overflow-auto rounded-xl border border-gray-200 bg-white">
      <div role="table" aria-label="Danh sách hồ sơ học viên" className="min-w-[920px]">
        <div role="row" className="grid grid-cols-[180px_minmax(210px,1.2fr)_150px_minmax(180px,1fr)_minmax(230px,1.2fr)] border-b border-gray-200 bg-gray-50 text-sm font-semibold text-gray-700">
          <div role="columnheader" className="px-4 py-3">Mã HV</div>
          <div role="columnheader" className="px-3 py-3">Họ tên</div>
          <div role="columnheader" className="px-3 py-3">Ngày sinh</div>
          <div role="columnheader" className="px-3 py-3">Trường</div>
          <div role="columnheader" className="px-3 py-3">{view === "stopped" ? "Thông tin ngừng học" : "Liên hệ / lớp gần nhất"}</div>
        </div>
        {students.map((student) => (
          <div
            key={student.id}
            role="row"
            tabIndex={isAdmin ? 0 : undefined}
            onClick={isAdmin ? () => onOpen(student) : undefined}
            onKeyDown={isAdmin ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(student);
              }
            } : undefined}
            className={cn("grid grid-cols-[180px_minmax(210px,1.2fr)_150px_minmax(180px,1fr)_minmax(230px,1.2fr)] border-b border-gray-100 text-[15px] text-gray-700 last:border-b-0", isAdmin && "cursor-pointer hover:bg-primary/[0.035]")}
          >
            <div role="cell" className="px-4 py-3 font-semibold tabular-nums text-primary">{formatStudentCode(student.student_code)}</div>
            <div role="cell" className="px-3 py-3 font-semibold text-gray-950">{student.full_name}</div>
            <div role="cell" className="px-3 py-3">{formatDate(student.birth_date)}</div>
            <div role="cell" className="px-3 py-3">{student.school || "—"}</div>
            <div role="cell" className="px-3 py-3">
              {view === "stopped"
                ? <><span>{formatDate(student.archived_at?.slice(0, 10) ?? null)}</span>{student.archived_reason ? <span className="ml-2 text-gray-500">· {student.archived_reason}</span> : null}</>
                : student.last_enrollment
                  ? <><span className="font-medium text-gray-900">{student.last_enrollment.class_name}</span>{student.last_enrollment.ended_at ? <span className="ml-2 text-gray-500">· {formatDate(student.last_enrollment.ended_at.slice(0, 10))}</span> : null}</>
                  : formatContactCell(student, "parent_contact", student.parent_zalo, student.parent_phone)}
            </div>
          </div>
        ))}
      </div>
    </div>
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
  isRefreshing,
  totalCount,
}: {
  filteredCount: number;
  isRefreshing: boolean;
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
      {isRefreshing ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-gray-400" aria-hidden="true" />
      ) : (
        <span
          className={`h-2 w-2 rounded-full ${totalCount > 0 ? "bg-emerald-500" : "bg-gray-300"}`}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
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

  const isHidden = isStudentFieldHidden(student, "custom_fee");

  return (
    <div
      className={`mt-0.5 min-w-0 text-[13px] font-medium leading-4 text-gray-500 ${
        isHidden
          ? "flex select-none items-center gap-1"
          : "text-selection-scope text-selection-scope--inline"
      }`}
      data-text-selection-scope={isHidden ? undefined : "true"}
    >
      {isHidden ? (
        <>
          <span className="shrink-0">Học phí:</span>
          <HiddenStudentValue />
        </>
      ) : (
        <span className="text-selection-value" data-text-selection-value="true">
          Học phí: {formatCurrencyVnd(customFee)}
        </span>
      )}
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
  const [inputValue, setInputValue] = useState("");
  const lastSyncedValue = useRef<string | null>(null);

  useEffect(() => {
    if (value !== lastSyncedValue.current) {
      lastSyncedValue.current = value;
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split("-");
        setInputValue(`${d}/${m}/${y}`);
      } else {
        setInputValue("");
      }
    }
  }, [value]);

  const formatAsDate = (raw: string): string => {
    const clean = raw.replace(/\D/g, "");
    let formatted = "";
    if (clean.length > 0) {
      formatted += clean.slice(0, 2);
    }
    if (clean.length > 2) {
      formatted += "/" + clean.slice(2, 4);
    }
    if (clean.length > 4) {
      formatted += "/" + clean.slice(4, 8);
    }
    return formatted;
  };

  const updateParent = (val: string) => {
    const parts = val.split("/");
    if (parts.length === 3) {
      const d = parts[0];
      const m = parts[1];
      const y = parts[2];
      if (d.length === 2 && m.length === 2 && y.length === 4) {
        const id = parseInt(d, 10);
        const im = parseInt(m, 10);
        const iy = parseInt(y, 10);
        const formattedDate = `${iy}-${String(im).padStart(2, "0")}-${String(id).padStart(2, "0")}`;
        if (isValidBirthDate(formattedDate)) {
          lastSyncedValue.current = formattedDate;
          onChange(formattedDate);
          return;
        }
      }
    }
    const pendingValue = val.trim() ? val : null;
    lastSyncedValue.current = pendingValue;
    onChange(pendingValue);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatAsDate(e.target.value);
    setInputValue(formatted);
    updateParent(formatted);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (e.key === "Backspace") {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start === end && start !== null && start > 0) {
        const textBefore = el.value.slice(0, start);
        let charsToDelete = 0;
        if (textBefore.endsWith("/")) {
          charsToDelete = 2;
        }

        if (charsToDelete > 0) {
          e.preventDefault();
          const newValue = el.value.slice(0, start - charsToDelete) + el.value.slice(start);
          const clean = newValue.replace(/\D/g, "");
          const formatted = formatAsDate(clean);
          setInputValue(formatted);
          const newCursorPos = Math.max(0, start - charsToDelete);
          setTimeout(() => {
            el.setSelectionRange(newCursorPos, newCursorPos);
          }, 0);
          updateParent(formatted);
        }
      }
    }
  };

  const guideTemplate = "dd/mm/yyyy";

  const renderGuideText = () => {
    const elements: React.ReactNode[] = [];
    if (inputValue.length > 0) {
      elements.push(
        <span key="prefix" className="text-transparent select-none" aria-hidden="true">
          {inputValue}
        </span>
      );
    }
    for (let i = inputValue.length; i < guideTemplate.length; i++) {
      const char = guideTemplate[i];
      if (char === "/") {
        elements.push(
          <span key={`char-${i}`} className="text-gray-300 font-normal select-none" aria-hidden="true">
            /
          </span>
        );
      } else {
        elements.push(
          <span key={`char-${i}`} className="text-gray-300 font-normal select-none" aria-hidden="true">
            {char}
          </span>
        );
      }
    }
    return elements;
  };

  return (
    <div>
      <FormField controlId="student-birth-date" label="Ngày sinh" error={error} errorId="student-birth-date-error">
        <div
          className={`relative flex h-8 w-full items-center rounded-md border bg-white px-3 transition-shadow focus-within:ring-2 ${error ? "border-destructive focus-within:border-destructive focus-within:ring-destructive/15" : "border-gray-200 focus-within:border-primary/60 focus-within:ring-primary/15"}`}
          style={{ paddingRight: privacyToggle ? "2.5rem" : undefined }}
        >
          <div className={`form-input-text pointer-events-none absolute left-3 flex items-center whitespace-pre text-left ${privacyToggle ? "right-10" : "right-3"}`}>
            {renderGuideText()}
          </div>
        <input
          type="text"
          id="student-birth-date"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "student-birth-date-error" : undefined}
          maxLength={14}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          autoComplete={savedInfoAutocomplete.disabled}
          data-row={dataRow}
          data-col={dataCol}
          data-private-hidden={isContentHidden}
          className="form-input-text z-10 h-full w-full select-text bg-transparent text-left text-gray-900 outline-none"
        />
          {privacyToggle ? (
            <div className="absolute inset-y-0 right-1 z-20 flex items-center">{privacyToggle}</div>
          ) : null}
      </div>
      </FormField>
    </div>
  );
}

function ContactFields({
  phoneKey,
  zaloPlaceholder,
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
          className={`relative h-8 rounded-md border bg-white transition-shadow focus-within:ring-2 ${error ? "border-destructive focus-within:border-destructive focus-within:ring-destructive/15" : "border-gray-200 focus-within:border-primary/60 focus-within:ring-primary/15"}`}
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
                  : `SĐT ${zaloPlaceholder.replace("Zalo ", "")} (nếu có)`
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
      label="Liên hệ học viên"
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
      label="Liên hệ phụ huynh"
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
            {isStudentFieldHidden(student, "enrollment_date")
              ? <HiddenStudentValue />
              : <SelectableStudentValue value={formatDate(getEnrollmentDateForClass(student, currentClassId))} />}
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
        {isStudentFieldHidden(student, "enrollment_date")
          ? <HiddenStudentValue />
          : <SelectableStudentValue value={formatDate(getEnrollmentDateForClass(student, currentClassId))} />}
      </div>
      <div role="cell" className="min-w-0 py-3 pl-4 pr-2.5">{formatContactCell(student, "student_contact", student.student_zalo, student.student_phone)}</div>
      <div role="cell" className="min-w-0 px-2.5 py-3">{formatContactCell(student, "parent_contact", student.parent_zalo, student.parent_phone)}</div>
      <div role="cell" className="min-w-0 break-words px-2.5 py-3 text-gray-700">
        {isStudentFieldHidden(student, "notes") ? <HiddenStudentValue /> : <SelectableStudentValue value={student.notes} />}
      </div>
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
  const [mounted, setMounted] = useState(false);
  const [enrollmentFees, setEnrollmentFees] = useState<EnrollmentFeeValues>({});
  const [enrollmentFeeDraftError, setEnrollmentFeeDraftError] = useState("");
  const [enrollmentActionMode, setEnrollmentActionMode] =
    useState<EnrollmentActionMode>("supplement");
  const [transferTargetClassIds, setTransferTargetClassIds] = useState<string[]>([]);
  const [draftEnrollmentActionMode, setDraftEnrollmentActionMode] =
    useState<EnrollmentActionMode>("supplement");
  const [draftTransferTargetClassIds, setDraftTransferTargetClassIds] = useState<string[]>([]);
  const [targetEnrollmentConfigs, setTargetEnrollmentConfigs] = useState<Record<string, EnrollmentTargetConfig>>({});
  const [draftTargetEnrollmentConfigs, setDraftTargetEnrollmentConfigs] = useState<Record<string, EnrollmentTargetConfig>>({});
  const [transferError, setTransferError] = useState("");
  const [isEnrollmentTransferOpen, setIsEnrollmentTransferOpen] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<"initial" | `enrollment:${string}` | null>(null);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const currentClass = useMemo(
    () => classes.find((class_) => class_.id === currentClassId) ?? null,
    [classes, currentClassId],
  );
  const isStandaloneProfileCreate = student === null && currentClassId === null;
  const initialCreateFormKeyRef = useRef(normalizedStudentCreateFormKey(defaultStudentValues));

  useEffect(() => {
    setMounted(true);
  }, []);

  // R6-D09: mặc định chọn toàn bộ buổi của lớp khi mở form tạo (bắt user review).
  useEffect(() => {
    if (student) return;
    const defaultSlotIds =
      currentClass?.schedule?.slots
        ?.filter((slot) => slot.id)
        .map((slot) => slot.id as string) ?? [];
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
          hidden_fields: student.hidden_fields ?? [],
          custom_fee: null,
          enrollment_date: getDefaultEnrollmentDate(currentClass),
        }
      : { ...defaultStudentValues, enrollment_date: getDefaultEnrollmentDate(currentClass) };

    if (!student) {
      initialCreateFormKeyRef.current = normalizedStudentCreateFormKey(nextValues);
    }

    reset(nextValues);
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
        student.active_enrollments.map((enrollment) => [
          enrollment.id,
          {
            custom_fee: enrollment.custom_fee,
            enrollment_date: enrollment.enrollment_date,
            selected_slot_ids: enrollment.selected_slot_ids,
          },
        ]),
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
  }, [student]);

  const activeEnrollments = student?.active_enrollments ?? [];
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
        (draft.enrollment_date ?? null) !== (enrollment.enrollment_date ?? null) ||
        [...draft.selected_slot_ids].sort().join("|") !== [...enrollment.selected_slot_ids].sort().join("|")),
    );
  });
  const watchedStudentValues = watch();
  const hasUnsavedChanges = student
    ? normalizedStudentFormKey(watchedStudentValues) !==
        normalizedStudentFormKey({
          full_name: student.full_name,
          birth_date: student.birth_date,
          school: student.school ?? "",
          student_zalo: student.student_zalo ?? "",
          student_phone: student.student_phone ?? "",
          parent_phone: student.parent_phone ?? "",
          parent_zalo: student.parent_zalo ?? "",
          notes: student.notes ?? "",
          hidden_fields: student.hidden_fields ?? [],
          custom_fee: null,
          enrollment_date: getTodayInputValue(),
        }) ||
        hasEnrollmentFeeChanges ||
        transferTargetClassIds.length > 0
    : normalizedStudentCreateFormKey(watchedStudentValues) !== initialCreateFormKeyRef.current;
  const hasStudentFormErrors =
    !studentSchema.safeParse(watchedStudentValues).success ||
    Object.keys(errors).length > 0 ||
    Boolean(enrollmentFeeDraftError);
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
    if (datePickerTarget) {
      setDatePickerTarget(null);
      return;
    }
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
    onNestedOverlayChange?.(isEnrollmentTransferOpen || datePickerTarget !== null);
  }, [datePickerTarget, isEnrollmentTransferOpen, onNestedOverlayChange]);

  if (!mounted) return null;

  const overlayExtra = (
    <>
      {student ? (
        <EnrollmentTransferSlide
          availableClasses={availableTransferClasses}
          currentClassId={currentClassId}
          transferError={transferError}
          isOpen={isEnrollmentTransferOpen}
          mode={draftEnrollmentActionMode}
          selectedClasses={draftSelectedTransferClasses}
          targetConfigs={draftTargetEnrollmentConfigs}
          onAddClass={(classId) => {
            setTransferError("");
            setDraftTransferTargetClassIds((current) =>
              current.includes(classId) ? current : [...current, classId],
            );
            const targetClass = availableTransferClasses.find((class_) => class_.id === classId);
            const slotIds = targetClass?.schedule?.slots?.flatMap((slot) => slot.id ? [slot.id] : []) ?? [];
            setDraftTargetEnrollmentConfigs((current) => ({
              ...current,
              [classId]: current[classId] ?? { class_id: classId, custom_fee: null, selected_slot_ids: slotIds },
            }));
          }}
          onClose={closeEnrollmentTransfer}
          onConfirm={() => {
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
            setEnrollmentActionMode(draftEnrollmentActionMode);
            setTransferTargetClassIds([...draftTransferTargetClassIds]);
            setTargetEnrollmentConfigs(structuredClone(draftTargetEnrollmentConfigs));
            setTransferError("");
            setIsEnrollmentTransferOpen(false);
          }}
          onModeChange={(mode) => {
            setTransferError("");
            setDraftEnrollmentActionMode(mode);
          }}
          onRemoveClass={(classId) =>
            setDraftTransferTargetClassIds((current) => current.filter((id) => id !== classId))
          }
          onUpdateTarget={(config) => setDraftTargetEnrollmentConfigs((current) => ({ ...current, [config.class_id]: config }))}
        />
      ) : null}

      <DatePickerSlide
        isOpen={datePickerTarget !== null}
        onClose={() => setDatePickerTarget(null)}
        currentValue={getDatePickerCurrentValue(datePickerTarget, watch("enrollment_date"), activeEnrollments, enrollmentFees)}
        minDate={getEnrollmentDateBounds(datePickerTarget, currentClass, activeEnrollments).minDate}
        maxDate={getEnrollmentDateBounds(datePickerTarget, currentClass, activeEnrollments).maxDate}
        onSelectDate={(dateStr) => {
          if (datePickerTarget === "initial") {
            markInput("enrollment_date", dateStr);
            setValue("enrollment_date", dateStr, {
              shouldDirty: true,
              shouldValidate: true,
            });
            return;
          }

          if (datePickerTarget?.startsWith("enrollment:")) {
            const enrollmentId = datePickerTarget.slice("enrollment:".length);
            setEnrollmentFees((current) => ({
              ...current,
              [enrollmentId]: {
                ...(current[enrollmentId] ?? { custom_fee: null, enrollment_date: null, selected_slot_ids: [] }),
                enrollment_date: dateStr,
              },
            }));
          }
        }}
      />
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
        if (sessionSelectionError) {
          event.preventDefault();
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
        void handleSubmit((values) => {
          const enrollmentActionPlan: EnrollmentActionPlan = {
            mode: enrollmentActionMode,
            targetClassIds: transferTargetClassIds,
            targetConfigs: targetEnrollmentConfigs,
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

          setTransferError("");
          onSubmit(values, enrollmentFees, enrollmentActionPlan, selectedSlotIds);
        })(event);
      }}
    >
      <FormDialogBody>
        <FormSection label="Hồ sơ học viên" order={1}>
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
            <div className={isStandaloneProfileCreate ? "sm:col-span-2" : undefined}>
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
            <div className={isStandaloneProfileCreate ? "sm:col-start-2 sm:row-start-2" : undefined}>
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
                dataRow={isStandaloneProfileCreate ? 1 : 0}
                dataCol={1}
                privacyToggle={renderPrivacyToggle("birth_date", "Ngày sinh")}
                isContentHidden={hiddenFields.includes("birth_date")}
              />
            </div>
            <div className={isStandaloneProfileCreate ? "sm:col-start-1 sm:row-start-2" : undefined}>
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
                    className={`${numberInputClassName} !pr-10`}
                    dataRow={1}
                    dataCol={1}
                    isContentHidden={hiddenFields.includes("custom_fee")}
                    trailingControl={renderPrivacyToggle("custom_fee", "Học phí riêng")}
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
              privacyToggle={renderPrivacyToggle("student_contact", "Liên hệ học viên")}
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
              privacyToggle={renderPrivacyToggle("parent_contact", "Liên hệ phụ huynh")}
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
                onEnrollmentDateClick={() => setDatePickerTarget("initial")}
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
                isLoading={false}
                onTransferOpen={openEnrollmentTransfer}
                enrollmentActionMode={enrollmentActionMode}
                selectedTransferClasses={selectedTransferClasses}
                enrollmentFees={enrollmentFees}
                onEnrollmentDateClick={(enrollmentId) => setDatePickerTarget(`enrollment:${enrollmentId}`)}
                privacyToggle={renderPrivacyToggle("enrollment_date", "Ngày bắt đầu")}
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
              <FormField controlId="student-notes" label="Ghi chú" error={notesError} errorId="student-notes-error">
                <div className="relative">
                  <textarea
                    {...notesField}
                    id="student-notes"
                    aria-invalid={Boolean(notesError)}
                    aria-describedby={notesError ? "student-notes-error" : undefined}
                    maxLength={1000}
                    autoComplete={savedInfoAutocomplete.disabled}
                    rows={2}
                    className={`${getFormInputClass(Boolean(notesError))} block h-16 min-h-16 resize-none py-2 leading-5 ${student ? "!pr-10" : ""}`}
                    data-private-hidden={hiddenFields.includes("notes")}
                    data-row={5}
                    data-col={0}
                    placeholder="Thông tin cần lưu ý về học viên (nếu có)"
                  />
                  {student ? (
                    <div className="absolute inset-y-0 right-1 z-20 flex items-center">
                      {renderPrivacyToggle("notes", "Ghi chú")}
                    </div>
                  ) : null}
                </div>
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
            <Button type="button" variant="outline" className="h-8 rounded-md px-3 text-sm" disabled={isSaving} onClick={smartRequestClose}>
              Huỷ
            </Button>
            <SaveButton
              type="submit"
              isSaving={isSaving}
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
      isBusy={isSaving}
      dirty={hasUnsavedChanges}
      onClose={smartRequestClose}
      suspended={isEnrollmentTransferOpen || datePickerTarget !== null}
      frameProps={{
        className: student ? undefined : createEntityDialogFrameClassName,
        inert: isEnrollmentTransferOpen || datePickerTarget !== null,
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
  onEnrollmentDateClick,
}: {
  enrollmentDateValue: string | null;
  error?: string;
  onBlur?: () => void;
  onEnrollmentDateClick: () => void;
}) {
  return (
    <div>
      <FormField
        error={error}
        errorId="initial-enrollment-date-error"
        label="Ngày bắt đầu"
        labelId="initial-enrollment-date-label"
      >
        <button
          type="button"
          onBlur={onBlur}
          onClick={onEnrollmentDateClick}
          className={`${datePickerButtonClassName} ${error ? "border-destructive ring-2 ring-destructive/15" : ""}`}
          aria-haspopup="dialog"
          data-invalid={error ? "true" : undefined}
          aria-describedby={error ? "initial-enrollment-date-error" : undefined}
          aria-labelledby="initial-enrollment-date-label initial-enrollment-date-value"
        >
          <span id="initial-enrollment-date-value">{formatDate(enrollmentDateValue)}</span>
        </button>
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
}: {
  class_: ClassResponse | null;
  selectedSlotIds: string[];
  onChange: (slotIds: string[]) => void;
  customFee?: number | null;
  onApplySuggestedFee?: (amount: number) => void;
}) {
  const slots = class_?.schedule?.slots?.filter((slot) => slot.id) ?? [];
  if (class_ === null || slots.length === 0) {
    return null;
  }
  const availableIds = slots.map((slot) => slot.id as string);
  const allSelected = availableIds.every((id) => selectedSlotIds.includes(id));
  const noneSelected = selectedSlotIds.length === 0;
  const selectedSlots = slots.filter((slot) => selectedSlotIds.includes(slot.id as string));
  const suggestion = getEnrollmentFeeSuggestion(class_.base_fee, slots, selectedSlots);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="table-heading-text text-gray-600">Chọn buổi học trong tuần ({slots.length} buổi)</p>
        <button
          type="button"
          className="h-7 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          onClick={() => onChange(allSelected ? [] : availableIds)}
        >
          {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
        </button>
      </div>
      <div role="group" aria-label="Chọn buổi học trong tuần" className="mt-2 flex flex-wrap gap-2">
        {slots.map((slot) => {
          const id = slot.id as string;
          const checked = selectedSlotIds.includes(id);
          return (
            <button
              key={id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={`${slot.day} ${slot.start}–${slot.end}`}
              onClick={() =>
                onChange(checked ? selectedSlotIds.filter((item) => item !== id) : [...selectedSlotIds, id])
              }
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                checked
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-gray-200 bg-white text-gray-600 hover:border-primary/40 hover:bg-primary-soft/40"
              }`}
            >
              <span aria-hidden="true">{checked ? "✓" : ""}</span>
              {slot.day} {slot.start}–{slot.end}
            </button>
          );
        })}
      </div>
      {noneSelected ? (
        <p className="helper-text mt-1 text-amber-700" role="alert">
          Vui lòng chọn ít nhất một buổi học.
        </p>
      ) : null}
      {suggestion && onApplySuggestedFee ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/15 bg-primary-soft/40 px-3 py-2">
          <p className="text-sm text-gray-700">
            Gợi ý học phí <strong className="font-semibold text-gray-950">{formatCurrency(suggestion.amount)}</strong> cho {suggestion.selectedCount}/{suggestion.totalCount} buổi.
          </p>
          <button
            type="button"
            onClick={() => onApplySuggestedFee(suggestion.amount)}
            disabled={customFee === suggestion.amount}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-white disabled:cursor-default disabled:opacity-60"
          >
            {customFee === suggestion.amount ? "Đã áp dụng" : "Áp dụng gợi ý"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EnrollmentTransferSlide({
  availableClasses,
  currentClassId,
  transferError,
  isOpen,
  mode,
  selectedClasses,
  targetConfigs,
  onAddClass,
  onClose,
  onConfirm,
  onModeChange,
  onRemoveClass,
  onUpdateTarget,
}: {
  availableClasses: ClassResponse[];
  currentClassId: string | null;
  transferError: string;
  isOpen: boolean;
  mode: EnrollmentActionMode;
  selectedClasses: ClassResponse[];
  targetConfigs: Record<string, EnrollmentTargetConfig>;
  onAddClass: (classId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onModeChange: (mode: EnrollmentActionMode) => void;
  onRemoveClass: (classId: string) => void;
  onUpdateTarget: (config: EnrollmentTargetConfig) => void;
}) {
  const sortedAvailableClasses = sortClassesForSelection(availableClasses);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const transitionDuration = useSlidePanelDuration(panelRef);

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

  function handleTransferKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!isOpen) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
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

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="enrollment-transfer-title"
      aria-hidden={!isOpen}
      inert={!isOpen}
      onKeyDown={handleTransferKeyDown}
      className={`fixed inset-0 z-[70] flex justify-end ${isOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
    >
      <div
        style={getSlideBackdropStyle(transitionDuration)}
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity motion-reduce:transition-none ${isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
        onClick={onClose}
      />

      <div
        ref={panelRef}
        style={getSlidePanelStyle(transitionDuration)}
        className={`relative z-10 flex h-full w-full flex-col bg-white shadow-2xl transition-transform motion-reduce:transition-none sm:w-[78vw] lg:w-[70vw] xl:w-[64vw] 2xl:w-[58vw] ${isOpen ? "translate-x-0" : "translate-x-full"
          }`}
      >
        <div className="flex items-center justify-between border-b border-primary/15 bg-primary-soft/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-transfer-initial-focus
              aria-label="Đóng phần chuyển hoặc thêm lớp"
              title="Đóng"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-primary-soft hover:text-primary"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <h3 id="enrollment-transfer-title" className="section-title-text text-primary">Chuyển / thêm lớp</h3>
          </div>

        </div>

        <div className="flex-1 overflow-hidden p-4 sm:p-5">
          <div className="grid h-full gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="flex flex-col rounded-md border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-4 py-3">
                <p className="text-base font-semibold text-gray-900">Thao tác</p>
              </div>
              <div className="flex-1 space-y-4 bg-gray-50 p-4">
                <div>
                  <div className="grid h-8 grid-cols-2 overflow-hidden rounded-md border border-gray-200 bg-white p-0.5">
                    {[
                      { label: "Đổi lớp", value: "transfer" as EnrollmentActionMode },
                      { label: "Học thêm", value: "supplement" as EnrollmentActionMode },
                    ].map((option) => {
                      const selected = mode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onModeChange(option.value)}
                          className={`whitespace-nowrap rounded-[5px] px-2 text-sm font-medium transition-colors sm:px-3 ${selected
                            ? "bg-primary text-primary-foreground"
                            : "text-gray-600 hover:bg-primary-soft hover:text-primary"
                            }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-md border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-gray-900">Lớp đã chọn</p>
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-800">
                      {selectedClasses.length}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedClasses.length > 0 ? (
                      selectedClasses.map((class_) => (
                        <SelectedClassChip
                          key={class_.id}
                          class_={class_}
                          onRemove={() => onRemoveClass(class_.id)}
                        />
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">Chưa chọn lớp nào.</p>
                    )}
                  </div>
                  {selectedClasses.map((class_) => {
                    const config = targetConfigs[class_.id];
                    if (!config) return null;
                    return (
                      <div key={`${class_.id}-configuration`} className="mt-3 border-t border-gray-100 pt-3">
                        <p className="text-sm font-semibold text-gray-900">{class_.name}</p>
                        <SessionSelector
                          class_={class_}
                          selectedSlotIds={config.selected_slot_ids}
                          onChange={(selected_slot_ids) => onUpdateTarget({ ...config, selected_slot_ids })}
                          customFee={config.custom_fee}
                          onApplySuggestedFee={(custom_fee) => onUpdateTarget({ ...config, custom_fee })}
                        />
                        <SmartMoneyInput
                          value={config.custom_fee}
                          onChange={(custom_fee) => onUpdateTarget({ ...config, custom_fee })}
                          placeholder="Dùng học phí của lớp"
                          className="form-input-text mt-2 h-8 w-full rounded-md border border-gray-300 px-2.5"
                        />
                      </div>
                    );
                  })}
                </div>

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
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                          className={`flex min-h-24 flex-col justify-between rounded-md border px-4 py-3 text-left transition-shadow duration-150 hover:shadow-sm ${selected ? "shadow-sm" : ""
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
            className="w-full rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onConfirm}
            aria-describedby={transferError ? "enrollment-transfer-error" : undefined}
          >
            Xác nhận
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SelectedClassChip({
  class_,
  onRemove,
}: {
  class_: ClassResponse;
  onRemove: () => void;
}) {
  const group = getClassGroupInfoForRecord(class_);

  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Bỏ chọn lớp ${class_.name}`}
      style={{
        backgroundColor: group.color.background,
        borderColor: group.color.border,
        color: group.color.text,
      }}
      className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium transition hover:brightness-[0.97]"
    >
      {class_.name}
    </button>
  );
}

function EnrollmentFeeSection({
  classes,
  currentClassId,
  enrollmentActionMode,
  enrollments,
  isLoading,
  onTransferOpen,
  onEnrollmentDateClick,
  enrollmentFees,
  privacyToggle,
  selectedTransferClasses,
  onEnrollmentSlotsChange,
  onEnrollmentCustomFeeChange,
}: {
  classes: ClassResponse[];
  currentClassId: string | null;
  enrollmentActionMode: EnrollmentActionMode;
  enrollments: StudentEnrollmentInfo[];
  isLoading: boolean;
  onTransferOpen: () => void;
  onEnrollmentDateClick: (enrollmentId: string) => void;
  enrollmentFees: EnrollmentFeeValues;
  privacyToggle?: React.ReactNode;
  selectedTransferClasses: ClassResponse[];
  onEnrollmentSlotsChange: (enrollmentId: string, slotIds: string[]) => void;
  onEnrollmentCustomFeeChange: (enrollmentId: string, fee: number | null) => void;
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

  const transferSummary =
    selectedTransferClasses.length > 0
      ? `${enrollmentActionMode === "transfer" ? "Đã chọn đổi lớp sang" : "Đã chọn học thêm"}: ${selectedTransferClasses
        .map((class_) => class_.name)
        .join(", ")}`
      : "";
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
                Lớp đang học
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
                  <p className="text-sm text-gray-500">Chưa có lớp.</p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="ml-auto h-7 shrink-0 rounded-md bg-white px-2.5 text-[13px] font-medium"
                onClick={onTransferOpen}
                aria-label="Thiết lập lớp đang học"
                aria-haspopup="dialog"
              >
                Thiết lập
              </Button>
            </div>
            {transferSummary ? (
              <p className="mt-1.5 break-words text-xs text-gray-500">{transferSummary}</p>
            ) : null}
          </div>

          {sortedEnrollments.length > 0 ? (
            <div className="grid gap-2">
              {sortedEnrollments.map((enrollment) => {
                const value = enrollmentFees[enrollment.id]?.enrollment_date ?? enrollment.enrollment_date;
                const class_ = classes.find((item) => item.id === enrollment.class_id) ?? null;
                const isPrimary = enrollment.class_id === currentClassId;
                return (
                  <div key={enrollment.id} className="rounded-md border border-gray-200 bg-white p-2.5 pb-3.5">
                    <FormField label={`Ngày bắt đầu · ${enrollment.class_name}`} labelId={`enrollment-date-${enrollment.id}-label`}>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => onEnrollmentDateClick(enrollment.id)}
                          className={`${datePickerButtonClassName} ${privacyToggle ? "!pr-10" : ""}`}
                          aria-haspopup="dialog"
                          aria-labelledby={`enrollment-date-${enrollment.id}-label enrollment-date-${enrollment.id}-value`}
                        >
                          <span id={`enrollment-date-${enrollment.id}-value`}>{formatDate(value)}</span>
                        </button>
                        {privacyToggle ? <div className="absolute inset-y-0 right-1 z-20 flex items-center">{privacyToggle}</div> : null}
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
                        className="form-input-text mt-2 h-8 w-full rounded-md border border-gray-300 px-2.5"
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

function getDatePickerCurrentValue(
  target: "initial" | `enrollment:${string}` | null,
  initialValue: string | undefined,
  enrollments: StudentEnrollmentInfo[],
  feeValues: EnrollmentFeeValues,
) {
  if (target === "initial") return initialValue;
  if (!target?.startsWith("enrollment:")) return undefined;
  const enrollmentId = target.slice("enrollment:".length);
  const enrollment = enrollments.find((item) => item.id === enrollmentId);
  return feeValues[enrollmentId]?.enrollment_date ?? enrollment?.enrollment_date ?? undefined;
}

function getEnrollmentDateBounds(
  target: "initial" | `enrollment:${string}` | null,
  initialClass: ClassResponse | null,
  enrollments: StudentEnrollmentInfo[],
) {
  const classRange = target === "initial"
    ? initialClass
    : enrollments.find((item) => target === `enrollment:${item.id}`);
  const startDate = classRange && "start_date" in classRange
    ? classRange.start_date
    : classRange?.class_start_date;
  const endDate = classRange && "end_date" in classRange
    ? classRange.end_date
    : classRange?.class_end_date;
  if (!startDate || !endDate) return { minDate: undefined, maxDate: undefined };
  return {
    minDate: startDate,
    maxDate: addIsoDays(endDate, -1),
  };
}

function addIsoDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
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
      "Ngày bắt đầu": getStudentExportValue(
        student,
        "enrollment_date",
        formatDate(getEnrollmentDateForClass(student, selectedClass.id)),
      ),
      "Học phí riêng": getStudentExportValue(
        student,
        "custom_fee",
        getEnrollmentCustomFeeForClass(student, selectedClass.id) ?? "",
      ),
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
const datePickerButtonClassName = `${formTextControlClassName} select-none text-left`;
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
