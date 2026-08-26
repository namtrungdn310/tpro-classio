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
  assert.match(pageSource, /startTransition\(\(\) => router\.replace/);
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
