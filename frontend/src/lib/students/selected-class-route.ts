const STUDENT_CLASS_QUERY_PARAM = "class";
const STUDENT_CLASS_STORAGE_PREFIX = "tpro:students:selected-class";

export function normalizeSelectedStudentClassId(value: string | null | undefined): string {
  return value?.trim().slice(0, 128) ?? "";
}

export function buildStudentsHref(classId?: string | null): string {
  const normalizedClassId = normalizeSelectedStudentClassId(classId);
  if (!normalizedClassId) {
    return "/students";
  }

  const params = new URLSearchParams({ [STUDENT_CLASS_QUERY_PARAM]: normalizedClassId });
  return `/students?${params.toString()}`;
}

export function getSelectedStudentClassFromSearchParams(searchParams: URLSearchParams): string {
  return normalizeSelectedStudentClassId(searchParams.get(STUDENT_CLASS_QUERY_PARAM));
}

export function replaceSelectedStudentClassInSearchParams(
  searchParams: URLSearchParams,
  classId?: string | null,
): string {
  const nextParams = new URLSearchParams(searchParams);
  const normalizedClassId = normalizeSelectedStudentClassId(classId);

  if (normalizedClassId) {
    nextParams.set(STUDENT_CLASS_QUERY_PARAM, normalizedClassId);
  } else {
    nextParams.delete(STUDENT_CLASS_QUERY_PARAM);
  }

  const query = nextParams.toString();
  return query ? `/students?${query}` : "/students";
}

function getStorageKey(userId: string): string {
  return `${STUDENT_CLASS_STORAGE_PREFIX}:${userId}`;
}

export function readRememberedStudentClass(userId: string | null | undefined): string {
  if (!userId || typeof window === "undefined") {
    return "";
  }

  try {
    return normalizeSelectedStudentClassId(window.sessionStorage.getItem(getStorageKey(userId)));
  } catch {
    return "";
  }
}

export function rememberStudentClass(
  userId: string | null | undefined,
  classId?: string | null,
): void {
  if (!userId || typeof window === "undefined") {
    return;
  }

  try {
    const normalizedClassId = normalizeSelectedStudentClassId(classId);
    if (normalizedClassId) {
      window.sessionStorage.setItem(getStorageKey(userId), normalizedClassId);
    } else {
      window.sessionStorage.removeItem(getStorageKey(userId));
    }
  } catch {
    // URL remains the source of truth when session storage is unavailable.
  }
}

export function forgetRememberedStudentClass(userId: string | null | undefined): void {
  rememberStudentClass(userId, "");
}
