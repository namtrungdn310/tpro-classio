import type { StudentHiddenField } from "@/lib/types";

type StudentPrivacyState = {
  hidden_fields: readonly StudentHiddenField[];
};

export const STUDENT_HIDDEN_FIELD_OPTIONS: ReadonlyArray<{
  field: StudentHiddenField;
  label: string;
}> = [
  { field: "birth_date", label: "Ngày sinh" },
  { field: "school", label: "Trường" },
  { field: "enrollment_date", label: "Ngày bắt đầu" },
  { field: "custom_fee", label: "Học phí riêng" },
  { field: "student_contact", label: "Liên hệ học viên" },
  { field: "parent_contact", label: "Liên hệ phụ huynh" },
  { field: "notes", label: "Ghi chú" },
];

export function isStudentFieldHidden(
  student: StudentPrivacyState,
  field: StudentHiddenField,
) {
  return student.hidden_fields.includes(field);
}

export function getStudentVisibleValue<T>(
  student: StudentPrivacyState,
  field: StudentHiddenField,
  value: T,
): T | null {
  return isStudentFieldHidden(student, field) ? null : value;
}

export function getStudentExportValue<T>(
  student: StudentPrivacyState,
  field: StudentHiddenField,
  value: T,
): T | "" {
  return isStudentFieldHidden(student, field) ? "" : value;
}
