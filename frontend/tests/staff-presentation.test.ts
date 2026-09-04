import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndSortStaff,
  hasOperationalAssignment,
  prepareStaffRecords,
  getStaffScope,
  getStaffSummaryRoles,
} from "../src/lib/staff/presentation";
import type { StaffResponse } from "../src/lib/types";

function makeStaff(overrides: Partial<StaffResponse> = {}): StaffResponse {
  return {
    id: "65c4e260-cf9f-4d81-8365-d293bf24804e",
    full_name: "Cô Hạnh",
    zalo_name: "Cô Hạnh",
    phone: "0912345678",
    email: null,
    checkin_window_after_hours: 24,
    current_rate: null,
    attendance_account_status: "not_connected",
    is_active: true,
    assigned_classes: [
      {
        id: "3b56d5ef-b18e-48c8-8fe6-15f3447cf356",
        name: "6C1",
        is_active: true,
        role: "TEACHER",
      },
      {
        id: "8f027de8-346f-436e-8fe6-e6a6d5d6d9bb",
        name: "Lớp cũ",
        is_active: false,
        role: "TEACHER",
      },
    ],
    created_at: "2026-07-16T08:00:00+07:00",
    updated_at: "2026-07-16T08:00:00+07:00",
    ...overrides,
  };
}

test("staff presentation keeps all assignments for history but identifies operational assignment by is_active", () => {
  const staff = makeStaff();
  const [record] = prepareStaffRecords([staff], true);

  assert.equal(hasOperationalAssignment(staff.assigned_classes), true);
  assert.equal(record.hasOperationalAssignment, true);
  assert.equal(record.scope, "assigned");
  assert.deepEqual(record.activeClasses.map((c) => c.name), ["6C1"]);
  assert.deepEqual(record.assignedClasses.map((c) => c.name), ["6C1", "Lớp cũ"]);
});

test("staff with only inactive/stopped classes belongs to unassigned scope (Chưa phân công)", () => {
  const staff = makeStaff({
    assigned_classes: [
      {
        id: "8f027de8-346f-436e-8fe6-e6a6d5d6d9bb",
        name: "Lớp cũ đã dừng",
        is_active: false,
        role: "TEACHER",
      },
    ],
  });
  const [record] = prepareStaffRecords([staff], false);

  assert.equal(hasOperationalAssignment(staff.assigned_classes), false);
  assert.equal(record.hasOperationalAssignment, false);
  assert.equal(getStaffScope(staff), "unassigned");
  assert.equal(record.scope, "unassigned");
  assert.equal(getStaffSummaryRoles(staff.assigned_classes), "Chưa phân công");
  // History is preserved
  assert.equal(record.assignedClasses.length, 1);
  assert.equal(record.activeClasses.length, 0);
});

test("inactive staff member belongs to inactive scope regardless of assigned classes", () => {
  const staff = makeStaff({ is_active: false });
  const [record] = prepareStaffRecords([staff], false);

  assert.equal(getStaffScope(staff), "inactive");
  assert.equal(record.scope, "inactive");
});

test("staff summary roles dynamically reflects roles across operational classes", () => {
  const staff = makeStaff({
    assigned_classes: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Lớp 1",
        is_active: true,
        role: "TEACHER",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        name: "Lớp 2",
        is_active: true,
        role: "ASSISTANT",
      },
    ],
  });
  const [record] = prepareStaffRecords([staff], false);
  assert.equal(record.summaryRoles, "Giáo viên · Trợ giảng");
});

test("viewer search corpus excludes private contact data", () => {
  const staff = [makeStaff({ email: "cohanh@tpro.test" })];
  const publicRecords = prepareStaffRecords(staff, false);
  const privateRecords = prepareStaffRecords(staff, true);

  assert.equal(
    filterAndSortStaff(publicRecords, {
      search: "0912345678",
      scope: "assigned",
    }).length,
    0,
  );
  assert.equal(
    filterAndSortStaff(privateRecords, {
      search: "0912345678",
      scope: "assigned",
    }).length,
    1,
  );
  assert.equal(
    filterAndSortStaff(publicRecords, {
      search: "cohanh@tpro.test",
      scope: "assigned",
    }).length,
    0,
  );
  assert.equal(
    filterAndSortStaff(privateRecords, {
      search: "cohanh@tpro.test",
      scope: "assigned",
    }).length,
    1,
  );
});

test("staff filters by scope while keeping Vietnamese name order", () => {
  const records = prepareStaffRecords(
    [
      makeStaff({ full_name: "Thầy Phúc" }),
      makeStaff({
        id: "6fd6b737-49a1-4bea-9226-30c19805e69e",
        full_name: "Cô An",
      }),
      makeStaff({
        id: "72d17ae1-4a0a-491e-93aa-30da5f1bdefe",
        full_name: "Trợ giảng Bình",
        is_active: false,
      }),
      makeStaff({
        id: "82d17ae1-4a0a-491e-93aa-30da5f1bdefe",
        full_name: "Cô Cúc",
        assigned_classes: [],
      }),
    ],
    false,
  );

  assert.deepEqual(
    filterAndSortStaff(records, { search: "", scope: "assigned" })
      .map((record) => record.staff.full_name),
    ["Cô An", "Thầy Phúc"],
  );
  assert.deepEqual(
    filterAndSortStaff(records, { search: "", scope: "unassigned" })
      .map((record) => record.staff.full_name),
    ["Cô Cúc"],
  );
  assert.deepEqual(
    filterAndSortStaff(records, { search: "", scope: "inactive" })
      .map((record) => record.staff.full_name),
    ["Trợ giảng Bình"],
  );
});
