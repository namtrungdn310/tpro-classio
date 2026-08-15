import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classHistorySchema,
  classResponseListSchema,
  classResponseSchema,
} from "../src/lib/schemas/class";

const classFormDialogSource = readFileSync(
  new URL("../src/components/classes/class-form-dialog.tsx", import.meta.url),
  "utf8",
);

const validClass = {
  id: "42b75f50-682b-4d42-82b0-cad4465d9817",
  name: "6C1",
  type: "MONTHLY",
  base_fee: 750_000,
  billing_cycle_months: 1,
  start_date: "2026-07-14",
  end_date: null,
  identity_scheme: "LEGACY",
  class_category: null,
  grade_mode: null,
  program_name: null,
  grade_level: null,
  education_level: null,
  academic_year_start: null,
  schedule: {
    text: "Thứ 2 (18:00-19:30)",
    slots: [{ day: "Thứ 2", start: "18:00", end: "19:30" }],
  },
  teacher_id: "8c1bf4c7-5d83-43a6-a3a2-25fd1ad8d973",
  teacher_ids: ["8c1bf4c7-5d83-43a6-a3a2-25fd1ad8d973"],
  teacher_name: "Cô Hạnh",
  teacher_names: ["Cô Hạnh"],
  is_active: true,
  student_count: 3,
  created_at: "2026-07-14T08:00:00+07:00",
  updated_at: "2026-07-14T08:00:00+07:00",
  version: 1,
  display_name: "6C1",
  primary_label: "6C1",
  secondary_label: null,
  effective_status: "LEGACY",
  can_edit_end_date: false,
  end_date_edit_deadline: null,
} as const;

test("class response schema accepts the canonical class payload", () => {
  const parsed = classResponseSchema.parse(validClass);

  assert.equal(parsed.name, "6C1");
  assert.equal(parsed.schedule?.slots?.[0]?.day, "Thứ 2");
});

test("class response list rejects malformed schedules before UI rendering", () => {
  assert.throws(() =>
    classResponseListSchema.parse([
      {
        ...validClass,
        schedule: { slots: [{ day: "Thứ 8", start: "18:00", end: "19:30" }] },
      },
    ]),
  );
});

test("class response schema rejects unsafe fee and count values", () => {
  assert.throws(() => classResponseSchema.parse({ ...validClass, base_fee: -1 }));
  assert.throws(() => classResponseSchema.parse({ ...validClass, student_count: -1 }));
});

test("class history accepts legacy schedule slots with null relational metadata", () => {
  const parsed = classHistorySchema.parse({
    id: validClass.id,
    name: validClass.name,
    display_name: validClass.display_name,
    primary_label: validClass.primary_label,
    secondary_label: validClass.secondary_label,
    effective_status: "ACTIVE",
    start_date: validClass.start_date,
    end_date: "2027-07-14",
    schedule: {
      text: "Thứ 2 (18:00-19:30)",
      slots: [
        {
          day: "Thứ 2",
          start: "18:00",
          end: "19:30",
          teacher_ids: [validClass.teacher_id],
          assistant_ids: [],
          id: null,
          version: null,
        },
      ],
    },
    teachers: [],
    enrollments: [],
    lifecycle_events: [],
    adjustments: [],
  });

  assert.equal(parsed.schedule?.slots?.[0]?.id, undefined);
  assert.equal(parsed.schedule?.slots?.[0]?.version, undefined);
});

test("class form requires grade and academic year together for specialized/custom", () => {
  assert.match(classFormDialogSource, /Vui lòng chọn năm học khi đã chọn khối lớp\./);
  assert.match(classFormDialogSource, /Vui lòng chọn khối lớp khi đã chọn năm học\./);
  assert.match(classFormDialogSource, /const hasGrade = values\.grade_level !== null/);
  assert.match(classFormDialogSource, /const hasYear = values\.academic_year_start !== null/);
});

test("class duration shortcut controls keep the white form surface when read-only", () => {
  assert.match(
    classFormDialogSource,
    /id="class-total-months"[\s\S]*?disabled:bg-white disabled:text-gray-400/,
  );
  assert.match(
    classFormDialogSource,
    /id="class-duration-weeks"[\s\S]*?disabled:bg-transparent disabled:text-gray-400/,
  );
  assert.match(
    classFormDialogSource,
    /id="class-package-count"[\s\S]*?disabled:bg-transparent disabled:text-gray-400/,
  );
});
