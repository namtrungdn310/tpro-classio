const COMPACT_STUDENT_CODE = /^TP\d{9}$/;

export function normalizeStudentCode(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function formatStudentCode(value: string): string {
  const compact = normalizeStudentCode(value);
  if (!COMPACT_STUDENT_CODE.test(compact)) return value;
  const digits = compact.slice(2);
  return `TP-${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
}
