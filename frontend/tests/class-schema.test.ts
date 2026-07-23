import assert from "node:assert/strict";
import test from "node:test";
import { classResponseListSchema, classResponseSchema } from "../src/lib/schemas/class";

const validClass = {
  id: "42b75f50-682b-4d42-82b0-cad4465d9817",
  name: "6C1",
  type: "MONTHLY",
  base_fee: 750_000,
  billing_cycle_months: 1,
  start_date: "2026-07-14",
  end_date: null,
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
