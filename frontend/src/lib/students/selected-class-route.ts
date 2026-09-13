const STUDENT_CLASS_QUERY_PARAM = "class";
const STUDENT_CLASS_STORAGE_PREFIX = "tpro:students:selected-class";
const STUDENT_CLASS_RELOAD_MARKER = Symbol.for(
  "tpro.students.selected-class.reload-policy",
);

type StudentClassNavigationState = {
  navigationType: string;
  pathname: string;
  rememberedClassId: string;
  selectedClassId: string;
};

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

/**
 * A class remains selected during client-side navigation. A document reload
 * keeps it only when the canonical students URL still names that class;
 * reloading any other page starts the next students visit at the class list.
 */
export function resolveRememberedStudentClassAfterNavigation({
  navigationType,
  pathname,
  rememberedClassId,
  selectedClassId,
}: StudentClassNavigationState): string {
  const normalizedRememberedClassId =
    normalizeSelectedStudentClassId(rememberedClassId);
  if (navigationType !== "reload") {
    return normalizedRememberedClassId;
  }

  if (pathname === "/students") {
    return normalizeSelectedStudentClassId(selectedClassId);
  }

  return "";
}

export function readRememberedStudentClass(userId: string | null | undefined): string {
  if (!userId || typeof window === "undefined") {
    return "";
  }

  try {
    applyStudentClassReloadPolicy(userId);
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
    applyStudentClassReloadPolicy(userId);
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

function applyStudentClassReloadPolicy(userId: string): void {
  const existingHandledUsers = Reflect.get(
    window,
    STUDENT_CLASS_RELOAD_MARKER,
  );
  const handledUsers =
    existingHandledUsers instanceof Set
      ? (existingHandledUsers as Set<string>)
      : new Set<string>();
  if (handledUsers.has(userId)) {
    return;
  }

  // Mark the current document before touching storage so a blocked storage
  // implementation cannot make the policy run repeatedly.
  handledUsers.add(userId);
  Reflect.set(window, STUDENT_CLASS_RELOAD_MARKER, handledUsers);

  const navigationEntry = window.performance?.getEntriesByType(
    "navigation",
  )[0] as PerformanceNavigationTiming | undefined;
  const navigationType = navigationEntry?.type ?? "";
  if (navigationType !== "reload") {
    return;
  }

  const storageKey = getStorageKey(userId);
  const rememberedClassId = window.sessionStorage.getItem(storageKey) ?? "";
  const selectedClassId =
    window.location.pathname === "/students"
      ? getSelectedStudentClassFromSearchParams(
          new URLSearchParams(window.location.search),
        )
      : "";
  const resolvedClassId = resolveRememberedStudentClassAfterNavigation({
    navigationType,
    pathname: window.location.pathname,
    rememberedClassId,
    selectedClassId,
  });

  if (resolvedClassId) {
    window.sessionStorage.setItem(storageKey, resolvedClassId);
  } else {
    window.sessionStorage.removeItem(storageKey);
  }
}
