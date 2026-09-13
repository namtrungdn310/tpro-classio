import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeVietnamPhone,
  staffCreateFormSchema,
  staffFormSchema,
  staffResponseListSchema,
  staffResponseSchema,
  teacherOptionResponseListSchema,
} from "../src/lib/schemas/staff";

const validStaff = {
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
  ],
  created_at: "2026-07-16T08:00:00+07:00",
  updated_at: "2026-07-16T08:00:00+07:00",
} as const;

test("staff response schemas accept the canonical staff contract", () => {
  assert.equal(staffResponseSchema.parse(validStaff).assigned_classes[0]?.name, "6C1");
  assert.equal(staffResponseListSchema.parse([validStaff]).length, 1);
});

test("staff response schemas reject malformed lists and incomplete contacts", () => {
  assert.throws(() => staffResponseListSchema.parse({ data: [validStaff] }));
  assert.throws(() => staffResponseSchema.parse({ ...validStaff, zalo_name: null }));
  assert.throws(() =>
    staffResponseSchema.parse({
      ...validStaff,
      assigned_classes: [{ ...validStaff.assigned_classes[0], id: "not-a-uuid" }],
    }),
  );
});

test("teacher option schema rejects malformed entries instead of silently dropping them", () => {
  assert.equal(
    teacherOptionResponseListSchema.parse([
      { id: validStaff.id, full_name: validStaff.full_name, staff_type: "TEACHER" },
    ]).length,
    1,
  );
  assert.throws(() =>
    teacherOptionResponseListSchema.parse([{ id: validStaff.id, full_name: "" }]),
  );
  assert.throws(() =>
    teacherOptionResponseListSchema.parse([
      { id: validStaff.id, full_name: validStaff.full_name, staff_type: "TUTOR" },
    ]),
  );
});

test("staff form rejects phone values containing letters and normalizes Vietnamese numbers", () => {
  const baseForm = {
    full_name: "Cô Hạnh",
    staff_type: "TEACHER",
    zalo_name: "Cô Hạnh",
    phone: "0912345678",
    email: "",
    checkin_window_after_hours: 24,
  } as const;

  assert.equal(staffFormSchema.safeParse(baseForm).success, true);
  assert.equal(staffFormSchema.safeParse({ ...baseForm, phone: "abc0912345678" }).success, false);
  assert.equal(staffFormSchema.safeParse({ ...baseForm, phone: "+84 912 345 678" }).success, true);
  assert.equal(staffFormSchema.safeParse({ ...baseForm, zalo_name: "" }).success, false);
  assert.equal(staffFormSchema.safeParse({ ...baseForm, phone: "" }).success, false);
  assert.equal(normalizeVietnamPhone("+84 912 345 678"), "0912345678");
});

test("staff form accepts an optional email and rejects malformed ones", () => {
  const baseForm = {
    full_name: "Cô Hạnh",
    staff_type: "TEACHER",
    zalo_name: "Cô Hạnh",
    phone: "0912345678",
    email: "",
    checkin_window_after_hours: 24,
  } as const;

  assert.equal(staffFormSchema.safeParse(baseForm).success, true);
  assert.equal(
    staffFormSchema.safeParse({ ...baseForm, email: "cohanh@tpro.test" }).success,
    true,
  );
  assert.equal(
    staffFormSchema.safeParse({ ...baseForm, email: "not-an-email" }).success,
    false,
  );
  assert.equal(
    staffCreateFormSchema.safeParse({ ...baseForm, email: "cohanh@tpro.test" }).success,
    true,
  );
});

test("staff form accepts a custom check-in window and rejects out-of-range values", () => {
  const baseForm = {
    full_name: "Cô Hạnh",
    staff_type: "TEACHER",
    zalo_name: "Cô Hạnh",
    phone: "0912345678",
    email: "",
    checkin_window_after_hours: 24,
  } as const;

  assert.equal(staffFormSchema.safeParse(baseForm).success, true);
  assert.equal(
    staffFormSchema.safeParse({ ...baseForm, checkin_window_after_hours: 2 }).success,
    true,
  );
  assert.equal(
    staffFormSchema.safeParse({ ...baseForm, checkin_window_after_hours: 0 }).success,
    false,
  );
  assert.equal(
    staffFormSchema.safeParse({ ...baseForm, checkin_window_after_hours: 999 }).success,
    false,
  );
});

test("staff response schema carries the optional staff email", () => {
  const withEmail = { ...validStaff, email: "cohanh@tpro.test" };
  assert.equal(staffResponseSchema.parse(withEmail).email, "cohanh@tpro.test");
  assert.equal(staffResponseSchema.parse(validStaff).email, null);
});

test("staff response schema carries the attendance email connection status", () => {
  const connected = {
    ...validStaff,
    email: "cohanh@tpro.test",
    attendance_account_status: "connected",
  } as const;
  assert.equal(staffResponseSchema.parse(connected).attendance_account_status, "connected");
  assert.equal(staffResponseSchema.parse(validStaff).attendance_account_status, "not_connected");
});

test("new staff require both Zalo name and phone while legacy edits may keep both empty", () => {
  const contactlessStaff = {
    full_name: "Cô Hạnh",
    staff_type: "TEACHER",
    zalo_name: "",
    phone: "",
    email: "",
    checkin_window_after_hours: 24,
  } as const;

  assert.equal(staffFormSchema.safeParse(contactlessStaff).success, true);
  assert.equal(staffCreateFormSchema.safeParse(contactlessStaff).success, false);
  assert.equal(
    staffCreateFormSchema.safeParse({
      ...contactlessStaff,
      zalo_name: "Cô Hạnh",
      phone: "0912345678",
    }).success,
    true,
  );
});
