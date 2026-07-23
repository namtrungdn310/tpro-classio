import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/(dashboard)/staff/page.tsx", import.meta.url),
  "utf8",
);
const tableSource = readFileSync(
  new URL("../src/components/staff/staff-table.tsx", import.meta.url),
  "utf8",
);
const formSource = readFileSync(
  new URL("../src/components/staff/staff-form-dialog.tsx", import.meta.url),
  "utf8",
);
const prefetchSource = readFileSync(
  new URL("../src/lib/query-prefetch.ts", import.meta.url),
  "utf8",
);

test("staff mutations update only the exact staff list cache", () => {
  assert.match(pageSource, /setQueryData<StaffResponse\[\]>\(staffQueryKeys\.list/);
  assert.doesNotMatch(pageSource, /setQueriesData<StaffResponse\[\]>/);
});

test("staff page keeps horizontal overflow disabled and never truncates values", () => {
  assert.match(tableSource, /overflow-x-hidden/);
  assert.doesNotMatch(tableSource, /overflow-x-auto/);
  assert.doesNotMatch(tableSource, /\btruncate\b/);
});

test("staff class assignments use comma separators and account linkage is absent", () => {
  assert.match(tableSource, /join\(", "\)/);
  assert.doesNotMatch(tableSource, /AccountSummary|Tài khoản|staff\.email/);
});

test("staff form aligns name and role while assignments span the full form row", () => {
  assert.match(formSource, /section-title-text min-w-0 select-none/);
  assert.match(formSource, /grid grid-cols-1 items-start gap-3 sm:grid-cols-2/);
  assert.match(formSource, /grid h-8 w-full select-none grid-cols-2/);
  assert.match(formSource, /sm:max-w-\[536px\]/);
  assert.match(
    formSource,
    /label="Họ và tên"[\s\S]*?label="Vai trò"[\s\S]*?Đang phụ trách:/,
  );
  assert.match(formSource, /helper-text min-w-0 select-none text-gray-500 sm:col-span-2/);
  assert.match(formSource, /aria-describedby=\{fullNameDescription\}/);
  assert.equal(
    (formSource.match(/autoComplete=\{savedInfoAutocomplete\.disabled\}/g) ?? []).length,
    3,
  );
  assert.match(formSource, /\.\.\.noSavedInfoFormProps/);
  assert.match(formSource, /flex h-full min-h-0 w-full flex-col overflow-hidden/);
  assert.match(formSource, /<InlineFieldDivider \/>/);
  assert.doesNotMatch(formSource, /h-4 w-px bg-gray-(?:300|600)/);
  assert.match(formSource, /<SaveButton/);
});

test("staff header keeps the active total independent from search and filters", () => {
  assert.match(pageSource, /countActiveStaff\(staff\)/);
  assert.match(pageSource, /\{activeCount\} nhân sự hoạt động/);
  assert.doesNotMatch(pageSource, /filteredCount=\{filteredStaff\.length\}/);
  assert.match(pageSource, /Tìm tên, Zalo, SĐT, lớp\.\.\./);
  assert.match(pageSource, /Tìm tên, vai trò, lớp\.\.\./);
  assert.doesNotMatch(pageSource, /lớp phụ trách\.\.\./);
});

test("staff status action is teacher-only and uses the danger treatment", () => {
  assert.match(tableSource, /staff\.staff_type === "TEACHER"/);
  assert.match(pageSource, /record\.staff\.staff_type !== "TEACHER"/);
  assert.match(tableSource, /tone=\{staff\.is_active \? "danger" : "success"\}/);
  assert.doesNotMatch(tableSource, /warning|amber-/);
});

test("staff prefetch uses the consumed all-staff query without the obsolete teacher list", () => {
  assert.match(prefetchSource, /prefetchIfStale\(queryClient, staffQueryKeys\.list/);
  assert.doesNotMatch(prefetchSource, /staff_type: "TEACHER"/);
});
