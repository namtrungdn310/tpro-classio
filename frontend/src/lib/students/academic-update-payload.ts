import type { StudentEnrollmentInfo, StudentEnrollmentPatchItem } from "@/lib/types";

export type AcademicEnrollmentDraft = {
  custom_fee: number | null;
  enrollment_date: string | null;
  selected_slot_ids: string[];
};

/** The exact same patch is used for preview and apply, including omitted fields. */
export function buildAcademicUpdates(
  enrollments: StudentEnrollmentInfo[],
  drafts: Record<string, AcademicEnrollmentDraft>,
  reason = "Điều chỉnh ngày ghi danh theo hồ sơ học viên",
  classes?: Array<{ id: string; schedule?: { slots?: Array<{ id?: string | null }> | null } | null }>,
): StudentEnrollmentPatchItem[] {
  return enrollments.flatMap((enrollment) => {
    const draft = drafts[enrollment.id];
    if (!draft) return [];
    const patch: StudentEnrollmentPatchItem = { enrollment_id: enrollment.id };
    if (draft.custom_fee !== enrollment.custom_fee) patch.custom_fee = draft.custom_fee;
    if (draft.enrollment_date !== enrollment.enrollment_date) {
      if (draft.custom_fee !== enrollment.custom_fee) throw new Error("Vui lòng lưu học phí riêng với thay đổi ngày ghi danh");
      if (enrollment.admission_version === undefined) throw new Error("Vui lòng tải lại hồ sơ trước khi sửa ngày ghi danh");
      patch.enrollment_date = draft.enrollment_date;
      patch.expected_admission_version = enrollment.admission_version;
      patch.billing_change_reason = reason;
    }
    const initialSlots = (enrollment.selected_slot_ids?.length || !classes)
      ? enrollment.selected_slot_ids
      : (classes.find((c) => c.id === enrollment.class_id)?.schedule?.slots?.flatMap((s) => s.id ? [s.id] : []) ?? []);
    if (JSON.stringify([...draft.selected_slot_ids].sort()) !== JSON.stringify([...initialSlots].sort())) {
      patch.selected_slot_ids = [...draft.selected_slot_ids];
    }
    return Object.keys(patch).length > 1 ? [patch] : [];
  });
}
