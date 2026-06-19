"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  createClass,
  deleteClass,
  getClasses,
  updateClass,
} from "@/lib/api/classes";
import { useAuth } from "@/lib/hooks/useAuth";
import { QueryProvider } from "@/lib/providers/query-provider";
import type { ClassResponse, ClassType } from "@/lib/types";
import { formatBillingCycle, formatClassType, formatCurrency } from "@/lib/utils/format";

type ActiveFilter = "active" | "hidden";

const classSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên lớp"),
  type: z.enum(["MONTHLY", "COURSE"]),
  base_fee: z.number().min(0, "Học phí không được âm"),
  billing_cycle_months: z.number().min(1, "Chu kỳ thu phải từ 1 tháng"),
  start_date: z.string().optional(),
  scheduleText: z.string().optional(),
});

type ClassFormValues = z.infer<typeof classSchema>;

const defaultValues: ClassFormValues = {
  name: "",
  type: "MONTHLY",
  base_fee: 0,
  billing_cycle_months: 1,
  start_date: "",
  scheduleText: "",
};

function getScheduleText(class_: ClassResponse | null): string {
  if (!class_?.schedule) {
    return "";
  }

  if (typeof class_.schedule.text === "string") {
    return class_.schedule.text;
  }

  return JSON.stringify(class_.schedule);
}

function toPayload(values: ClassFormValues) {
  const scheduleText = values.scheduleText?.trim();

  return {
    name: values.name.trim(),
    type: values.type,
    base_fee: values.base_fee,
    billing_cycle_months: values.type === "MONTHLY" ? 1 : values.billing_cycle_months,
    start_date: values.start_date || null,
    end_date: null,
    schedule: scheduleText ? { text: scheduleText } : null,
  };
}

export default function ClassesPage() {
  return (
    <QueryProvider>
      <ClassesContent />
    </QueryProvider>
  );
}

function ClassesContent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ClassType | "">("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [editingClass, setEditingClass] = useState<ClassResponse | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ClassResponse | null>(null);
  const [toast, setToast] = useState("");

  const filters = useMemo(
    () => ({
      search: search.trim(),
      type,
      is_active: activeFilter === "active",
    }),
    [activeFilter, search, type],
  );

  const classesQuery = useQuery({
    queryKey: ["classes", filters],
    queryFn: () => getClasses(filters),
  });

  const createMutation = useMutation({
    mutationFn: createClass,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      setIsFormOpen(false);
      setToast("Đã thêm lớp học");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ClassFormValues }) =>
      updateClass(id, toPayload(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      setIsFormOpen(false);
      setEditingClass(null);
      setToast("Đã cập nhật lớp học");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteClass,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      setDeleteTarget(null);
      setToast("Đã ẩn lớp học");
    },
  });

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => setToast(""), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  function openCreateForm() {
    setEditingClass(null);
    setIsFormOpen(true);
  }

  function openEditForm(class_: ClassResponse) {
    setEditingClass(class_);
    setIsFormOpen(true);
  }

  const classes = classesQuery.data ?? [];
  const isMutating =
    createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">Lớp học</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-700">
            {classes.length}
          </span>
        </div>
        {isAdmin ? (
          <Button className="h-10 rounded-md px-3" onClick={openCreateForm}>
            <Plus className="h-4 w-4" />
            Thêm lớp
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 border-y border-gray-200 py-4 md:grid-cols-[minmax(0,1fr)_180px_180px]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm tên lớp..."
          className="h-10 rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
        />
        <select
          value={type}
          onChange={(event) => setType(event.target.value as ClassType | "")}
          className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
        >
          <option value="">Tất cả</option>
          <option value="MONTHLY">Theo tháng</option>
          <option value="COURSE">Theo gói</option>
        </select>
        <select
          value={activeFilter}
          onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
          className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
        >
          <option value="active">Đang hoạt động</option>
          <option value="hidden">Đã ẩn</option>
        </select>
      </div>

      {classesQuery.isLoading ? <ClassesSkeleton /> : null}

      {classesQuery.isError ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-red-100 bg-red-50 px-4 text-center">
          <p className="text-sm text-red-700">Không tải được danh sách lớp học.</p>
          <Button
            variant="outline"
            onClick={() => classesQuery.refetch()}
            className="h-9 rounded-md"
          >
            <RefreshCw className="h-4 w-4" />
            Thử lại
          </Button>
        </div>
      ) : null}

      {!classesQuery.isLoading && !classesQuery.isError ? (
        classes.length > 0 ? (
          <ClassesTable
            classes={classes}
            isAdmin={isAdmin}
            onEdit={openEditForm}
            onDelete={setDeleteTarget}
          />
        ) : (
          <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-gray-300 px-4 text-center text-sm text-gray-500">
            Chưa có lớp học nào. Bấm &apos;+ Thêm lớp&apos; để bắt đầu.
          </div>
        )
      ) : null}

      {isFormOpen ? (
        <ClassFormDialog
          class_={editingClass}
          isSaving={isMutating}
          onClose={() => {
            setIsFormOpen(false);
            setEditingClass(null);
          }}
          onSubmit={(values) => {
            if (editingClass) {
              updateMutation.mutate({ id: editingClass.id, values });
            } else {
              createMutation.mutate(toPayload(values));
            }
          }}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteDialog
          class_={deleteTarget}
          isDeleting={deleteMutation.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-5 right-5 z-50 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function ClassesTable({
  classes,
  isAdmin,
  onDelete,
  onEdit,
}: {
  classes: ClassResponse[];
  isAdmin: boolean;
  onDelete: (class_: ClassResponse) => void;
  onEdit: (class_: ClassResponse) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3">Tên lớp</th>
            <th className="px-4 py-3">Loại</th>
            <th className="px-4 py-3">Học phí mỗi lần thu</th>
            <th className="px-4 py-3">Chu kỳ thu</th>
            <th className="px-4 py-3">Số học viên</th>
            <th className="px-4 py-3">Trạng thái</th>
            <th className="px-4 py-3 text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {classes.map((class_) => (
            <tr key={class_.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">{class_.name}</td>
              <td className="px-4 py-3 text-gray-700">{formatClassType(class_.type)}</td>
              <td className="px-4 py-3 text-gray-700">
                {formatCurrency(class_.base_fee)}
              </td>
              <td className="px-4 py-3 text-gray-700">
                {formatBillingCycle(class_.type, class_.billing_cycle_months)}
              </td>
              <td className="px-4 py-3 text-gray-700">{class_.student_count}</td>
              <td className="px-4 py-3">
                <span
                  className={
                    class_.is_active
                      ? "rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                      : "rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600"
                  }
                >
                  {class_.is_active ? "Đang hoạt động" : "Đã ẩn"}
                </span>
              </td>
              <td className="px-4 py-3">
                {isAdmin ? (
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      title="Sửa lớp"
                      onClick={() => onEdit(class_)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Ẩn lớp"
                      onClick={() => onDelete(class_)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-100 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <span className="flex justify-end text-gray-400">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassesSkeleton() {
  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
      <div className="grid grid-cols-7 gap-4 border-b border-gray-200 bg-gray-50 px-4 py-3">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="h-3 rounded bg-gray-200" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-7 gap-4 border-b border-gray-100 px-4 py-4">
          {Array.from({ length: 7 }).map((_, cellIndex) => (
            <div key={cellIndex} className="h-4 rounded bg-gray-100" />
          ))}
        </div>
      ))}
    </div>
  );
}

function ClassFormDialog({
  class_,
  isSaving,
  onClose,
  onSubmit,
}: {
  class_: ClassResponse | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: ClassFormValues) => void;
}) {
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setValue,
    watch,
  } = useForm<ClassFormValues>({
    resolver: zodResolver(classSchema),
    defaultValues,
  });
  const selectedType = watch("type");

  useEffect(() => {
    reset(
      class_
        ? {
            name: class_.name,
            type: class_.type,
            base_fee: class_.base_fee,
            billing_cycle_months: class_.billing_cycle_months,
            start_date: class_.start_date ?? "",
            scheduleText: getScheduleText(class_),
          }
        : defaultValues,
    );
  }, [class_, reset]);

  useEffect(() => {
    if (selectedType === "MONTHLY") {
      setValue("billing_cycle_months", 1);
    }
  }, [selectedType, setValue]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-xl rounded-md bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {class_ ? "Sửa lớp học" : "Thêm lớp học"}
          </h2>
          <button
            type="button"
            title="Đóng"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 px-5 py-4" onSubmit={handleSubmit(onSubmit)}>
          <Field label="Tên lớp" error={errors.name?.message}>
            <input
              {...register("name")}
              className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Loại" error={errors.type?.message}>
              <select
                {...register("type")}
                className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
              >
                <option value="MONTHLY">Theo tháng</option>
                <option value="COURSE">Theo gói</option>
              </select>
            </Field>
            <Field label="Học phí mỗi lần thu" error={errors.base_fee?.message}>
              <input
                type="number"
                min={0}
                step={1000}
                {...register("base_fee", { valueAsNumber: true })}
                className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
              />
            </Field>
          </div>

          {selectedType === "COURSE" ? (
            <Field label="Số tháng mỗi lần thu" error={errors.billing_cycle_months?.message}>
              <input
                type="number"
                min={2}
                step={1}
                {...register("billing_cycle_months", { valueAsNumber: true })}
                className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
              />
            </Field>
          ) : null}

          <Field label="Ngày bắt đầu" error={errors.start_date?.message}>
            <input
              type="date"
              {...register("start_date")}
              className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
            />
          </Field>

          <Field label="Lịch học" error={errors.scheduleText?.message}>
            <textarea
              {...register("scheduleText")}
              placeholder="VD: Thứ 2, 4, 6 - 18:00-20:00"
              rows={3}
              className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
            />
          </Field>

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
            <Button type="button" variant="outline" className="h-10 rounded-md" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" className="h-10 rounded-md" disabled={isSaving}>
              {isSaving ? "Đang lưu" : "Lưu"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteDialog({
  class_,
  isDeleting,
  onClose,
  onConfirm,
}: {
  class_: ClassResponse;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-md bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">Ẩn lớp học</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          Bạn có chắc muốn ẩn lớp {class_.name}? Dữ liệu học phí sẽ không bị xoá.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-10 rounded-md" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-10 rounded-md"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? "Đang ẩn" : "Ẩn lớp"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  children,
  error,
  label,
}: {
  children: React.ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
      {error ? <span className="block text-sm text-red-600">{error}</span> : null}
    </label>
  );
}
