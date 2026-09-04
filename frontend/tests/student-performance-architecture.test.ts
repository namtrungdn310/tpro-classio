import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../src/lib/api/students.ts", import.meta.url),
  "utf8",
);
const proxySource = readFileSync(
  new URL("../src/app/api/proxy/[...path]/route.ts", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("../../backend/app/services/student_service.py", import.meta.url),
  "utf8",
);

test("student requests are cancelable and class intent warms the consumed infinite cache", () => {
  assert.match(apiSource, /signal\?: AbortSignal/);
  assert.match(apiSource, /signal,/);
  assert.match(pageSource, /prefetchInfiniteQuery/);
  assert.match(pageSource, /studentQueryKeys\.list\(nextFilters\)/);
  assert.doesNotMatch(pageSource, /prefetchQuery\(\{[\s\S]{0,180}queryKey: \["students"/);
});
test("student interactions transition immediately without re-sorting every loaded page", () => {
  assert.match(pageSource, /startNavigationTransition\(\(\) => router\.replace/);
  assert.match(pageSource, /const \[isNavigationPending, startNavigationTransition\] = useTransition\(\)/);
  assert.match(pageSource, /const \[view, setView\] = useState<StudentView>\(routeView\)/);
  assert.match(pageSource, /const \[classId, setClassId\] = useState\(routeClassId\)/);
  assert.match(pageSource, /setView\(nextView\);[\s\S]{0,120}startNavigationTransition/);
  assert.match(pageSource, /setClassId\(nextClassId\);[\s\S]{0,80}startNavigationTransition/);
  assert.doesNotMatch(pageSource, /useOptimistic/);
  assert.doesNotMatch(pageSource, /compareStudentsByCreationOrder/);
  assert.match(pageSource, /queryClient\.setQueryData\(studentQueryKeys\.detail/);
});

test("student export fetches the entire filtered class result, not only rendered pages", () => {
  assert.match(pageSource, /const exportStudentsData: StudentResponse\[\] = \[\]/);
  assert.match(pageSource, /limit: 500/);
  assert.match(pageSource, /while \(cursor\)/);
  assert.match(pageSource, /exportStudents\(exportStudentsData, selectedClass\)/);
});

test("student counters use one database execution instead of four sequential scalar calls", () => {
  const summaryStart = serviceSource.indexOf("async def get_student_scope_summary");
  const summaryEnd = serviceSource.indexOf("\ndef _apply_student_search_filter", summaryStart);
  const summarySource = serviceSource.slice(summaryStart, summaryEnd);
  assert.equal((summarySource.match(/await db\.execute/g) ?? []).length, 1);
  assert.doesNotMatch(summarySource, /for state, key/);
  assert.doesNotMatch(summarySource, /await db\.scalar/);
});

test("class rosters use server-side student-code ordering with matching keyset pagination", () => {
  assert.match(
    serviceSource,
    /order_by\(Student\.student_code\.asc\(\)\.nulls_last\(\), Student\.id\.asc\(\)\)/,
  );
  assert.match(serviceSource, /Student\.student_code > cursor_row\.student_code/);
  assert.match(serviceSource, /Student\.student_code == cursor_row\.student_code/);
  assert.match(serviceSource, /Student\.student_code\.is_\(None\)/);
});

test("student membership saves avoid recursive class loading and have a targeted request budget", () => {
  assert.match(serviceSource, /def _student_response_load_options\(\)/);
  assert.match(
    serviceSource,
    /selectinload\(Enrollment\.class_\)\.raiseload\("\*"\)/,
  );
  assert.match(serviceSource, /selectinload\(Enrollment\.slot_selections\)/);
  assert.match(
    apiSource,
    /`\/students\/\$\{id\}\/membership-command`, data, \{\s*timeout: 60_000/,
  );
  assert.match(proxySource, /LONG_STUDENT_MUTATION_TIMEOUT_MS = 60_000/);
  assert.match(proxySource, /students\\\/\[0-9a-f-\]\+\\\/membership-command/);
});
