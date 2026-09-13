"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  RiArrowLeftLine as ArrowLeft,
  RiArrowRightSLine as ArrowRight,
  RiCheckLine as Check,
  RiCloseLine as X,
  RiSearchLine as Search,
  RiUserAddLine as UserAdd,
} from "react-icons/ri";
import { ClassFormDialog, type ClassFormDraftContext } from "@/components/classes/class-form-dialog";
import { FormSection } from "@/components/ui/form-section";
import { LoadingLabel } from "@/components/ui/loading-label";
import { SmartMoneyInput } from "@/components/ui/smart-money-input";
import { getClassContinuationPreview } from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getStudentsPage } from "@/lib/api/students";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { studentQueryKeys } from "@/lib/students/query-keys";
import type {
  ClassContinuationCreate,
  ClassContinuationSlotReference,
  ClassContinuationStudentCandidate,
  ClassCreate,
  ClassResponse,
  StudentResponse,
  TeacherOptionResponse,
} from "@/lib/types";
import { formatCurrency } from "@/lib/utils/format";
import { createSmartSearchMatcher } from "@/lib/utils/search";
import {
  continuationSlotKey,
  getEnrollmentFeeSuggestion,
} from "@/lib/students/enrollment-pricing";

type SelectedStudent = {
  student_id: string;
  source_enrollment_id: string | null;
  student_code: string | null;
  full_name: string;
  custom_fee: number | null;
  selected_slot_count: number;
  selected_slots: ClassContinuationSlotReference[];
  origin: "source" | "added";
  partial_fee_reviewed: boolean;
};

type Props = {
  sourceClass: ClassResponse;
  active: boolean;
  teachers: TeacherOptionResponse[];
  isTeachersLoading: boolean;
  isTeachersError: boolean;
  isSaving: boolean;
  onClose: () => void;
  onRetryTeachers: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNestedOverlayChange: (open: boolean) => void;
  onSubmit: (payload: ClassContinuationCreate) => void;
};

export function ClassContinuationWorkspace({
  sourceClass,
  active,
  teachers,
  isTeachersLoading,
  isTeachersError,
  isSaving,
  onClose,
  onRetryTeachers,
  onDirtyChange,
  onNestedOverlayChange,
  onSubmit,
}: Props) {
  const [selected, setSelected] = useState<Map<string, SelectedStudent>>(new Map());
  const [search, setSearch] = useState("");
  const [isStudentPickerOpen, setIsStudentPickerOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [targetDraft, setTargetDraft] = useState<{ baseFee: number | null; slots: ClassContinuationSlotReference[] }>({ baseFee: null, slots: [] });
  const handleDraftChange = useCallback(({ baseFee, schedule }: ClassFormDraftContext) => {
    setTargetDraft({ baseFee, slots: schedule?.slots ?? [] });
  }, []);
  const initializedForRef = useRef<string | null>(null);
  const requestIdRef = useRef(crypto.randomUUID());
  const debouncedSearch = useDebouncedValue(search, 200);

  const previewQuery = useQuery({
    queryKey: classQueryKeys.continuationPreview(sourceClass.id),
    queryFn: () => getClassContinuationPreview(sourceClass.id),
    enabled: active,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    const preview = previewQuery.data;
    if (!preview || initializedForRef.current === sourceClass.id) return;
    setSelected(new Map(preview.students.map((student) => [student.student_id, fromCandidate(student)])));
    initializedForRef.current = sourceClass.id;
  }, [previewQuery.data, sourceClass.id]);

  const searchQuery = useQuery({
    queryKey: studentQueryKeys.list({ search: debouncedSearch, status: "active", limit: 100 }),
    queryFn: ({ signal }) => getStudentsPage({ search: debouncedSearch, status: "active", limit: 100 }, signal),
    enabled: active && isStudentPickerOpen && debouncedSearch.trim().length >= 2,
    staleTime: 30_000,
  });

  const preview = previewQuery.data;
  const initialValues = useMemo<ClassCreate | null>(() => {
    if (!preview || !preview.template.class_category || !preview.template.grade_mode) return null;
    return {
      ...preview.template,
      class_category: preview.template.class_category,
      grade_mode: preview.template.grade_mode,
      start_date: preview.suggested_start_date,
      end_date: null,
      source_class_id: sourceClass.id,
    };
  }, [preview, sourceClass.id]);

  const rosterDirty = useMemo(() => {
    if (!preview || selected.size !== preview.students.length) return Boolean(preview);
    const original = new Map(preview.students.map((student) => [student.student_id, student]));
    return [...selected.values()].some((student) => {
      const candidate = original.get(student.student_id);
      if (!candidate || candidate.custom_fee !== student.custom_fee) return true;
      const previous = candidate.selected_slots.map(continuationSlotKey).sort();
      const current = student.selected_slots.map(continuationSlotKey).sort();
      return previous.length !== current.length || previous.some((key, index) => key !== current[index]);
    });
  }, [preview, selected]);

  const searchMatcher = useMemo(
    () => createSmartSearchMatcher(debouncedSearch),
    [debouncedSearch],
  );
  const matchedStudents = (searchQuery.data?.items ?? []).filter(
    (student) =>
      searchMatcher([student.full_name, student.student_code]),
  );

  useEffect(() => {
    onNestedOverlayChange(isStudentPickerOpen);
    return () => onNestedOverlayChange(false);
  }, [isStudentPickerOpen, onNestedOverlayChange]);

  if (previewQuery.isPending || !preview || !initialValues) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-gray-600">
        {previewQuery.isError
          ? getApiErrorMessage(previewQuery.error, "Không thể chuẩn bị lớp kế tiếp.")
          : <LoadingLabel label="Đang chuẩn bị lớp kế tiếp" />}
      </div>
    );
  }

  return (
    <>
    <ClassFormDialog
      embedded
      class_={null}
      initialValues={initialValues}
      teachers={teachers}
      isTeachersLoading={isTeachersLoading}
      isTeachersError={isTeachersError}
      isSaving={isSaving}
      title="Tạo lớp kế tiếp"
      submitLabel="Tạo lớp kế tiếp"
      externalDirty={rosterDirty}
      onClose={onClose}
      onRetryTeachers={onRetryTeachers}
      onNestedOverlayChange={onNestedOverlayChange}
      onDraftChange={handleDraftChange}
      onDirtyChange={onDirtyChange}
      onSubmit={(classData) => {
        const classSlots = classData.schedule?.slots ?? [];
        const validKeys = new Set(classSlots.map(continuationSlotKey));
        const invalid = [...selected.values()].find(
          (student) => student.selected_slots.length === 0 || student.selected_slots.some((slot) => !validKeys.has(continuationSlotKey(slot))),
        );
        if (invalid) {
          setSubmitError(`Vui lòng kiểm tra lại buổi học của ${invalid.full_name}.`);
          return;
        }
        const unreviewed = [...selected.values()].find(
          (student) => student.selected_slots.length < classSlots.length && !student.partial_fee_reviewed,
        );
        if (unreviewed) {
          setSubmitError(`Vui lòng xác nhận học phí của ${unreviewed.full_name}.`);
          return;
        }
        setSubmitError("");
        onSubmit({
          request_id: requestIdRef.current,
          expected_source_version: preview.source_version,
          class_data: classData as ClassCreate,
          students: [...selected.values()].map(({ student_id, source_enrollment_id, selected_slots, custom_fee, partial_fee_reviewed }) => ({
            student_id,
            source_enrollment_id,
            selected_slots,
            custom_fee,
            partial_fee_reviewed,
          })),
          preserve_custom_fees: false,
          preserve_slot_selections: false,
        });
      }}
      additionalSection={() => {
        return <FormSection label="Học viên lớp kế tiếp" order={5} summary={`${selected.size} học viên`}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <div className="form-input-text flex h-8 min-w-0 items-center rounded-md border border-gray-200 bg-white px-2.5 font-medium text-gray-900">
              <span className="truncate">{selected.size} học viên đã chọn</span>
            </div>
            <button type="button" onClick={() => setIsStudentPickerOpen(true)} className="form-input-text inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 font-medium text-primary transition hover:border-primary/30 hover:bg-primary-soft/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/20"><UserAdd className="h-4 w-4" aria-hidden="true" />Chọn học viên</button>
          </div>
          {submitError ? <p className="helper-text mt-1 text-destructive" role="alert">{submitError}</p> : null}
        </FormSection>;
      }}
    />
    {typeof document !== "undefined" ? createPortal(
      <StudentPickerSlide
        isOpen={isStudentPickerOpen}
        search={search}
        sourceStudents={preview.students.map(fromCandidate)}
        matchedStudents={matchedStudents}
        selected={selected}
        targetSlots={targetDraft.slots}
        baseFee={targetDraft.baseFee}
        isLoading={searchQuery.isFetching}
        isError={searchQuery.isError}
        onSearchChange={setSearch}
        onToggle={(student) => toggleStudent(selected, setSelected, student, targetDraft.slots)}
        onUpdate={(student) => setSelected((current) => new Map(current).set(student.student_id, student))}
        onReset={() => setSelected(new Map(preview.students.map((student) => [student.student_id, fromCandidate(student)])))}
        onClear={() => setSelected(new Map())}
        onClose={() => setIsStudentPickerOpen(false)}
      />,
      document.body,
    ) : null}
    </>
  );
}

function StudentPickerSlide({
  isOpen,
  search,
  sourceStudents,
  matchedStudents,
  selected,
  targetSlots,
  baseFee,
  isLoading,
  isError,
  onSearchChange,
  onToggle,
  onUpdate,
  onReset,
  onClear,
  onClose,
}: {
  isOpen: boolean;
  search: string;
  sourceStudents: SelectedStudent[];
  matchedStudents: StudentResponse[];
  selected: Map<string, SelectedStudent>;
  targetSlots: ClassContinuationSlotReference[];
  baseFee: number | null;
  isLoading: boolean;
  isError: boolean;
  onSearchChange: (value: string) => void;
  onToggle: (student: SelectedStudent) => void;
  onUpdate: (student: SelectedStudent) => void;
  onReset: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const selectedOutsideSource = [...selected.values()].filter(
    (student) => !sourceStudents.some((source) => source.student_id === student.student_id),
  );
  // The source preview is only the initial snapshot. Once an admin changes a
  // student's sessions or fee, the roster must render the selected map so
  // closing/reopening the configuration does not resurrect the old 2-session
  // value visually (or make the draft look unapplied).
  const displayedRoster = [
    ...sourceStudents.map((source) => selected.get(source.student_id) ?? source),
    ...selectedOutsideSource,
  ];
  const searchResults = matchedStudents.map((student) =>
    selected.get(student.id) ??
    sourceStudents.find((source) => source.student_id === student.id) ??
    fromStudentResponse(student, targetSlots),
  );
  const isSearching = search.trim().length >= 2;
  const editingStudent = editingStudentId ? selected.get(editingStudentId) ?? null : null;

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onClose]);

  return (
    <div className={`fixed inset-0 z-[80] flex justify-end transition ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!isOpen} inert={!isOpen}>
      <button type="button" aria-label="Đóng phần tìm hồ sơ" onClick={onClose} className={`absolute inset-0 bg-gray-950/30 transition-opacity duration-200 ${isOpen ? "opacity-100" : "opacity-0"}`} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`relative z-10 flex h-full w-full max-w-[520px] flex-col bg-white shadow-2xl transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-gray-950">
              {editingStudent ? <button type="button" aria-label="Trở lại danh sách" onClick={() => setEditingStudentId(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"><ArrowLeft className="h-4 w-4" /></button> : null}
              {editingStudent ? "Thiết lập học viên" : "Học viên lớp kế tiếp"}
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-600">{editingStudent ? editingStudent.full_name : `${selected.size} học viên đã chọn.`}</p>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"><X className="h-5 w-5" aria-hidden="true" /></button>
        </header>
        {!editingStudent ? <div className="shrink-0 space-y-3 border-b border-gray-100 px-5 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input ref={searchRef} autoComplete="off" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Ví dụ: Nguyễn Minh hoặc TP000000001" className="form-input-text h-8 w-full rounded-md border border-gray-300 bg-white pl-8 pr-9 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-primary focus:ring-1 focus:ring-primary/15" />
            {search ? <button type="button" aria-label="Xoá tìm kiếm" onClick={() => onSearchChange("")} className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-4 w-4" /></button> : null}
          </div>
          {isSearching ? <button type="button" onClick={() => onSearchChange("")} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary-soft"><ArrowLeft className="h-4 w-4" />Danh sách lớp kế tiếp ({selected.size})</button> : null}
        </div> : null}
        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {editingStudent ? <StudentConfiguration student={editingStudent} targetSlots={targetSlots} baseFee={baseFee} onChange={onUpdate} /> : null}
          {!editingStudent && !isSearching ? <><div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-gray-800">Danh sách lớp kế tiếp</p><div className="flex items-center gap-3 text-sm font-medium"><button type="button" onClick={onReset} className="text-primary hover:underline">Chọn lại</button><button type="button" onClick={onClear} className="text-gray-600 hover:text-gray-900">Bỏ chọn</button></div></div><div className="overflow-hidden rounded-xl border border-gray-200 bg-white">{displayedRoster.map((student) => <RosterRow key={student.student_id} student={student} checked={selected.has(student.student_id)} onToggle={() => onToggle(student)} onConfigure={selected.has(student.student_id) ? () => setEditingStudentId(student.student_id) : undefined} />)}</div></> : null}
          {!editingStudent && isSearching && isLoading ? <PickerState title="Đang tìm hồ sơ" description="" loading /> : null}
          {!editingStudent && isSearching && !isLoading && isError ? <PickerState title="Không thể tìm hồ sơ" description="Vui lòng thử lại." /> : null}
          {!editingStudent && isSearching && !isLoading && !isError && searchResults.length === 0 ? <PickerState title="Không tìm thấy hồ sơ phù hợp" description="Kiểm tra lại họ tên hoặc mã học viên." /> : null}
          {!editingStudent && isSearching && !isLoading && !isError && searchResults.length > 0 ? <><p className="mb-3 text-sm font-semibold text-gray-800">Kết quả tìm kiếm</p><div className="overflow-hidden rounded-xl border border-gray-200 bg-white">{searchResults.map((student) => <RosterRow key={student.student_id} student={student} checked={selected.has(student.student_id)} onToggle={() => onToggle(student)} onConfigure={selected.has(student.student_id) ? () => setEditingStudentId(student.student_id) : undefined} />)}</div></> : null}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-gray-200 bg-white px-5 py-4"><p className="text-sm font-medium text-gray-600">{editingStudent ? "Thay đổi sẽ áp dụng cho lớp kế tiếp." : <><span className="font-semibold text-gray-900">{selected.size}</span> học viên đã chọn</>}</p><button type="button" onClick={editingStudent ? () => setEditingStudentId(null) : onClose} className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{editingStudent ? "Áp dụng" : "Hoàn tất"}</button></footer>
      </aside>
    </div>
  );
}

function PickerState({ title, description, loading = false }: { title: string; description: string; loading?: boolean }) {
  return <div className="flex min-h-44 flex-col items-center justify-center text-center"><p className="text-sm font-semibold text-gray-800">{loading ? <LoadingLabel label={title} /> : title}</p>{description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}</div>;
}

function fromCandidate(student: ClassContinuationStudentCandidate): SelectedStudent {
  return {
    ...student,
    source_enrollment_id: student.source_enrollment_id,
    origin: "source",
    partial_fee_reviewed: student.selected_slots.length === 0,
  };
}

function fromStudentResponse(
  student: StudentResponse,
  targetSlots: ClassContinuationSlotReference[],
): SelectedStudent {
  return {
    student_id: student.id,
    source_enrollment_id: null,
    student_code: student.student_code,
    full_name: student.full_name,
    custom_fee: null,
    selected_slot_count: targetSlots.length,
    selected_slots: [...targetSlots],
    origin: "added",
    partial_fee_reviewed: true,
  };
}

function toggleStudent(
  current: Map<string, SelectedStudent>,
  setSelected: (value: Map<string, SelectedStudent>) => void,
  student: SelectedStudent,
  targetSlots: ClassContinuationSlotReference[],
) {
  const next = new Map(current);
  if (next.has(student.student_id)) next.delete(student.student_id);
  else next.set(student.student_id, student.origin === "added" && student.selected_slots.length === 0
    ? { ...student, selected_slots: [...targetSlots], selected_slot_count: targetSlots.length, partial_fee_reviewed: true }
    : student);
  setSelected(next);
}

function RosterRow({ student, checked, onToggle, onConfigure }: { student: SelectedStudent; checked: boolean; onToggle: () => void; onConfigure?: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 last:border-b-0 hover:bg-gray-50">
      <input type="checkbox" aria-label={`${checked ? "Bỏ" : "Chọn"} ${student.full_name}`} autoComplete="off" checked={checked} onChange={onToggle} className="h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold text-gray-900">{student.full_name}</span>{student.origin === "added" ? <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">Mới thêm vào lớp</span> : null}</span>
        <span className="block text-xs leading-4 text-gray-500">{student.student_code ?? "Chưa có mã"}{student.custom_fee !== null ? ` · ${formatCurrency(student.custom_fee)}` : ""}</span>
      </span>
      {checked ? <button type="button" onClick={onConfigure} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-600 hover:bg-primary-soft hover:text-primary">{student.selected_slots.length} buổi<ArrowRight className="h-4 w-4" /></button> : null}
    </div>
  );
}

function StudentConfiguration({ student, targetSlots, baseFee, onChange }: { student: SelectedStudent; targetSlots: ClassContinuationSlotReference[]; baseFee: number | null; onChange: (student: SelectedStudent) => void }) {
  const selectedKeys = new Set(student.selected_slots.map(continuationSlotKey));
  const suggestion = getEnrollmentFeeSuggestion(baseFee, targetSlots, student.selected_slots);
  function setSlots(slots: ClassContinuationSlotReference[]) {
    onChange({
      ...student,
      selected_slots: slots,
      selected_slot_count: slots.length,
      partial_fee_reviewed: slots.length === targetSlots.length,
    });
  }
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-gray-900">Buổi học trong tuần</h3><span className="text-sm font-medium text-gray-500">{student.selected_slots.length}/{targetSlots.length} buổi</span></div>
        <div className="mt-2 grid gap-2">
          {targetSlots.map((slot) => {
            const key = continuationSlotKey(slot);
            const checked = selectedKeys.has(key);
            return <button key={key} type="button" role="checkbox" aria-checked={checked} onClick={() => setSlots(checked ? student.selected_slots.filter((item) => continuationSlotKey(item) !== key) : [...student.selected_slots, slot])} className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 text-left text-sm transition ${checked ? "border-primary/30 bg-primary-soft text-primary" : "border-gray-200 bg-white text-gray-700 hover:border-primary/30"}`}><span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-white" : "border-gray-300 bg-white"}`}>{checked ? <Check className="h-3 w-3" /> : null}</span><span className="font-medium">{slot.day} · {slot.start}–{slot.end}</span></button>;
          })}
        </div>
        {student.selected_slots.length === 0 ? <p className="helper-text mt-1 text-destructive" role="alert">Chọn ít nhất một buổi học.</p> : null}
      </section>
      <section className="border-t border-gray-100 pt-4">
        <h3 className="text-sm font-semibold text-gray-900">Học phí áp dụng</h3>
        <SmartMoneyInput value={student.custom_fee} onChange={(custom_fee) => onChange({ ...student, custom_fee, partial_fee_reviewed: true })} placeholder={baseFee === null ? "Nhập học phí" : `Học phí lớp ${formatCurrency(baseFee)}`} className="mt-2 h-9" />
        {suggestion ? <><div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2"><div className="form-input-text flex h-8 min-w-0 items-center rounded-md border border-gray-200 bg-white px-2.5 font-medium text-gray-900"><span className="truncate">Gợi ý <strong className="font-semibold text-gray-950">{formatCurrency(suggestion.amount)}</strong> theo {suggestion.selectedCount}/{suggestion.totalCount} buổi.</span></div><button type="button" onClick={() => onChange({ ...student, custom_fee: suggestion.amount, partial_fee_reviewed: true })} className="form-input-text inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 font-medium text-primary transition hover:border-primary/30 hover:bg-primary-soft/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/20">Áp dụng gợi ý</button></div>{!student.partial_fee_reviewed ? <p className="helper-text mt-1 text-amber-700">Xác nhận một mức học phí trước khi hoàn tất.</p> : null}</> : null}
      </section>
    </div>
  );
}
