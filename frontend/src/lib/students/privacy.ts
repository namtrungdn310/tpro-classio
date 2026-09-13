import type { StudentHiddenField } from "@/lib/types";

type StudentPrivacyState = {
  hidden_fields: readonly StudentHiddenField[];
};

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
