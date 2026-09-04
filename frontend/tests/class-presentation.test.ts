import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndSortClasses,
  filterAndSortPreparedClasses,
  getClassBillingDurationLabel,
  getClassCategoryLabel,
  getClassGroupInfoForRecord,
  getClassEarliestStartMinutes,
  getClassGradeYearLabel,
  getClassInfoLine,
  getClassPeriodLabel,
  getClassScheduleSlots,
  getClassScheduleSlotsLabel,
  getClassScheduleSummary,
  getClassScheduleText,
  getClassTeacherIds,
  getClassTeacherNames,
  getClassTotalDurationLabel,
  getCourseDurationLabel,
  normalizeClassScheduleSlots,
  normalizeCourseBillingMonths,
  prepareClassRecords,
} from "../src/lib/classes/presentation";
import type { ClassResponse, ClassType } from "../src/lib/types";

test("specialized classes use the complete Thi Chuyên category label", () => {
  assert.equal(
    getClassCategoryLabel(
      makeClass("specialized", "Luyện thi chuyên Anh", "MONTHLY", 1, {
        class_category: "SPECIALIZED",
      }),
    ),
    "Thi Chuyên",
  );
});

function makeClass(
  id: string,
  name: string,
  type: ClassType,
  billingCycleMonths: number,
  overrides: Partial<ClassResponse> = {},
): ClassResponse {
  return {
    id,
    name,
    type,
    base_fee: 750_000,
    billing_cycle_months: billingCycleMonths,
    start_date: null,
    end_date: null,
    identity_scheme: "LEGACY",
    program_name: null,
    grade_level: null,
    education_level: null,
    academic_year_start: null,
    schedule: null,
    teacher_id: null,
    teacher_ids: [],
    teacher_name: null,
    teacher_names: [],
    assistant_ids: [],
    assistant_names: [],
    is_active: true,
    student_count: 0,
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z",
    version: 1,
    display_name: name,
    primary_label: name,
    secondary_label: null,
    effective_status: "LEGACY",
    can_edit_end_date: false,
    ...overrides,
    class_category: overrides.class_category ?? null,
    grade_mode: overrides.grade_mode ?? null,
  };
}

test("teacher helpers trim, deduplicate and safely fall back to legacy fields", () => {
  const class_ = makeClass("6c1", "6C1", "MONTHLY", 1, {
    teacher_id: "legacy-id",
    teacher_ids: [" teacher-1 ", "teacher-1", "teacher-2"],
    teacher_name: "Cô Legacy",
    teacher_names: [" Cô Hạnh ", "Cô Hạnh", "Thầy Phúc"],
  });

  assert.deepEqual(getClassTeacherIds(class_), ["teacher-1", "teacher-2"]);
  assert.deepEqual(getClassTeacherNames(class_), ["Cô Hạnh", "Thầy Phúc"]);

  const malformed = {
    teacher_ids: [null, 7, ""],
    teacher_id: " legacy-id ",
    teacher_names: "not-an-array",
    teacher_name: " Cô Legacy ",
  } as unknown as ClassResponse;
  assert.deepEqual(getClassTeacherIds(malformed), ["legacy-id"]);
  assert.deepEqual(getClassTeacherNames(malformed), ["Cô Legacy"]);
  assert.deepEqual(getClassTeacherIds(null), []);
});

test("structured class metadata controls the color group even when the entered name is free-form", () => {
  const class_ = makeClass("academic-6", "Nhóm chiều thứ hai", "MONTHLY", 1, {
    identity_scheme: "ACADEMIC_YEAR",
    grade_level: 6,
    education_level: "MIDDLE",
    academic_year_start: 2026,
    secondary_label: "Lớp 6 · THCS · Năm học 2026–2027",
  });

  assert.equal(getClassGroupInfoForRecord(class_).label, "Lớp 6");
});

test("schedule helpers keep valid slots and discard malformed response data", () => {
  const class_ = {
    schedule: {
      text: "  Lịch bổ sung  ",
      slots: [
        { day: "Thứ 3", start: "15:30", end: "17:00" },
        { day: "Thứ 2", start: "13:30", end: "15:00" },
        { day: "Thứ 9", start: "13:30", end: "15:00" },
        { day: "Thứ 4", start: "25:00", end: "26:00" },
        { day: "Thứ 5", start: "17:00", end: "16:00" },
        null,
      ],
    },
  } as unknown as ClassResponse;

  assert.deepEqual(getClassScheduleSlots(class_), [
    { day: "Thứ 2", start: "13:30", end: "15:00" },
    { day: "Thứ 3", start: "15:30", end: "17:00" },
  ]);
  assert.equal(getClassScheduleText(class_), "Lịch bổ sung");
  assert.equal(
    getClassScheduleSummary(class_),
    "Thứ 2 (13:30–15:00), Thứ 3 (15:30–17:00)",
  );
  assert.equal(getClassScheduleSummary(class_, { day: "Thứ 3" }), "Thứ 3 (15:30–17:00)");
});

test("schedule helpers preserve per-session teacher and assistant assignments", () => {
  const class_ = {
    schedule: {
      slots: [
        {
          day: "Thứ 2",
          start: "13:30",
          end: "15:00",
          teacher_ids: ["teacher-1"],
          assistant_ids: ["assistant-1"],
        },
        {
          day: "Thứ 4",
          start: "13:30",
          end: "15:00",
          teacher_ids: [],
          assistant_ids: [],
        },
      ],
    },
  } as unknown as ClassResponse;

  assert.deepEqual(getClassScheduleSlots(class_), [
    {
      day: "Thứ 2",
      start: "13:30",
      end: "15:00",
      teacher_ids: ["teacher-1"],
      assistant_ids: ["assistant-1"],
    },
    {
      day: "Thứ 4",
      start: "13:30",
      end: "15:00",
      teacher_ids: [],
      assistant_ids: [],
    },
  ]);
});

test("schedule presentation sorts and deduplicates sessions", () => {
  const slots = normalizeClassScheduleSlots([
    { day: "Thứ 4", start: "13:30", end: "15:00" },
    { day: "Thứ 2", start: "13:30", end: "15:00" },
    { day: "Thứ 2", start: "13:30", end: "15:00" },
    { day: "Chủ Nhật", start: "08:00", end: "09:30" },
  ]);

  assert.deepEqual(slots, [
    { day: "Thứ 2", start: "13:30", end: "15:00" },
    { day: "Thứ 4", start: "13:30", end: "15:00" },
    { day: "Chủ Nhật", start: "08:00", end: "09:30" },
  ]);
  assert.equal(
    getClassScheduleSlotsLabel(slots),
    "Thứ 2, 13:30 đến 15:00; Thứ 4, 13:30 đến 15:00; Chủ Nhật, 08:00 đến 09:30",
  );
});

test("schedule summary truncates predictably and supports legacy free text", () => {
  const class_ = makeClass("schedule", "7C1", "MONTHLY", 1, {
    schedule: {
      slots: [
        { day: "Thứ 2", start: "13:30", end: "15:00" },
        { day: "Thứ 4", start: "13:30", end: "15:00" },
        { day: "Thứ 6", start: "13:30", end: "15:00" },
      ],
    },
  });
  assert.equal(
    getClassScheduleSummary(class_, { maxSlots: 2 }),
    "Thứ 2 (13:30–15:00), Thứ 4 (13:30–15:00) · +1 ca",
  );

  const legacy = makeClass("legacy", "Lớp cũ", "MONTHLY", 1, {
    schedule: { text: "Thứ 7 lúc 08:00" },
  });
  assert.equal(getClassScheduleSummary(legacy, { day: "Thứ 7" }), "Thứ 7 lúc 08:00");
  assert.equal(getClassScheduleSummary(legacy, { day: "Thứ 2" }), "—");
  assert.equal(getClassEarliestStartMinutes(legacy, "Thứ 7"), 8 * 60);
});

test("billing labels normalize unsupported or malformed durations", () => {
  assert.equal(normalizeCourseBillingMonths(6), 6);
  assert.equal(normalizeCourseBillingMonths(5), 3);
  assert.equal(normalizeCourseBillingMonths(Number.NaN), 3);
  assert.equal(getCourseDurationLabel(48), "48 tuần");
  assert.equal(getCourseDurationLabel(undefined), "12 tuần");
  assert.equal(
    getClassBillingDurationLabel(makeClass("monthly", "6C1", "MONTHLY", 99)),
    "1 tháng",
  );
  assert.equal(
    getClassBillingDurationLabel(makeClass("course", "IELTS", "COURSE", 2)),
    "8 tuần",
  );
});

test("open-ended classes never expose a misleading total duration", () => {
  assert.equal(
    getClassTotalDurationLabel(
      makeClass("m", "6C1", "MONTHLY", 1, { start_date: "2026-09-01", end_date: "2026-11-30" }),
    ),
    null,
  );
  assert.equal(
    getClassTotalDurationLabel(
      makeClass("c", "IELTS", "COURSE", 2, { start_date: "2026-09-01", end_date: "2026-10-27" }),
    ),
    null,
  );
  assert.equal(
    getClassTotalDurationLabel(makeClass("no-dates", "X", "MONTHLY", 1)),
    null,
  );
  assert.equal(
    getClassTotalDurationLabel(
      makeClass("ielts", "IELTS 10", "COURSE", 3, {
        start_date: "2026-04-06",
        end_date: "2027-06-06",
      }),
    ),
    null,
  );
});

test("period label omits the open month/year when the class has no grade or year", () => {
  const ieltsWithoutGradeYear = makeClass("ielts", "IELTS", "COURSE", 2, {
    class_category: "IELTS",
    identity_scheme: "INTAKE",
    grade_mode: "NONE",
    start_date: "2026-07-01",
    end_date: "2026-09-30",
  });
  assert.equal(getClassPeriodLabel(ieltsWithoutGradeYear), null);

  const academicYear = makeClass("ay", "Lớp 6A1", "MONTHLY", 1, {
    class_category: "SPECIALIZED",
    identity_scheme: "ACADEMIC_YEAR",
    grade_mode: "GRADE",
    grade_level: 6,
    academic_year_start: 2026,
  });
  assert.equal(getClassPeriodLabel(academicYear), "Khối 6 · Năm học 2026–2027");
});

test("class info line combines grade, academic year and student count", () => {
  const academicYear = makeClass("ay", "Lớp 6A1", "MONTHLY", 1, {
    grade_mode: "GRADE",
    grade_level: 6,
    academic_year_start: 2026,
    student_count: 12,
  });
  assert.equal(getClassGradeYearLabel(academicYear), "Khối 6 · Năm học 2026–2027");
  assert.equal(getClassInfoLine(academicYear), "Khối 6 · Năm học 2026–2027 · 12 học viên");

  const ielts = makeClass("ielts", "IELTS", "COURSE", 2, {
    class_category: "IELTS",
    identity_scheme: "INTAKE",
    grade_mode: "NONE",
    student_count: 8,
  });
  assert.equal(getClassGradeYearLabel(ielts), null);
  assert.equal(getClassInfoLine(ielts), "8 học viên");
});

test("prepared search finds class metadata without rebuilding response-specific logic", () => {
  const classes = [
    makeClass("6c1", "6C1", "MONTHLY", 1, {
      teacher_names: ["Cô Hạnh"],
      schedule: { slots: [{ day: "Thứ 2", start: "13:30", end: "15:00" }] },
    }),
    makeClass("ielts", "IELTS Chuyên sâu", "COURSE", 6, {
      teacher_names: ["Thầy Phúc"],
    }),
  ];
  const prepared = prepareClassRecords(classes);

  assert.deepEqual(
    filterAndSortPreparedClasses(prepared, { search: "co hanh" }).map((class_) => class_.id),
    ["6c1"],
  );
  assert.deepEqual(
    filterAndSortPreparedClasses(prepared, { search: "24 tuan" }).map((class_) => class_.id),
    ["ielts"],
  );
  assert.deepEqual(
    filterAndSortPreparedClasses(prepared, { search: "thu 2 13 30" }).map((class_) => class_.id),
    ["6c1"],
  );
});

test("alphanumeric class search does not fall back to unrelated digits", () => {
  const classes = [
    makeClass("6c1", "6C1", "MONTHLY", 1, {
      base_fee: 750_000,
    }),
    makeClass("6c2", "6C2", "MONTHLY", 1, {
      base_fee: 1_610_000,
    }),
    makeClass("7c1", "7C1", "MONTHLY", 1, {
      schedule: { slots: [{ day: "Thứ 6", start: "16:10", end: "17:40" }] },
    }),
  ];

  assert.deepEqual(
    filterAndSortClasses(classes, { search: "6c1" }).map((class_) => class_.id),
    ["6c1"],
  );
});

test("combined filters and semantic sorting match the classes-page behavior", () => {
  const classes = [
    makeClass("ielts", "IELTS Chuyên sâu", "COURSE", 6),
    makeClass("7c1", "7C1", "MONTHLY", 1),
    makeClass("6c1", "6C1", "MONTHLY", 1),
    makeClass("hsg", "Học sinh giỏi thành phố lớp 9", "COURSE", 3),
  ];

  assert.deepEqual(
    filterAndSortClasses(classes).map((class_) => class_.id),
    ["6c1", "7c1", "hsg", "ielts"],
  );
  assert.deepEqual(
    filterAndSortClasses(classes, { type: "COURSE", courseDuration: "12" }).map(
      (class_) => class_.id,
    ),
    ["hsg"],
  );
});

test("day filtering orders classes chronologically and ignores malformed entries", () => {
  const classes = [
    makeClass("late", "6C2", "MONTHLY", 1, {
      schedule: { slots: [{ day: "Thứ 2", start: "17:00", end: "18:30" }] },
    }),
    makeClass("other-day", "6C3", "MONTHLY", 1, {
      schedule: { slots: [{ day: "Thứ 3", start: "07:00", end: "08:30" }] },
    }),
    makeClass("early", "6C1", "MONTHLY", 1, {
      schedule: { slots: [{ day: "Thứ 2", start: "13:30", end: "15:00" }] },
    }),
    null as unknown as ClassResponse,
  ];

  assert.deepEqual(
    filterAndSortClasses(classes, { day: "Thứ 2" }).map((class_) => class_.id),
    ["early", "late"],
  );
  assert.doesNotThrow(() =>
    filterAndSortClasses([{} as ClassResponse, null as unknown as ClassResponse], {
      search: "test",
      day: "Thứ 2",
    }),
  );
});
