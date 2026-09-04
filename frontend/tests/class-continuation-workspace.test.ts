import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceSource = readFileSync(
  new URL("../src/components/classes/class-continuation-workspace.tsx", import.meta.url),
  "utf8",
);
const classesApiSource = readFileSync(
  new URL("../src/lib/api/classes.ts", import.meta.url),
  "utf8",
);
const proxySource = readFileSync(
  new URL("../src/app/api/proxy/[...path]/route.ts", import.meta.url),
  "utf8",
);

test("continuation roster and search share one dedicated right-side picker", () => {
  assert.match(workspaceSource, /function StudentPickerSlide/);
  assert.match(workspaceSource, /fixed inset-0 z-\[80\] flex justify-end/);
  assert.match(workspaceSource, /translate-x-full/);
  assert.match(workspaceSource, /Học viên lớp kế tiếp/);
  assert.match(workspaceSource, /Danh sách lớp kế tiếp/);
  assert.match(workspaceSource, /Mới thêm vào lớp/);
  assert.doesNotMatch(workspaceSource, /max-h-52 overflow-y-auto/);
});

test("continuation checkboxes match the banking default-account control", () => {
  assert.match(
    workspaceSource,
    /h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary/,
  );
  assert.match(workspaceSource, /role="checkbox" aria-checked=\{checked\}/);
});

test("continuation roster summary and picker action use one field height", () => {
  assert.match(
    workspaceSource,
    /form-input-text flex h-8 min-w-0 items-center rounded-md border/,
  );
  assert.match(
    workspaceSource,
    /onClick=\{\(\) => setIsStudentPickerOpen\(true\)\} className="form-input-text inline-flex h-8/,
  );
  assert.doesNotMatch(workspaceSource, /flex h-11 min-w-0|inline-flex h-11/);
  assert.match(
    workspaceSource,
    /form-input-text h-8 w-full rounded-md border border-gray-300/,
  );
  assert.doesNotMatch(workspaceSource, /placeholder="Ví dụ: Nguyễn Minh[^\n]+h-11/);
});

test("continuation search excludes matches from unrelated profile fields", () => {
  assert.match(
    workspaceSource,
    /searchMatcher\(\[student\.full_name, student\.student_code\]\)/,
  );
  assert.doesNotMatch(workspaceSource, /searchMatcher\(\[[^\]]*school/);
  assert.doesNotMatch(workspaceSource, /searchMatcher\(\[[^\]]*zalo/);
});

test("continuation creation keeps a targeted long-running request budget", () => {
  assert.match(classesApiSource, /\/continuation`, data, \{[\s\S]*timeout: 60_000/);
  assert.match(proxySource, /LONG_CLASS_MUTATION_TIMEOUT_MS = 60_000/);
  assert.match(proxySource, /classes\\\/\[0-9a-f-\]\+\\\/continuation/);
});

test("each continuation student has an explicit schedule and reviewed fee", () => {
  assert.match(workspaceSource, /function StudentConfiguration/);
  assert.match(workspaceSource, /selected_slots/);
  assert.match(workspaceSource, /partial_fee_reviewed/);
  assert.match(workspaceSource, /Áp dụng gợi ý/);
  assert.doesNotMatch(workspaceSource, /Dùng học phí lớp/);
  assert.match(
    workspaceSource,
    /mt-2 grid grid-cols-\[minmax\(0,1fr\)_auto\] gap-2/,
  );
  assert.match(
    workspaceSource,
    /form-input-text inline-flex h-8 shrink-0 items-center gap-1\.5 rounded-md border border-gray-200 bg-white px-2\.5 font-medium text-primary/,
  );
});

test("search can return to the selected roster without clearing characters manually", () => {
  assert.match(workspaceSource, /aria-label="Xoá tìm kiếm"/);
  assert.match(workspaceSource, /Danh sách lớp kế tiếp \(\{selected\.size\}\)/);
});

test("continuation roster keeps the edited session count after leaving configuration", () => {
  assert.match(
    workspaceSource,
    /sourceStudents\.map\(\(source\) => selected\.get\(source\.student_id\) \?\? source\)/,
  );
});
