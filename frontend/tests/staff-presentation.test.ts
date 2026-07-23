import assert from "node:assert/strict";
import test from "node:test";
import {
  countActiveStaff,
  filterAndSortStaff,
  prepareStaffRecords,
} from "../src/lib/staff/presentation";
import type { StaffResponse } from "../src/lib/types";

function makeStaff(overrides: Partial<StaffResponse> = {}): StaffResponse {
  return {
    id: "65c4e260-cf9f-4d81-8365-d293bf24804e",
    full_name: "Cô Hạnh",
    staff_type: "TEACHER",
    zalo_name: "Cô Hạnh",
    phone: "0912345678",
    is_active: true,
    assigned_classes: [
      {
        id: "3b56d5ef-b18e-48c8-8fe6-15f3447cf356",
        name: "6C1",
        is_active: true,
      },
      {
        id: "8f027de8-346f-436e-8fe6-e6a6d5d6d9bb",
        name: "Lớp cũ",
        is_active: false,
      },
    ],
    created_at: "2026-07-16T08:00:00+07:00",
    updated_at: "2026-07-16T08:00:00+07:00",
    ...overrides,
  };
}

test("staff presentation keeps all assignments for validation but displays only active classes", () => {
  const [record] = prepareStaffRecords([makeStaff()], true);

  assert.deepEqual(record.activeClasses.map((class_) => class_.name), ["6C1"]);
  assert.deepEqual(record.assignedClasses.map((class_) => class_.name), ["6C1", "Lớp cũ"]);
});

test("viewer search corpus excludes private contact data", () => {
  const staff = [makeStaff()];
  const publicRecords = prepareStaffRecords(staff, false);
  const privateRecords = prepareStaffRecords(staff, true);

  assert.equal(
    filterAndSortStaff(publicRecords, {
      search: "0912345678",
      staffType: "",
      status: "ACTIVE",
    }).length,
    0,
  );
  assert.equal(
    filterAndSortStaff(privateRecords, {
      search: "0912345678",
      staffType: "",
      status: "ACTIVE",
    }).length,
    1,
  );
});

test("staff filters status and role while keeping Vietnamese name order", () => {
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
        staff_type: "ASSISTANT",
        is_active: false,
      }),
    ],
    false,
  );

  assert.deepEqual(
    filterAndSortStaff(records, { search: "", staffType: "TEACHER", status: "ACTIVE" })
      .map((record) => record.staff.full_name),
    ["Cô An", "Thầy Phúc"],
  );
  assert.deepEqual(
    filterAndSortStaff(records, { search: "", staffType: "", status: "INACTIVE" })
      .map((record) => record.staff.full_name),
    ["Trợ giảng Bình"],
  );
});

test("active staff total is derived from the full dataset", () => {
  const staff = [
    makeStaff(),
    makeStaff({
      id: "4f266758-9fe1-4534-a087-f1d7f81618e3",
      full_name: "Trợ giảng An",
      staff_type: "ASSISTANT",
    }),
    makeStaff({
      id: "967c5fd6-8d7d-4a0d-a025-736c57aa44c9",
      full_name: "Giáo viên cũ",
      is_active: false,
    }),
  ];

  assert.equal(countActiveStaff(staff), 2);
});
