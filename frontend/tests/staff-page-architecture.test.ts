import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/(dashboard)/staff/page.tsx", import.meta.url),
  "utf8",
);
const workspaceSource = readFileSync(
  new URL("../src/components/staff/staff-workspace-dialog.tsx", import.meta.url),
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
const payrollSource = readFileSync(
  new URL("../src/components/staff/staff-payroll-dialog.tsx", import.meta.url),
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

test("staff class assignments and attendance email connection stay visible to managers", () => {
  assert.match(tableSource, /join\(", "\)/);
  assert.match(tableSource, /Kết nối Email \(Chấm công\)/);
  assert.match(tableSource, /<AttendanceEmailConnection staff=\{staff\} \/>/);
  assert.match(tableSource, /Đã kết nối/);
  assert.match(tableSource, /Tài khoản bị vô hiệu hóa/);
  assert.match(tableSource, /Lời mời hết hạn/);
  assert.match(tableSource, /staff\.email/);
  assert.match(tableSource, /canManage \? <ColumnHeader>Kết nối Email/);
});

test("staff form aligns name and role while assignments span the full form row", () => {
  assert.match(formSource, /<FormDialogShell/);
  assert.match(formSource, /grid grid-cols-1 items-start gap-3 sm:grid-cols-2/);
  assert.match(formSource, /<SegmentedControl/);
  assert.match(formSource, /width=\{staff \? "md" : "standard"\}/);
  assert.match(
    formSource,
    /label="Họ và tên"[\s\S]*?label="Vai trò"[\s\S]*?Đang phụ trách:/,
  );
  assert.match(formSource, /helper-text min-w-0 select-none text-gray-500 sm:col-span-2/);
  assert.match(formSource, /aria-describedby=\{fullNameDescription\}/);
  assert.equal(
    (formSource.match(/autoComplete=\{savedInfoAutocomplete\.disabled\}/g) ?? []).length,
    6,
  );
  assert.match(formSource, /\.\.\.noSavedInfoFormProps/);
  assert.match(formSource, /<SplitTextField/);
  assert.doesNotMatch(formSource, /compound-text-field/);
  assert.doesNotMatch(formSource, /<CompoundFieldDivider/);
  assert.doesNotMatch(formSource, /h-4 w-px bg-gray-(?:300|600)/);
  assert.doesNotMatch(formSource, /placeholder="cohanh@example\.com"/);
  assert.match(formSource, /<SaveButton/);
});

test("staff header keeps search and actions focused without a redundant active total", () => {
  assert.doesNotMatch(pageSource, /StaffListStatus|countActiveStaff|nhân sự hoạt động/);
  assert.doesNotMatch(pageSource, /filteredCount=\{filteredStaff\.length\}/);
  assert.match(pageSource, /Tìm tên, email, SĐT, lớp\.\.\./);
  assert.match(pageSource, /Tìm tên, vai trò, lớp\.\.\./);
  assert.doesNotMatch(pageSource, /lớp phụ trách\.\.\./);
});

test("staff row click opens workspace directly with no intermediate actions dialog", () => {
  assert.match(pageSource, /<StaffWorkspaceDialog/);
  assert.doesNotMatch(pageSource, /EntityActionsDialog/);
  assert.doesNotMatch(pageSource, /actionTarget/);
});

test("staff workspace rail includes permitted actions and matches standard sizing", () => {
  assert.match(workspaceSource, /role="tablist"/);
  assert.match(workspaceSource, /aria-selected=\{active\}/);
  assert.match(workspaceSource, /aria-controls="staff-workspace-panel"/);
  assert.match(workspaceSource, /isTeacher/);
  assert.match(
    workspaceSource,
    /sm:h-\[min\(680px,calc\(100dvh-2rem\)\)\].*sm:max-w-\[640px\]/,
  );
  assert.match(
    workspaceSource,
    /workspace-action-rail-in absolute left-full top-0 z-20 ml-3 hidden min-\[900px\]:block/,
  );
});

test("staff prefetch uses the consumed all-staff query without the obsolete teacher list", () => {
  assert.match(prefetchSource, /prefetchIfStale\(queryClient, staffQueryKeys\.list/);
  assert.doesNotMatch(prefetchSource, /staff_type: "TEACHER"/);
});

test("bank-transfer payroll requires and records the selected workspace account", () => {
  assert.match(payrollSource, /queryFn: getBankAccounts/);
  assert.match(payrollSource, /Tài khoản dùng để tất toán/);
  assert.match(payrollSource, /settlement_account_id:/);
  assert.match(payrollSource, /method === "bank_transfer" && !settlementAccountId/);
  assert.match(payrollSource, /helper-text mt-1\.5 block select-none text-gray-500/);
  assert.match(payrollSource, /settlement\.settlement_bank_name/);
});
