import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hasOperationalAssignment,
  getStaffScope,
  prepareStaffRecords,
} from "../src/lib/staff/presentation";
import { classFormSchema } from "../src/components/classes/class-form-dialog";
import { staffQueryKeys } from "../src/lib/staff/query-keys";
import type { StaffResponse } from "../src/lib/types";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const classFormSource = source("../src/components/classes/class-form-dialog.tsx");
const classesPageSource = source("../src/app/(dashboard)/classes/page.tsx");
const staffWorkspaceSource = source("../src/components/staff/staff-workspace-dialog.tsx");
const userAccessSource = source("../src/components/settings/user-access-panel.tsx");
const exportSource = source("../src/lib/staff/export.ts");
const dashboardSource = source("../src/app/(dashboard)/dashboard-client.tsx");
const apiClassesSource = source("../src/lib/api/classes.ts");
const apiStaffSource = source("../src/lib/api/staff.ts");
const continuationSource = source("../src/components/classes/class-continuation-workspace.tsx");

function makeStaff(overrides: Partial<StaffResponse> = {}): StaffResponse {
  return {
    id: "65c4e260-cf9f-4d81-8365-d293bf24804e",
    full_name: "Nguyễn Văn A",
    zalo_name: "Nguyễn Văn A",
    phone: "0901234567",
    email: "a@tpro.test",
    checkin_window_after_hours: 24,
    current_rate: null,
    attendance_account_status: "not_connected",
    is_active: true,
    assigned_classes: [],
    created_at: "2026-08-01T08:00:00+07:00",
    updated_at: "2026-08-01T08:00:00+07:00",
    ...overrides,
  };
}

test("1. Nhân sự chỉ có lớp đã ngừng phải thuộc 'Chưa phân công'", () => {
  const staff = makeStaff({
    assigned_classes: [
      {
        id: "c1",
        name: "Lớp cũ 1",
        is_active: false,
        role: "TEACHER",
      },
      {
        id: "c2",
        name: "Lớp cũ 2",
        is_active: false,
        role: "ASSISTANT",
      },
    ],
  });

  assert.equal(hasOperationalAssignment(staff.assigned_classes), false);
  assert.equal(getStaffScope(staff), "unassigned");

  const [record] = prepareStaffRecords([staff], false);
  assert.equal(record.scope, "unassigned");
  assert.equal(record.hasOperationalAssignment, false);
  assert.equal(record.summaryRoles, "Chưa phân công");
  // Lịch sử các lớp cũ vẫn được giữ nguyên
  assert.equal(record.assignedClasses.length, 2);
  assert.equal(record.activeClasses.length, 0);
});

test("2. Không thể ngừng nhân sự còn lớp operational (đang hoạt động)", () => {
  const staff = makeStaff({
    assigned_classes: [
      {
        id: "c1",
        name: "Lớp 6A",
        is_active: true,
        role: "TEACHER",
      },
    ],
  });

  assert.equal(hasOperationalAssignment(staff.assigned_classes), true);
  assert.equal(getStaffScope(staff), "assigned");

  // Kiểm tra frontend hiển thị cảnh báo và vô hiệu hóa nút ngừng
  assert.match(
    staffWorkspaceSource,
    /Hãy gỡ nhân sự khỏi các lớp đang hoạt động trước/,
  );
  assert.match(
    staffWorkspaceSource,
    /disabled=\{Boolean\(staff\.is_active && hasActiveClasses\)/,
  );
  assert.doesNotMatch(staffWorkspaceSource, /isTeacher/);
});

test("3. Staff options lỗi vẫn tạo được lớp không nhân sự (UNASSIGNED)", () => {
  const validUnassigned = {
    name: "Lớp 10A1",
    identity_scheme: "ACADEMIC_YEAR",
    class_category: "GENERAL",
    grade_mode: "GRADE",
    grade_level: 10,
    academic_year_start: 2026,
    start_date: "2026-09-10",
    type: "MONTHLY",
    base_fee: 1000000,
    billing_cycle_months: 1,
    billing_cycle_weeks: null,
    teacher_ids: [],
    assistant_ids: [],
  };

  const parsed = classFormSchema.safeParse(validUnassigned);
  assert.equal(parsed.success, true);

  // Form không bắt buộc teacher_ids > 0
  assert.match(classFormSource, /teacher_ids: z\.array\(z\.string\(\)\.uuid\(\)\)\.max\(10\)\.default\(\[\]\)/);
  assert.match(classFormSource, /assistant_ids: z\.array\(z\.string\(\)\.uuid\(\)\)\.max\(10\)\.default\(\[\]\)/);
});

test("4. Loading staff options không khóa nút Thêm lớp và không làm toàn trang hiện skeleton", () => {
  assert.doesNotMatch(classesPageSource, /isTeacherOptionsInitialLoading/);
  assert.doesNotMatch(classesPageSource, /isTeacherOptionsLoading/);
  // Button thêm lớp chỉ phụ thuộc vào isSummaryInitialLoading, không bị chặn bởi staff options
  assert.match(classesPageSource, /disabled=\{isSummaryInitialLoading\}/);
});

test("5. Màn hình cấp tài khoản điểm danh không lọc theo staff_type và cho phép chọn mọi nhân sự active", () => {
  assert.doesNotMatch(userAccessSource, /staff_type === "TEACHER"/);
  assert.match(userAccessSource, /staffQueryKeys\.staffOptions/);
  assert.match(userAccessSource, /getActiveStaffOptions/);
  assert.match(userAccessSource, /Nhân sự chấm công/);
  assert.match(userAccessSource, /Hồ sơ nhân sự/);
});

test("6. Export nhân sự không dùng vai trò hồ sơ cũ mà dùng vai trò theo lớp", () => {
  assert.doesNotMatch(exportSource, /record\.staff\.staff_type/);
  assert.match(exportSource, /summaryRoles/);
});

test("7. Dashboard dùng active_staff_count và unstaffed_class_count thay thế tách biệt Giáo viên/Trợ giảng", () => {
  assert.match(dashboardSource, /label="Nhân sự"/);
  assert.match(dashboardSource, /summary\.active_staff_count/);
  assert.match(dashboardSource, /label="Cần phân công"/);
  assert.match(dashboardSource, /summary\.unstaffed_class_count/);
  assert.doesNotMatch(dashboardSource, /active_teacher_count/);
  assert.doesNotMatch(dashboardSource, /active_assistant_count/);
});

test("8. Preview state machine: draftKey, lock Save khi lỗi/timeout hoặc có nhân sự", () => {
  assert.match(classFormSource, /draftKey/);
  assert.match(classFormSource, /slotFingerprint/);
  assert.match(classFormSource, /candidateStaffIds/);
  assert.match(classFormSource, /previewStaffAvailability/);
  assert.match(classFormSource, /current\.draftKey !== draftKey/);
  assert.match(
    classFormSource,
    /Một nhân sự không thể vừa là giáo viên vừa là trợ giảng trong cùng lớp/,
  );
  assert.match(
    classFormSource,
    /Không tải được danh sách nhân sự\. Bạn vẫn có thể lưu lớp mà không phân công nhân sự\./,
  );
});

test("9. Không gọi preview khi candidate_staff_ids rỗng", () => {
  assert.match(
    classFormSource,
    /if \(candidateStaffIds\.length === 0\) \{\s*setPreviewState\({\s*isChecking: false,\s*error: null,\s*canApply: true,\s*candidates: \[\],\s*draftKey,\s*}\);\s*return;\s*\}/,
  );
});

test("10. API helper paths are correctly proxy-scoped without duplicate /api prefix", () => {
  assert.match(apiStaffSource, /apiClient\.get<TeacherOptionResponse\[\]>\("\/staff\/options"\)/);
  assert.match(apiClassesSource, /apiClient\.post<StaffAvailabilityPreviewResponse>\(\s*"\/classes\/staff-availability"/);
  assert.match(apiClassesSource, /apiClient\.post<[^>]+>\("\/classes\/schedule-availability"/);
  assert.doesNotMatch(apiStaffSource, /"\/api\/staff\/options"/);
  assert.doesNotMatch(apiClassesSource, /"\/api\/classes\/staff-availability"/);
});

test("11. Luồng tạo lớp kế tiếp dùng cùng ClassFormDialog tiếp tục hoạt động", () => {
  assert.match(continuationSource, /<ClassFormDialog/);
  assert.match(continuationSource, /initialValues=\{initialValues\}/);
  assert.match(continuationSource, /additionalSection=/);
});

test("12. Kiểm tra không còn import/query key/component cũ bị bỏ quên", () => {
  assert.doesNotMatch(classFormSource, /TeacherSlide/);
  assert.doesNotMatch(classFormSource, /isTeacherSlideOpen/);
  assert.doesNotMatch(classFormSource, /teacher_id:/);
  assert.equal(typeof staffQueryKeys.staffOptions, "object");
  assert.equal(staffQueryKeys.staffOptions[0], "staff");
  assert.equal(staffQueryKeys.staffOptions[1], "options");
});
