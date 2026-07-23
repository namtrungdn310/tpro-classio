"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  Pencil,
  Plus,
  SearchX,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { InlineFieldDivider } from "@/components/ui/inline-field-divider";
import { LoadingLabel } from "@/components/ui/loading-label";
import { SaveButton } from "@/components/ui/save-button";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { SmartMoneyInput } from "@/components/ui/smart-money-input";
import {
  shouldShowUnsavedChanges,
  UnsavedChangesNotice,
} from "@/components/ui/unsaved-changes-notice";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { ClassSelectionView } from "@/components/students/class-selection-view";
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
import { getApiErrorMessage } from "@/lib/api/errors";
import {
  createEnrollment,
  createStudent,
  dropEnrollment,
  getStudents,
  updateEnrollment,
  updateStudent,
} from "@/lib/api/students";
import { useAuth } from "@/lib/hooks/useAuth";
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
  StudentHiddenField,
  StudentEnrollmentInfo,
  StudentResponse,
} from "@/lib/types";
import { getClassGroupInfo, getClassSortKey } from "@/lib/utils/class-groups";
import { formatDate } from "@/lib/utils/format";
import {
  createPreparedSearchMatcher,
  prepareSearchCorpus,
} from "@/lib/utils/search";
import { validationMessages } from "@/lib/forms/validation-messages";
import {
  applySharedEnrollmentDate,
  type EnrollmentFeeValues,
} from "@/lib/students/enrollment-fees";
import {
  getStudentExportValue,
  getStudentVisibleValue,
  isStudentFieldHidden,
} from "@/lib/students/privacy";
import {
  type ContactOwner,
  type ContactPairSuggestion,
  useContactPairSuggestion,
} from "@/lib/students/use-contact-pair-suggestion";
import {
  getCompleteContactPair,
  getContactPairError,
} from "@/lib/forms/contact-pair";
import {
  noSavedInfoFormProps,
  savedInfoAutocomplete,
} from "@/lib/forms/saved-info-policy";
import { useFormFieldFeedback } from "@/lib/forms/use-form-field-feedback";
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
type EnrollmentActionPlan = {
  mode: EnrollmentActionMode;
  targetClassIds: string[];
};

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
      {
        missing: !values.enrollment_date,
        path: "enrollment_date" as const,
        message: validationMessages.required("ngày bắt đầu"),
      },
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
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = usePersistentState("tpro:students:selected-class-search", "");
  const [classSearch, setClassSearch] = usePersistentState("tpro:students:class-search", "");
  const deferredSearch = useDeferredValue(search);
  const [classType, setClassType] = useState<ClassType | "">("");
  const [classDuration, setClassDuration] = useState("");
  const classId = getSelectedStudentClassFromSearchParams(
    new URLSearchParams(searchParams.toString()),
  );
  const [editingStudent, setEditingStudent] = useState<StudentResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentResponse | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
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
      router.replace(nextHref, { scroll: false });
    },
    [router, searchParams, setSearch, user?.id],
  );

  const filters = useMemo(
    () => ({
      class_id: classId,
      status: "active" as const,
    }),
    [classId],
  );

  const studentsQuery = useQuery({
    queryKey: ["students", filters],
    queryFn: () => getStudents(filters),
    enabled: Boolean(user) && Boolean(classId),
    initialData: () => queryClient.getQueryData<StudentResponse[]>(["students", filters]),
    initialDataUpdatedAt: () => queryClient.getQueryState(["students", filters])?.dataUpdatedAt,
  });

  const classesQuery = useQuery({
    queryKey: ["classes", { is_active: true }],
    queryFn: () => getClasses({ is_active: true }),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
    initialData: () => queryClient.getQueryData<ClassResponse[]>(["classes", { is_active: true }]),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(["classes", { is_active: true }])?.dataUpdatedAt,
  });

  const createMutation = useMutation({
    mutationFn: createStudent,
    onSuccess: (createdStudent, variables) => {
      queryClient.setQueryData<StudentResponse[]>(["students", filters], (current) => {
        const nextStudents = current ?? [];
        return [createdStudent, ...nextStudents.filter((item) => item.id !== createdStudent.id)];
      });
      setIsFormOpen(false);
      notify.success(`Đã thêm học viên ${variables.full_name.trim()}.`);
      void invalidateStudentDependencies();
    },
    onError: (error) => {
      notify.error(getApiErrorMessage(error, "Không thể thêm học viên. Vui lòng thử lại."));
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
      let updatedStudent = await updateStudent(id, toStudentPayload(values));

      const activeEnrollments = editingStudent?.active_enrollments ?? [];
      const sharedEnrollmentDate =
        activeEnrollments
          .map(
            (enrollment) =>
              enrollmentFees[enrollment.id]?.enrollment_date ?? enrollment.enrollment_date,
          )
          .find((value): value is string => Boolean(value)) ?? null;
      const hasSharedEnrollmentDateChange =
        Boolean(sharedEnrollmentDate) &&
        activeEnrollments.some(
          (enrollment) => (enrollment.enrollment_date ?? null) !== sharedEnrollmentDate,
        );

      let didEnrollmentChange = false;

      for (let index = 0; index < activeEnrollments.length; index += 1) {
        const enrollment = activeEnrollments[index];
        const billingValues = enrollmentFees[enrollment.id];
        if (!billingValues) {
          continue;
        }

        const payload: { custom_fee?: number | null; enrollment_date?: string | null } = {};
        if (billingValues.custom_fee !== enrollment.custom_fee) {
          payload.custom_fee = billingValues.custom_fee;
        }
        if (index === 0 && hasSharedEnrollmentDateChange && sharedEnrollmentDate) {
          payload.enrollment_date = sharedEnrollmentDate;
        }
        if (Object.keys(payload).length > 0) {
          await updateEnrollment(enrollment.id, payload);
          didEnrollmentChange = true;
        }
      }

      if (enrollmentActionPlan.targetClassIds.length > 0) {
        const nextEnrollmentDate = sharedEnrollmentDate ?? getTodayInputValue();

        for (const targetClassId of enrollmentActionPlan.targetClassIds) {
          await createEnrollment({
            student_id: id,
            class_id: targetClassId,
            enrollment_date: nextEnrollmentDate,
          });
        }
        didEnrollmentChange = true;
      }

      if (enrollmentActionPlan.mode === "transfer" && selectedClass) {
        const sourceEnrollment = editingStudent?.active_enrollments.find(
          (enrollment) => enrollment.class_id === selectedClass.id,
        );
        if (sourceEnrollment) {
          await dropEnrollment(sourceEnrollment.id);
          didEnrollmentChange = true;
        }
      }

      if (didEnrollmentChange) {
        updatedStudent = await updateStudent(id, {});
      }

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

      return { updatedStudent, message };
    },
    onSuccess: ({ updatedStudent, message }) => {
      setIsFormOpen(false);
      setEditingStudent(null);
      notify.success(`${message}.`);

      queryClient.setQueryData<StudentResponse[]>(["students", filters], (current) => {
        if (!current) return current;
        return current.map((student) =>
          student.id === updatedStudent.id ? updatedStudent : student
        );
      });

      void invalidateStudentDependencies();
    },
    onError: (error) => {
      notify.error(getApiErrorMessage(error, "Không thể cập nhật học viên. Vui lòng thử lại."));
    },
  });

  const dropEnrollmentMutation = useMutation({
    mutationFn: dropEnrollment,
    onSuccess: (droppedEnrollment) => {
      queryClient.setQueryData<StudentResponse[]>(["students", filters], (current) =>
        (current ?? []).filter((student) => student.id !== droppedEnrollment.student_id),
      );
      setDeleteTarget(null);
      notify.success("Đã xoá học viên khỏi lớp.");
      void invalidateStudentDependencies();
    },
    onError: (error) => {
      notify.error(getApiErrorMessage(error, "Không thể xoá học viên khỏi lớp. Vui lòng thử lại."));
    },
  });

  async function invalidateStudentDependencies() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["students"] }),
      queryClient.invalidateQueries({ queryKey: ["classes"] }),
      queryClient.invalidateQueries({ queryKey: ["fees"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  }

  function openCreateForm() {
    if (!selectedClass) {
      notify.warning("Vui lòng chọn lớp trước khi thêm học viên.");
      return;
    }

    setEditingStudent(null);
    setIsFormOpen(true);
  }

  function openEditForm(student: StudentResponse) {
    setEditingStudent(student);
    setIsFormOpen(true);
  }

  const matchesStudentSearch = useMemo(
    () => createPreparedSearchMatcher(deferredSearch),
    [deferredSearch],
  );
  const indexedStudents = useMemo(
    () =>
      [...(studentsQuery.data ?? [])]
        .sort(compareStudentsByCreationOrder)
        .map((student) => ({
          searchCorpus: prepareSearchCorpus([
            student.full_name,
            getStudentVisibleValue(student, "school", student.school),
            getStudentVisibleValue(student, "parent_contact", student.parent_phone),
            getStudentVisibleValue(student, "parent_contact", student.parent_zalo),
            getStudentVisibleValue(student, "student_contact", student.student_phone),
            getStudentVisibleValue(student, "student_contact", student.student_zalo),
            getStudentVisibleValue(student, "notes", student.notes),
            ...student.classes.map((class_) => class_.name),
          ]),
          student,
        })),
    [studentsQuery.data],
  );

  const students = useMemo(
    () =>
      indexedStudents
        .filter(({ searchCorpus }) => matchesStudentSearch(searchCorpus))
        .map(({ student }) => student),
    [indexedStudents, matchesStudentSearch],
  );
  const studentQueryData = studentsQuery.data;
  const totalStudentCount = studentQueryData?.length ?? 0;
  const hasStudentQueryData = studentQueryData !== undefined;
  const hasBlockingStudentError = studentsQuery.isError && !hasStudentQueryData;
  const hasSearch = Boolean(search.trim());
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const selectedClass = classes.find((class_) => class_.id === classId) ?? null;
  const isResolvingSelectedClass = Boolean(classId) && classesQuery.isLoading && !selectedClass;
  const isMutating =
    createMutation.isPending || updateMutation.isPending || dropEnrollmentMutation.isPending;

  useEffect(() => {
    if (!user) {
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
  }, [classId, updateSelectedClass, user]);

  useEffect(() => {
    if (!user || !classId || !classesQuery.isSuccess) {
      return;
    }

    if (!classes.some((class_) => class_.id === classId)) {
      updateSelectedClass("", false);
    }
  }, [classId, classes, classesQuery.isSuccess, updateSelectedClass, user]);

  async function handleExportStudents() {
    if (!selectedClass || students.length === 0) {
      return;
    }

    try {
      await exportStudents(students, selectedClass);
      notify.success(`Đã xuất ${students.length} học viên ra Excel.`);
    } catch {
      notify.error("Không thể xuất danh sách học viên. Vui lòng thử lại.");
    }
  }

  return (
    <div className="flex flex-col gap-4 overflow-x-hidden md:h-full md:overflow-hidden">
      {!classId ? (
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
            void queryClient.prefetchQuery({
              queryKey: ["students", { class_id: nextClassId, status: "active" }],
              queryFn: () => getStudents({ class_id: nextClassId, status: "active" }),
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

      {isResolvingSelectedClass ? <StudentClassDetailSkeleton isAdmin={isAdmin} /> : null}

      {selectedClass ? (
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
                  onDelete={setDeleteTarget}
                  onEdit={openEditForm}
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

      {isFormOpen ? (
        <StudentFormDialog
          classes={classes}
          currentClassId={selectedClass?.id ?? null}
          isSaving={isMutating}
          student={editingStudent}
          onClose={() => {
            setIsFormOpen(false);
            setEditingStudent(null);
          }}
          onSubmit={(values, enrollmentFees, enrollmentActionPlan) => {
            if (editingStudent) {
              updateMutation.mutate({
                enrollmentActionPlan,
                id: editingStudent.id,
                values,
                enrollmentFees,
              });
            } else {
              createMutation.mutate(toStudentCreatePayload(values, selectedClass!.id));
            }
          }}
        />
      ) : null}

      {deleteTarget ? (
        <RemoveFromClassDialog
          isDeleting={dropEnrollmentMutation.isPending}
          student={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            const enrollment = deleteTarget.active_enrollments.find((e) => e.class_id === classId);
            if (enrollment) {
              dropEnrollmentMutation.mutate(enrollment.id);
            }
          }}
        />
      ) : null}

    </div>
  );
}

function AddStudentButton({
  compact = false,
  onClick,
}: {
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Thêm học viên"
      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-gray-950 px-2.5 text-sm font-medium text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      {compact ? "Thêm" : "Thêm học viên"}
    </button>
  );
}

function ExportStudentsButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[#217346] px-3 text-sm font-medium text-white transition hover:bg-[#1b5f3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Download className="h-3.5 w-3.5" aria-hidden="true" />
      Excel
    </button>
  );
}

function SelectedClassBar({
  canExport,
  class_,
  onChangeClass,
  onExportStudents,
}: {
  canExport: boolean;
  class_: ClassResponse;
  onChangeClass: () => void;
  onExportStudents: () => void;
}) {
  const group = getClassGroupInfo(class_.name);
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
            {formatCurrencyVnd(class_.base_fee)} <span className="text-gray-500">/ {getBillingLabel(class_)}</span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <ExportStudentsButton disabled={!canExport} onClick={onExportStudents} />
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

const CONTACT_MODAL_GRID_CLASS =
  "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center";

function ContactDivider() {
  return <InlineFieldDivider />;
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
    <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[13px] font-medium leading-4 text-gray-500">
      <span className="shrink-0 select-none">Học phí:</span>
      {isStudentFieldHidden(student, "custom_fee") ? (
        <HiddenStudentValue />
      ) : (
        <SelectableStudentValue inline value={formatCurrencyVnd(customFee)} />
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
      <Field controlId="student-birth-date" label="Ngày sinh" error={error} errorId="student-birth-date-error">
        <div
          className={`relative flex h-8 w-full items-center rounded-md border bg-white px-3 transition-shadow focus-within:ring-2 ${error ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100" : "border-gray-200 focus-within:border-gray-400 focus-within:ring-gray-200"}`}
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
      </Field>
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

  function handleSuggestionKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab" && !event.shiftKey && suggestion) {
      onAcceptSuggestion?.();
    }
  }

  return (
    <div className="sm:col-span-2">
      <div className="block space-y-1">
        <span className="form-label-text block select-none text-[15px] text-gray-700">{label}</span>
        <div
          role="group"
          aria-describedby={describedBy}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.();
          }}
          className={`${CONTACT_MODAL_GRID_CLASS} relative h-8 w-full rounded-md border bg-white transition-shadow focus-within:ring-2 ${error ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100" : "border-gray-200 focus-within:border-gray-400 focus-within:ring-gray-200"}`}
        >
          <div className="h-full min-w-0">
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
              aria-keyshortcuts={suggestion?.target === "zalo" ? "Tab" : undefined}
              onKeyDown={handleSuggestionKeyDown}
              data-contact-suggestion={suggestion?.target === "zalo" ? "true" : undefined}
              className="form-input-text h-full w-full min-w-0 bg-transparent px-3 pr-4 text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400"
            />
          </div>
          <ContactDivider />
          <div className="h-full min-w-0">
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
              aria-keyshortcuts={suggestion?.target === "phone" ? "Tab" : undefined}
              onKeyDown={handleSuggestionKeyDown}
              data-contact-suggestion={suggestion?.target === "phone" ? "true" : undefined}
              data-row={dataRow}
              data-col={1}
              data-private-hidden={isContentHidden}
              className={`form-input-text h-full w-full min-w-0 bg-transparent px-4 text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400 ${privacyToggle ? "pr-10" : "pr-3"}`}
            />
          </div>
          {privacyToggle ? (
            <div className="absolute inset-y-0 right-1 flex items-center">{privacyToggle}</div>
          ) : null}
        </div>
        {error && (
          <span id={errorId} role="alert" className="helper-text block text-red-600">{error}</span>
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
      label="Thông tin học viên"
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
      label="Thông tin phụ huynh"
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
  onDelete,
  onEdit,
  students,
}: {
  currentClassId: string;
  isAdmin: boolean;
  onDelete: (student: StudentResponse) => void;
  onEdit: (student: StudentResponse) => void;
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
          <article key={student.id} className="rounded-md border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-base font-semibold text-gray-900">
                  <SelectableStudentValue value={student.full_name} />
                </h2>
                <StudentCustomFeeLine classId={currentClassId} student={student} />
                <p className="mt-1 break-words text-[15px] font-medium text-gray-600">
                  <SelectableStudentValue {...getStudentCardSummary(student)} />
                </p>
              </div>
              {isAdmin ? (
                <div className="flex shrink-0 gap-2">
                  <IconButton label="Sửa học viên" onClick={() => onEdit(student)}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton label="Xoá học viên" tone="danger" onClick={() => onDelete(student)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              ) : null}
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
        ))}
      </div>

      <div
        role="table"
        aria-label="Danh sách học viên trong lớp"
        className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white xl:h-full xl:min-h-0 xl:flex xl:flex-col"
      >
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-50">
          <div role="row" className={`${tableGridClass} table-heading-text text-left text-gray-700`}>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Họ tên</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Ngày sinh</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Trường</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Ngày bắt đầu</div>
            <div role="columnheader" className="whitespace-nowrap py-3 pl-4 pr-2.5">Thông tin học viên</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Thông tin phụ huynh</div>
            <div role="columnheader" className="whitespace-nowrap px-2.5 py-3">Ghi chú</div>
            {isAdmin ? <div role="columnheader" className="whitespace-nowrap px-2 py-3 text-center">Thao tác</div> : null}
          </div>
        </div>

        <div role="rowgroup" className="scrollbar-hidden min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain bg-white">
          <div role="presentation" className="divide-y divide-gray-100 text-[15px] font-medium leading-5">
            {students.map((student) => (
              <div role="row" key={student.id} className={`${tableGridClass} cv-auto items-start hover:bg-gray-50`}>
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
                {isAdmin ? (
                  <div role="cell" className="flex self-stretch items-center justify-center px-2 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <IconButton label="Sửa học viên" onClick={() => onEdit(student)}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Xoá học viên" tone="danger" onClick={() => onDelete(student)}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StudentFormDialog({
  classes,
  currentClassId,
  isSaving,
  onClose,
  onSubmit,
  student,
}: {
  classes: ClassResponse[];
  currentClassId: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (
    values: StudentFormValues,
    enrollmentFees: EnrollmentFeeValues,
    enrollmentActionPlan: EnrollmentActionPlan,
  ) => void;
  student: StudentResponse | null;
}) {
  const [mounted, setMounted] = useState(false);
  const mouseDownOnBackdrop = useRef(false);
  const [enrollmentFees, setEnrollmentFees] = useState<EnrollmentFeeValues>({});
  const [enrollmentFeeDraftError, setEnrollmentFeeDraftError] = useState("");
  const [enrollmentActionMode, setEnrollmentActionMode] =
    useState<EnrollmentActionMode>("supplement");
  const [transferTargetClassIds, setTransferTargetClassIds] = useState<string[]>([]);
  const [draftEnrollmentActionMode, setDraftEnrollmentActionMode] =
    useState<EnrollmentActionMode>("supplement");
  const [draftTransferTargetClassIds, setDraftTransferTargetClassIds] = useState<string[]>([]);
  const [transferError, setTransferError] = useState("");
  const [isEnrollmentTransferOpen, setIsEnrollmentTransferOpen] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<"initial" | "shared" | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const initialCreateFormKeyRef = useRef(normalizedStudentCreateFormKey(defaultStudentValues));

  useEffect(() => {
    setMounted(true);

    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocusedElement.current?.focus();
    };
  }, []);
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
    resolver: zodResolver(student ? studentSchema : studentCreateSchema),
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
          enrollment_date: getTodayInputValue(),
        }
      : { ...defaultStudentValues, enrollment_date: getTodayInputValue() };

    if (!student) {
      initialCreateFormKeyRef.current = normalizedStudentCreateFormKey(nextValues);
    }

    reset(nextValues);
    setEnrollmentFeeDraftError("");
    resetFeedback();
  }, [reset, resetFeedback, student]);

  useEffect(() => {
    if (!student) {
      setEnrollmentFees({});
      setEnrollmentActionMode("supplement");
      setTransferTargetClassIds([]);
      setDraftEnrollmentActionMode("supplement");
      setDraftTransferTargetClassIds([]);
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
          },
        ]),
      ),
    );
    setEnrollmentActionMode("supplement");
    setTransferTargetClassIds([]);
    setDraftEnrollmentActionMode("supplement");
    setDraftTransferTargetClassIds([]);
    setTransferError("");
    setIsEnrollmentTransferOpen(false);
  }, [student]);

  const activeEnrollments = student?.active_enrollments ?? [];
  const primaryEnrollment =
    activeEnrollments.find((enrollment) => enrollment.class_id === currentClassId) ??
    activeEnrollments[0] ??
    null;
  const sharedEnrollmentDate = getSharedEnrollmentDate(activeEnrollments, enrollmentFees);
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
  const hasEnrollmentFeeChanges = activeEnrollments.some((enrollment) => {
    const draft = enrollmentFees[enrollment.id];
    return Boolean(
      draft &&
      ((draft.custom_fee ?? null) !== (enrollment.custom_fee ?? null) ||
        (draft.enrollment_date ?? null) !== (enrollment.enrollment_date ?? null)),
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
    owner: "student",
    phoneValue: studentPhoneValue,
    zaloValue: studentZaloValue,
  });
  const parentContactSuggestion = useContactPairSuggestion({
    enabled: !hiddenFields.includes("parent_contact"),
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
      transferError,
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
    owner: ContactOwner,
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

  function requestClose() {
    if (!isSaving) {
      onClose();
    }
  }

  function openEnrollmentTransfer() {
    setDraftEnrollmentActionMode(enrollmentActionMode);
    setDraftTransferTargetClassIds([...transferTargetClassIds]);
    setTransferError("");
    setIsEnrollmentTransferOpen(true);
  }

  function closeEnrollmentTransfer() {
    setTransferError("");
    setIsEnrollmentTransferOpen(false);
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (datePickerTarget) {
        setDatePickerTarget(null);
      } else if (isEnrollmentTransferOpen) {
        closeEnrollmentTransfer();
      } else {
        requestClose();
      }
      return;
    }

    if (event.key !== "Tab" || !dialogRef.current) {
      return;
    }

    const focusableElements = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
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

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 sm:items-center sm:px-4"
      onKeyDown={handleDialogKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          mouseDownOnBackdrop.current = true;
        } else {
          mouseDownOnBackdrop.current = false;
        }
      }}
      onMouseUp={(e) => {
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) {
          if (!isSaving) {
            requestClose();
          }
        }
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-dialog-title"
        aria-busy={isSaving}
        className="relative flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:h-fit sm:max-h-[calc(100dvh-32px)] sm:max-w-[544px] sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="contents" inert={isEnrollmentTransferOpen || datePickerTarget !== null}>
          <DialogHeader
            title={student ? "Chỉnh sửa học viên" : "Thêm học viên"}
            isSaving={isSaving}
            onClose={requestClose}
          />
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
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              const activeEl = document.activeElement as HTMLElement;
              if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
                const rowAttr = activeEl.getAttribute("data-row");
                if (rowAttr !== null) {
                  e.preventDefault();
                  const currentRow = parseInt(rowAttr, 10);
                  const currentCol = parseInt(activeEl.getAttribute("data-col") || "0", 10);
                  const form = e.currentTarget;
                  const inputs = Array.from(
                    form.querySelectorAll("input[data-row], textarea[data-row]"),
                  ) as Array<HTMLInputElement | HTMLTextAreaElement>;

                  const rowMap: Record<number, Array<HTMLInputElement | HTMLTextAreaElement>> = {};
                  inputs.forEach((input) => {
                    const r = parseInt(input.getAttribute("data-row") || "0", 10);
                    if (!rowMap[r]) rowMap[r] = [];
                    rowMap[r].push(input);
                  });

                  Object.keys(rowMap).forEach((r) => {
                    rowMap[Number(r)].sort((a, b) => {
                      const colA = parseInt(a.getAttribute("data-col") || "0", 10);
                      const colB = parseInt(b.getAttribute("data-col") || "0", 10);
                      if (colA !== colB) return colA - colB;
                      return 0;
                    });
                  });

                  const availableRows = Object.keys(rowMap)
                    .map(Number)
                    .sort((a, b) => a - b);

                  const currentRowIndex = availableRows.indexOf(currentRow);
                  if (currentRowIndex !== -1) {
                    let targetRow: number | null = null;
                    if (e.key === "ArrowDown") {
                      if (currentRowIndex < availableRows.length - 1) {
                        targetRow = availableRows[currentRowIndex + 1];
                      }
                    } else {
                      if (currentRowIndex > 0) {
                        targetRow = availableRows[currentRowIndex - 1];
                      }
                    }

                    if (targetRow !== null) {
                      const targetInputs = rowMap[targetRow];
                      let targetInput = targetInputs.find(
                        (input) => parseInt(input.getAttribute("data-col") || "0", 10) === currentCol
                      );
                      if (!targetInput) {
                        targetInput = targetInputs[0];
                      }
                      if (targetInput) {
                        targetInput.focus();
                        const valLen = targetInput.value.length;
                        targetInput.setSelectionRange(valLen, valLen);
                      }
                    }
                  }
                }
              }
            } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              const activeEl = document.activeElement as HTMLInputElement;
              if (activeEl && activeEl.tagName === "INPUT" && activeEl.hasAttribute("data-row")) {
                const rowAttr = activeEl.getAttribute("data-row");
                const colAttr = activeEl.getAttribute("data-col");
                if (rowAttr !== null && colAttr !== null) {
                  const currentRow = parseInt(rowAttr, 10);
                  const isAtStart = activeEl.selectionStart === 0 && activeEl.selectionEnd === 0;
                  const isAtEnd = activeEl.selectionStart === activeEl.value.length;

                  if (e.key === "ArrowLeft" && isAtStart) {
                    const form = e.currentTarget;
                    const siblings = Array.from(form.querySelectorAll(`input[data-row="${currentRow}"]`)) as HTMLInputElement[];
                    const currentIndex = siblings.indexOf(activeEl);
                    if (currentIndex > 0) {
                      e.preventDefault();
                      const targetInput = siblings[currentIndex - 1];
                      targetInput.focus();
                      const valLen = targetInput.value.length;
                      targetInput.setSelectionRange(valLen, valLen);
                    }
                  } else if (e.key === "ArrowRight" && isAtEnd) {
                    const form = e.currentTarget;
                    const siblings = Array.from(form.querySelectorAll(`input[data-row="${currentRow}"]`)) as HTMLInputElement[];
                    const currentIndex = siblings.indexOf(activeEl);
                    if (currentIndex !== -1 && currentIndex < siblings.length - 1) {
                      e.preventDefault();
                      const targetInput = siblings[currentIndex + 1];
                      targetInput.focus();
                      targetInput.setSelectionRange(0, 0);
                    }
                  }
                }
              }
            }
          }}
          onSubmit={(event) => {
            markSubmitted();
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
              onSubmit(values, enrollmentFees, enrollmentActionPlan);
            })(event);
          }}
        >
          <div className="min-h-0 flex-1 overflow-hidden px-4 py-3 sm:px-5">
            <div className="space-y-3">
                <section>
                  <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
              <Field controlId="student-full-name" label="Họ và tên" error={fullNameError} errorId="student-full-name-error">
                <input
                  {...fullNameField}
                  id="student-full-name"
                  data-dialog-initial-focus
                  aria-invalid={Boolean(fullNameError)}
                  aria-describedby={fullNameError ? "student-full-name-error" : undefined}
                  autoComplete={savedInfoAutocomplete.disabled}
                  maxLength={120}
                  className={getFormInputClass(Boolean(fullNameError))}
                  data-row={0}
                  data-col={0}
                />
              </Field>
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
                dataRow={0}
                dataCol={1}
                privacyToggle={renderPrivacyToggle("birth_date", "Ngày sinh")}
                isContentHidden={hiddenFields.includes("birth_date")}
              />
              <div>
                <Field controlId="student-school" label="Trường" error={schoolError} errorId="student-school-error">
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
                        {renderPrivacyToggle("school", "Trường")}
                      </div>
                    ) : null}
                  </div>
                </Field>
              </div>
              {student && primaryEnrollment ? (
                <div>
                  <Field
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
                  </Field>
                </div>
              ) : (
                <Field controlId="student-custom-fee" label="Học phí riêng" error={customFeeError} errorId="student-custom-fee-error">
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
                </Field>
              )}
                  </div>
                </section>

                <section className="border-t border-gray-100 pt-3">
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
                      privacyToggle={renderPrivacyToggle("student_contact", "Thông tin học viên")}
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
                      privacyToggle={renderPrivacyToggle("parent_contact", "Thông tin phụ huynh")}
                      isContentHidden={hiddenFields.includes("parent_contact")}
                    />
                  </div>
                </section>

              <section className={`border-t border-gray-100 ${student ? "pt-4" : "pt-3"}`}>
                <div className="w-full">
            {!student ? (
              <InitialEnrollmentFields
                enrollmentDateValue={watch("enrollment_date") ?? null}
                error={enrollmentDateError}
                onBlur={() => markBlur("enrollment_date")}
                onEnrollmentDateClick={() => setDatePickerTarget("initial")}
              />
            ) : null}

            {student ? (
              <EnrollmentFeeSection
                currentClassId={currentClassId}
                enrollments={activeEnrollments}
                isLoading={false}
                onTransferOpen={openEnrollmentTransfer}
                enrollmentActionMode={enrollmentActionMode}
                selectedTransferClasses={selectedTransferClasses}
                sharedEnrollmentDate={sharedEnrollmentDate}
                onEnrollmentDateClick={() => setDatePickerTarget("shared")}
                privacyToggle={renderPrivacyToggle("enrollment_date", "Ngày bắt đầu")}
              />
            ) : null}

                <div className="mt-2">
                  <Field controlId="student-notes" label="Ghi chú" error={notesError} errorId="student-notes-error">
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
                  </Field>
                </div>
                </div>
              </section>
            </div>
          </div>

            {shouldShowUnsavedNotice ? (
              <div className="shrink-0 px-4 pb-3 sm:px-5">
                <UnsavedChangesNotice
                  hasChanges={hasUnsavedChanges}
                  hasErrors={unsavedNoticeHasErrors}
                  isSaving={isSaving}
                />
              </div>
            ) : null}
            <DialogActions
              disabled={Boolean(student && !hasUnsavedChanges)}
              isSaving={isSaving}
              onClose={requestClose}
            />
          </form>
        </div>

        {student ? (
          <EnrollmentTransferSlide
            availableClasses={availableTransferClasses}
            currentClassId={currentClassId}
            transferError={transferError}
            isOpen={isEnrollmentTransferOpen}
            mode={draftEnrollmentActionMode}
            selectedClasses={draftSelectedTransferClasses}
            onAddClass={(classId) => {
              setTransferError("");
              setDraftTransferTargetClassIds((current) =>
                current.includes(classId) ? current : [...current, classId],
              );
            }}
            onClose={closeEnrollmentTransfer}
            onConfirm={() => {
              if (draftEnrollmentActionMode === "transfer" && draftTransferTargetClassIds.length === 0) {
                setTransferError("Vui lòng chọn ít nhất một lớp mới để chuyển học viên.");
                return;
              }
              setEnrollmentActionMode(draftEnrollmentActionMode);
              setTransferTargetClassIds([...draftTransferTargetClassIds]);
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
          />
        ) : null}

        <DatePickerSlide
          isOpen={datePickerTarget !== null}
          onClose={() => setDatePickerTarget(null)}
          currentValue={
            datePickerTarget === "initial"
              ? watch("enrollment_date") ?? undefined
              : sharedEnrollmentDate ?? undefined
          }
          onSelectDate={(dateStr) => {
            if (datePickerTarget === "initial") {
              markInput("enrollment_date", dateStr);
              setValue("enrollment_date", dateStr, {
                shouldDirty: true,
                shouldValidate: true,
              });
              return;
            }

            if (datePickerTarget === "shared") {
              setEnrollmentFees((current) =>
                applySharedEnrollmentDate(activeEnrollments, current, dateStr),
              );
            }
          }}
        />
      </div>
    </div>,
    document.body
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
      <Field
        error={error}
        errorId="initial-enrollment-date-error"
        label="Ngày bắt đầu"
        labelId="initial-enrollment-date-label"
      >
        <button
          type="button"
          onBlur={onBlur}
          onClick={onEnrollmentDateClick}
          className={`${datePickerButtonClassName} ${error ? "border-red-400 ring-2 ring-red-100" : ""}`}
          aria-haspopup="dialog"
          data-invalid={error ? "true" : undefined}
          aria-describedby={error ? "initial-enrollment-date-error" : undefined}
          aria-labelledby="initial-enrollment-date-label initial-enrollment-date-value"
        >
          <span id="initial-enrollment-date-value">{formatDate(enrollmentDateValue)}</span>
        </button>
      </Field>
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
  onAddClass,
  onClose,
  onConfirm,
  onModeChange,
  onRemoveClass,
}: {
  availableClasses: ClassResponse[];
  currentClassId: string | null;
  transferError: string;
  isOpen: boolean;
  mode: EnrollmentActionMode;
  selectedClasses: ClassResponse[];
  onAddClass: (classId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onModeChange: (mode: EnrollmentActionMode) => void;
  onRemoveClass: (classId: string) => void;
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

  return (
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
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-transfer-initial-focus
              aria-label="Đóng phần chuyển hoặc thêm lớp"
              title="Đóng"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <h3 id="enrollment-transfer-title" className="text-base font-semibold text-gray-900">Chuyển / thêm lớp</h3>
          </div>

        </div>

        <div className="flex-1 overflow-hidden p-4 sm:p-5">
          <div className="grid h-full gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
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
                            ? "bg-gray-900 text-white"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
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
                </div>

                {mode === "transfer" && currentClassId ? (
                  <p className="w-full whitespace-nowrap text-center text-sm text-gray-500">
                    * Lưu xong, học viên sẽ rời lớp hiện tại.
                  </p>
                ) : null}

                {transferError ? (
                  <p id="enrollment-transfer-error" role="alert" className="text-sm text-red-600">
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
                      const group = getClassGroupInfo(class_.name);
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
                            {formatCurrencyVnd(class_.base_fee)} / {getBillingLabel(class_)}
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

        <div className="border-t border-gray-200 bg-gray-50 p-4">
          <Button
            type="button"
            className="w-full rounded-md bg-gray-950 text-white hover:bg-black"
            onClick={onConfirm}
            aria-describedby={transferError ? "enrollment-transfer-error" : undefined}
          >
            Xác nhận
          </Button>
        </div>
      </div>
    </div>
  );
}

function SelectedClassChip({
  class_,
  onRemove,
}: {
  class_: ClassResponse;
  onRemove: () => void;
}) {
  const group = getClassGroupInfo(class_.name);

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
  currentClassId,
  enrollmentActionMode,
  enrollments,
  isLoading,
  onTransferOpen,
  onEnrollmentDateClick,
  privacyToggle,
  selectedTransferClasses,
  sharedEnrollmentDate,
}: {
  currentClassId: string | null;
  enrollmentActionMode: EnrollmentActionMode;
  enrollments: StudentEnrollmentInfo[];
  isLoading: boolean;
  onTransferOpen: () => void;
  onEnrollmentDateClick: () => void;
  privacyToggle?: React.ReactNode;
  selectedTransferClasses: ClassResponse[];
  sharedEnrollmentDate: string | null;
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
          Đang tải lớp đang học...
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
                      const color = getClassGroupInfo(enrollment.class_name).color;
                      return (
                        <span
                          key={enrollment.id}
                          className="inline-flex h-7 select-text items-center rounded-md border px-2 text-[13px] font-medium"
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

          {enrollments.length > 0 ? (
            <div>
              <Field label="Ngày bắt đầu" labelId="shared-enrollment-date-label">
                <div className="relative">
                  <button
                    type="button"
                    onClick={onEnrollmentDateClick}
                    className={`${datePickerButtonClassName} ${privacyToggle ? "!pr-10" : ""}`}
                    aria-haspopup="dialog"
                    aria-labelledby="shared-enrollment-date-label shared-enrollment-date-value"
                    aria-describedby={enrollments.length > 1 ? "shared-enrollment-date-help" : undefined}
                  >
                    <span id="shared-enrollment-date-value">
                      {sharedEnrollmentDate ? formatDate(sharedEnrollmentDate) : "Nhiều ngày khác nhau"}
                    </span>
                  </button>
                  {privacyToggle ? (
                    <div className="absolute inset-y-0 right-1 z-20 flex items-center">{privacyToggle}</div>
                  ) : null}
                </div>
              </Field>
              {enrollments.length > 1 ? (
                <p id="shared-enrollment-date-help" className="helper-text mt-1 text-gray-500">
                  Ngày mới sẽ áp dụng đồng thời cho tất cả {enrollments.length} lớp.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RemoveFromClassDialog({
  isDeleting,
  onClose,
  onConfirm,
  student,
}: {
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  student: StudentResponse;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={() => {
        if (!isDeleting) {
          onClose();
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-student-from-class-title"
        aria-describedby="remove-student-from-class-description"
        className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="remove-student-from-class-title" className="section-title-text text-gray-900">Xoá khỏi lớp</h2>
        <p id="remove-student-from-class-description" className="mt-2 text-sm leading-6 text-gray-600">
          Bạn có chắc muốn xoá học viên {student.full_name} khỏi lớp này? Các lớp khác vẫn sẽ được giữ nguyên.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-8 rounded-md px-3 text-sm" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-8 rounded-md bg-red-600 px-3 text-sm text-white hover:bg-red-700"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            <LoadingLabel
              label="Đang xoá"
              isLoading={isDeleting}
              idleLabel="Xoá khỏi lớp"
            />
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DialogHeader({
  isSaving,
  onClose,
  title,
}: {
  isSaving: boolean;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-200 py-3 pl-4 pr-4 sm:pl-5">
      <h2 id="student-dialog-title" className="section-title-text min-w-0 text-gray-900">{title}</h2>
      <button
        type="button"
        title="Đóng"
        aria-label="Đóng"
        disabled={isSaving}
        onClick={onClose}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function DialogActions({
  disabled,
  isSaving,
  onClose,
  submitLabel = "Lưu",
}: {
  disabled?: boolean;
  isSaving: boolean;
  onClose: () => void;
  submitLabel?: string;
}) {
  return (
    <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5">
      <Button type="button" variant="outline" className="h-8 rounded-md px-3 text-sm" disabled={isSaving} onClick={onClose}>
        Huỷ
      </Button>
      <SaveButton
        type="submit"
        disabled={disabled}
        idleLabel={submitLabel}
        isSaving={isSaving}
      />
    </div>
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
  children: React.ReactNode;
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
      {error ? <span id={errorId} role="alert" className="helper-text block text-red-600">{error}</span> : null}
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  tone = "default",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={
        tone === "danger"
          ? "inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-600 bg-red-600 text-white hover:bg-red-700"
          : "inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      }
    >
      {children}
    </button>
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

function toStudentCreatePayload(values: StudentFormValues, classId: string) {
  return {
    ...toStudentPayload(values),
    class_id: classId,
    custom_fee: values.custom_fee,
    birth_date: values.birth_date ?? "",
    school: values.school?.trim() ?? "",
    parent_phone: normalizeOptionalText(values.parent_phone) ?? "",
    parent_zalo: normalizeOptionalText(values.parent_zalo) ?? "",
    enrollment_date: values.enrollment_date || getTodayInputValue(),
  };
}

function getTodayInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function getSharedEnrollmentDate(
  enrollments: StudentEnrollmentInfo[],
  feeValues: EnrollmentFeeValues,
) {
  if (enrollments.length === 0) {
    return null;
  }

  const dates = enrollments.map(
    (enrollment) => feeValues[enrollment.id]?.enrollment_date ?? enrollment.enrollment_date ?? null,
  );

  const firstDate = dates[0];
  return dates.every((date) => date === firstDate) ? firstDate : null;
}

function compareStudentsByCreationOrder(left: StudentResponse, right: StudentResponse) {
  const createdAtComparison = right.created_at.localeCompare(left.created_at);
  return createdAtComparison || left.id.localeCompare(right.id);
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
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const rows = students.map((student) => {
    const studentContact = getCompleteContactPair(student.student_zalo, student.student_phone);
    const parentContact = getCompleteContactPair(student.parent_zalo, student.parent_phone);

    return {
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
  const headers = Object.keys(rows[0] ?? {});
  const data = [
    headers.map((header) => ({ value: header, fontWeight: "bold" as const })),
    ...rows.map((row) => headers.map((header) => row[header as keyof typeof row] ?? "")),
  ];

  await writeExcelFile(data, {
    columns: getAutoFitColumns(rows),
    sheet: "HocVien",
    stickyRowsCount: 1,
  }).toFile(`HocVien_${sanitizeFileName(selectedClass.name)}_${getCurrentMonthKey()}.xlsx`);
}

function getAutoFitColumns(rows: Record<string, string | number>[]) {
  const headers = rows[0] ? Object.keys(rows[0]) : [];

  return headers.map((header) => {
    const maxContentLength = rows.reduce((maxLength, row) => {
      const cellValue = row[header] ?? "";
      return Math.max(maxLength, String(cellValue).length);
    }, header.length);

    return { width: Math.min(Math.max(maxContentLength + 3, 12), 48) };
  });
}

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getBillingLabel(class_: ClassResponse) {
  return class_.type === "COURSE"
    ? `${getCourseWeeks(class_.billing_cycle_months)} tuần`
    : "1 tháng";
}

function getCourseWeeks(billingCycleMonths: number) {
  if (billingCycleMonths === 2) {
    return 8;
  }
  if (billingCycleMonths === 6) {
    return 24;
  }
  if (billingCycleMonths === 12) {
    return 48;
  }
  return 12;
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

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "_");
}

const formControlBaseClassName =
  "form-input-text h-8 w-full rounded-md border border-gray-200 bg-white px-3 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200";
const inputClassName = `${formControlBaseClassName} select-text`;
const datePickerButtonClassName = `${formControlBaseClassName} select-none text-left`;
const numberInputClassName =
  "form-input-text h-8 w-full rounded-md border border-gray-200 bg-white px-3 outline-none [appearance:textfield] focus:border-gray-400 focus:ring-2 focus:ring-gray-200 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none select-text";

function getFormInputClass(hasError: boolean) {
  return hasError
    ? `${inputClassName} border-red-400 focus:border-red-500 focus:ring-red-100`
    : inputClassName;
}

function getNumberInputClass(hasError: boolean) {
  return hasError
    ? `${numberInputClassName} border-red-400 focus:border-red-500 focus:ring-red-100`
    : numberInputClassName;
}
