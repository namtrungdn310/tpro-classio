import assert from "node:assert/strict";
import test from "node:test";
import {
  enrollmentResponseSchema,
  studentIdentityConflictSchema,
  studentResponseListSchema,
} from "../src/lib/schemas/student";
import { contactSuggestionResponseSchema } from "../src/lib/schemas/contact-suggestion";

const enrollment = {
  id: "00000000-0000-4000-8000-000000000001",
  student_id: "00000000-0000-4000-8000-000000000002",
  class_id: "00000000-0000-4000-8000-000000000003",
  custom_fee: null,
  effective_fee: 750_000,
  status: "active",
  enrollment_date: "2026-07-01",
  class_name: "6C1",
} as const;

test("student response validation matches the backend privacy and enrollment contract", () => {
  const students = studentResponseListSchema.parse([
    {
      id: enrollment.student_id,
      full_name: "Nguyễn Văn A",
      birth_date: "2014-01-01",
      school: "THCS Nguyễn Du",
      parent_name: null,
      parent_phone: "0912345678",
      parent_zalo: "Mẹ A",
      student_zalo: null,
      student_phone: null,
      notes: null,
      hidden_fields: ["student_contact"],
      status: "active",
      classes: [{ id: enrollment.class_id, name: enrollment.class_name }],
      active_enrollments: [
        {
          id: enrollment.id,
          class_id: enrollment.class_id,
          class_name: enrollment.class_name,
          custom_fee: enrollment.custom_fee,
          effective_fee: enrollment.effective_fee,
          enrollment_date: enrollment.enrollment_date,
          status: enrollment.status,
        },
      ],
      created_at: "2026-07-01T08:00:00+07:00",
    },
  ]);

  assert.equal(students[0]?.active_enrollments[0]?.effective_fee, 750_000);
  assert.equal("parent_contact_hidden" in (students[0] ?? {}), false);
});

test("student responses accept legacy text beyond current form limits", () => {
  const [student] = studentResponseListSchema.parse([
    {
      id: enrollment.student_id,
      full_name: "H".repeat(121),
      birth_date: null,
      school: "S".repeat(161),
      parent_name: null,
      parent_phone: null,
      parent_zalo: null,
      student_zalo: null,
      student_phone: null,
      notes: "N".repeat(1001),
      hidden_fields: [],
      status: "active",
      classes: [],
      active_enrollments: [],
      created_at: "2026-07-01T08:00:00+07:00",
    },
  ]);

  assert.equal(student?.notes?.length, 1001);
});

test("student and enrollment schemas reject malformed monetary and privacy data", () => {
  assert.throws(() =>
    enrollmentResponseSchema.parse({ ...enrollment, effective_fee: -1 }),
  );
  assert.throws(() =>
    studentResponseListSchema.parse([
      {
        id: enrollment.student_id,
        full_name: "A",
        birth_date: null,
        school: null,
        parent_name: null,
        parent_phone: null,
        parent_zalo: null,
        student_zalo: null,
        student_phone: null,
        notes: null,
        hidden_fields: ["server_only_field"],
        status: "active",
        classes: [],
        active_enrollments: [],
        created_at: "2026-07-01T08:00:00+07:00",
      },
    ]),
  );
});

test("contact suggestions are nullable but otherwise complete", () => {
  assert.equal(contactSuggestionResponseSchema.parse(null), null);
  assert.deepEqual(
    contactSuggestionResponseSchema.parse({
      phone: "0912345678",
      zalo_name: "Mẹ A",
    }),
    { phone: "0912345678", zalo_name: "Mẹ A" },
  );
  assert.throws(() =>
    contactSuggestionResponseSchema.parse({ phone: "0912345678", zalo_name: "" }),
  );
});

test("student identity conflicts expose only bounded masked candidates", () => {
  const conflict = studentIdentityConflictSchema.parse({
    code: "STUDENT_IDENTITY_CONFLICT",
    message: "Có thể học viên này đã có hồ sơ trong hệ thống",
    target_class_id: enrollment.class_id,
    candidates: [
      {
        id: enrollment.student_id,
        status: "inactive",
        full_name: "Nguyễn Văn A",
        birth_date: "2014-01-01",
        school: "THCS Nguyễn Du",
        masked_parent_phone: "******5678",
        masked_student_phone: null,
        previous_classes: [
          {
            name: "6C1",
            enrollment_date: "2026-06-05",
          },
        ],
        updated_at: "2026-07-01T08:00:00+07:00",
        match_strength: "strong",
        match_reason: "Trùng họ tên, ngày sinh và số điện thoại.",
        already_in_target_class: false,
      },
    ],
  });

  assert.equal(conflict.candidates[0]?.masked_parent_phone, "******5678");
  assert.throws(() =>
    studentIdentityConflictSchema.parse({
      ...conflict,
      candidates: Array.from({ length: 6 }, () => conflict.candidates[0]),
    }),
  );
});
