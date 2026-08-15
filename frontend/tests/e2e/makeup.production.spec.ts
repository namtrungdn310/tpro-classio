import { expect, test, type Page } from "@playwright/test";

/**
 * PRODUCTION-PATH E2E — make-up flow qua route thật /classes + React Query +
 * network boundary (mocked API qua page.route) + workspace/rail thật.
 * Chạy Chromium + Firefox (project config).
 */

const CLASS_ID = "88888888-8888-4888-8888-888888888888";
const EXCEPTION_ID = "77777777-7777-4777-8777-777777777777";
const STAFF_ID = "11111111-1111-4111-8111-111111111111";

const fakeToken = () => {
  const payload = {
    sub: "99999999-9999-4999-8999-999999999999",
    email: "admin@tpro.test",
    name: "Admin TPRO",
    role: "admin",
    is_owner: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
};

function daysFromNow(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function isoAtLocal(date: string, hour: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, hour).toISOString();
}

const makeClass = () => ({
  id: CLASS_ID,
  name: "Lớp 6A1",
  type: "MONTHLY",
  base_fee: 750000,
  billing_cycle_months: 1,
  billing_cycle_weeks: null,
  start_date: daysFromNow(-30),
  end_date: daysFromNow(120),
  identity_scheme: "ACADEMIC_YEAR",
  class_category: "GENERAL",
  grade_mode: "GRADE",
  program_name: null,
  grade_level: 6,
  education_level: "MIDDLE",
  academic_year_start: 2026,
  schedule: {
    text: "Thứ 2 (18:00-19:30)",
    slots: [
      {
        day: "Thứ 2",
        start: "18:00",
        end: "19:30",
        teacher_ids: [STAFF_ID],
        assistant_ids: [],
      },
    ],
  },
  teacher_id: STAFF_ID,
  teacher_ids: [STAFF_ID],
  teacher_name: "Cô Hạnh",
  teacher_names: ["Cô Hạnh"],
  assistant_ids: [],
  assistant_names: [],
  is_active: true,
  student_count: 4,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  version: 1,
  display_name: "Lớp 6A1",
  primary_label: "Lớp 6A1",
  secondary_label: null,
  effective_status: "ACTIVE",
  can_edit_end_date: true,
  end_date_edit_deadline: null,
  can_edit: true,
  can_cancel: true,
  can_view_history: true,
  operational_end_date: daysFromNow(120),
  unresolved_makeup_count: 1,
});

const makePendingException = () => ({
  id: EXCEPTION_ID,
  adjustment_id: "66666666-6666-4666-8666-666666666666",
  class_id: CLASS_ID,
  original_start_at: isoAtLocal(daysFromNow(3), 18),
  original_end_at: isoAtLocal(daysFromNow(3), 19),
  original_timezone: "Asia/Ho_Chi_Minh",
  status: "MAKEUP_PENDING",
  display_status: "MAKEUP_PENDING",
  replacement_start_at: null,
  replacement_end_at: null,
  completed_at: null,
  restored_at: null,
  version: 1,
  staff: [
    {
      staff_id: STAFF_ID,
      role: "TEACHER",
      display_name: "Cô Hạnh",
      source_slot_key: "Thứ 2|18:00|19:30",
    },
  ],
  eligible_student_count: 4,
  billing_impact: "NONE",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const makeOccurrences = () => ({
  class_id: CLASS_ID,
  occurrences: [
    {
      key: `${CLASS_ID}:${isoAtLocal(daysFromNow(3), 18)}`,
      kind: "REGULAR",
      original_start_at: isoAtLocal(daysFromNow(3), 18),
      original_end_at: isoAtLocal(daysFromNow(3), 19),
      source_slot_key: "Thứ 2|18:00|19:30",
      teacher_ids: [STAFF_ID],
      assistant_ids: [],
      exception_id: EXCEPTION_ID,
      status: "MAKEUP_PENDING",
      replacement_start_at: null,
      replacement_end_at: null,
      adjustable: false,
      already_adjusted: true,
      passed: false,
    },
    {
      key: `${CLASS_ID}:${isoAtLocal(daysFromNow(10), 18)}`,
      kind: "REGULAR",
      original_start_at: isoAtLocal(daysFromNow(10), 18),
      original_end_at: isoAtLocal(daysFromNow(10), 19),
      source_slot_key: "Thứ 2|18:00|19:30",
      teacher_ids: [STAFF_ID],
      assistant_ids: [],
      exception_id: null,
      status: null,
      replacement_start_at: null,
      replacement_end_at: null,
      adjustable: true,
      already_adjusted: false,
      passed: false,
    },
  ],
});

let postponePayloads: unknown[] = [];
let schedulePayloads: unknown[] = [];
let completePayloads: unknown[] = [];
let restorePayloads: unknown[] = [];

const installApiMocks = (page: Page) => {
  postponePayloads = [];
  schedulePayloads = [];
  completePayloads = [];
  restorePayloads = [];

  return page.route("**/api/proxy/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/proxy", "");
    const method = route.request().method();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/me") {
      await json({
        id: "99999999-9999-4999-8999-999999999999",
        email: "admin@tpro.test",
        role: "admin",
        username: "admin",
        full_name: "Admin TPRO",
        avatar_url: null,
        is_owner: true,
      });
      return;
    }
    if (path === "/staff/teacher-options") {
      await json([
        { id: STAFF_ID, full_name: "Cô Hạnh", staff_type: "TEACHER" },
      ]);
      return;
    }
    if (path === "/classes/summary") {
      await json({ operational: 1, active: 1, scheduled: 0, completed: 0, cancelled: 0 });
      return;
    }
    if (path === "/classes" && method === "GET") {
      await json([makeClass()]);
      return;
    }
    if (path === "/classes/effective-occurrences" && method === "GET") {
      await json([{ class_id: CLASS_ID, occurrences: [] }]);
      return;
    }
    const occurrencesMatch = path.match(/^\/classes\/([^/]+)\/occurrences$/);
    if (occurrencesMatch && method === "GET") {
      await json(makeOccurrences());
      return;
    }
    const adjustmentsMatch = path.match(/^\/classes\/([^/]+)\/schedule-adjustments$/);
    if (adjustmentsMatch && method === "GET") {
      await json({
        adjustments: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            class_id: CLASS_ID,
            reason_code: "TEACHER_UNAVAILABLE",
            reason_note: null,
            affected_from: daysFromNow(3),
            affected_through: daysFromNow(3),
            status: "OPEN",
            created_by: "99999999-9999-4999-8999-999999999999",
            request_id: "55555555-5555-4555-8555-555555555555",
            version: 1,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        exceptions: [makePendingException()],
      });
      return;
    }
    if (adjustmentsMatch && method === "POST") {
      const body = route.request().postDataJSON();
      console.log("PROD-MK POST postpone", JSON.stringify(body).slice(0, 160));
      postponePayloads.push(body);
      await json({
        adjustment: {
          id: "66666666-6666-4666-8666-666666666666",
          class_id: CLASS_ID,
          reason_code: "TEACHER_UNAVAILABLE",
          reason_note: null,
          affected_from: daysFromNow(10),
          affected_through: daysFromNow(10),
          status: "OPEN",
          created_by: "99999999-9999-4999-8999-999999999999",
          request_id: "55555555-5555-4555-8555-555555555555",
          version: 1,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        exceptions: [],
        billing_impact: "NONE",
      });
      return;
    }
    if (path.match(/^\/classes\/([^/]+)\/schedule-adjustments\/preview$/)) {
      await json({
        class_id: CLASS_ID,
        occurrences: makeOccurrences().occurrences,
        billing_impact: "NONE",
      });
      return;
    }
    if (path.match(/^\/class-session-exceptions\/([^/]+)\/makeup\/preview$/)) {
      const body = route.request().postDataJSON();
      const start = new Date(body.replacement_start_at);
      const end = new Date(start.getTime() + 90 * 60 * 1000);
      await json({
        exception_id: EXCEPTION_ID,
        original_start_at: isoAtLocal(daysFromNow(3), 18),
        original_end_at: isoAtLocal(daysFromNow(3), 19),
        duration_minutes: 90,
        replacement_start_at: start.toISOString(),
        replacement_end_at: end.toISOString(),
        staff: [
          {
            staff_id: STAFF_ID,
            role: "TEACHER",
            display_name: "Cô Hạnh",
            source_slot_key: "Thứ 2|18:00|19:30",
          },
        ],
        eligible_student_count: 4,
        conflicts: [],
        staff_inactive: [],
        can_schedule: true,
        billing_impact: "NONE",
      });
      return;
    }
    const scheduleMatch = path.match(/^\/class-session-exceptions\/([^/]+)\/makeup\/schedule$/);
    if (scheduleMatch && method === "POST") {
      schedulePayloads.push(route.request().postDataJSON());
      await json({
        exception: {
          ...makePendingException(),
          status: "MAKEUP_SCHEDULED",
          display_status: "MAKEUP_SCHEDULED",
          replacement_start_at: route.request().postDataJSON().replacement_start_at,
          replacement_end_at: new Date(
            new Date(route.request().postDataJSON().replacement_start_at).getTime() + 90 * 60 * 1000,
          ).toISOString(),
          version: 2,
        },
        operational_end_date: daysFromNow(120),
        effective_status: "ACTIVE",
        billing_impact: "NONE",
      });
      return;
    }
    const completeMatch = path.match(/^\/class-session-exceptions\/([^/]+)\/makeup\/complete$/);
    if (completeMatch && method === "POST") {
      completePayloads.push(route.request().postDataJSON());
      await json({
        exception: {
          ...makePendingException(),
          status: "MAKEUP_COMPLETED",
          display_status: "MAKEUP_COMPLETED",
          completed_at: new Date().toISOString(),
          version: 3,
        },
        operational_end_date: daysFromNow(120),
        effective_status: "ACTIVE",
        billing_impact: "NONE",
      });
      return;
    }
    const restoreMatch = path.match(/^\/class-session-exceptions\/([^/]+)\/restore-original$/);
    if (restoreMatch && method === "POST") {
      restorePayloads.push(route.request().postDataJSON());
      await json({
        exception: {
          ...makePendingException(),
          status: "RESTORED",
          display_status: "RESTORED",
          restored_at: new Date().toISOString(),
          version: 3,
        },
        operational_end_date: daysFromNow(120),
        effective_status: "ACTIVE",
        billing_impact: "NONE",
      });
      return;
    }

    await json({});
  });
};

const openMakeupMode = async (page: Page) => {
  await page.goto("http://localhost:3100/classes");
  await page.getByText("Lớp 6A1").first().waitFor();
  await page.getByText("Lớp 6A1").first().click();
  await page.getByRole("heading", { name: "Sửa lớp học" }).waitFor();
  await page.getByRole("tab", { name: "Hoãn lớp" }).click();
  await page.getByRole("heading", { name: "Hoãn và học bù — Lớp 6A1" }).waitFor();
};

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
  await page.context().addCookies([
    { name: "tpro_access_token", value: fakeToken(), url: "http://localhost:3100/classes" },
  ]);
});

test("T-E2E-PROD-MK-001: postpone one occurrence sends the exact command and keeps the template untouched", async ({ page }) => {
  await openMakeupMode(page);
  await page.getByText(/Tổng.*buổi chưa hoàn tất/).waitFor();
  const available = page.locator('[data-workspace-mode="makeup"] input[type="checkbox"]:not([disabled])');
  await expect(available).toHaveCount(1);
  await available.check();
  await page.getByRole("button", { name: /Hoãn \(1\)/ }).click();
  await expect
    .poll(() => postponePayloads.length, { timeout: 5_000 })
    .toBe(1);
  await page.waitForTimeout(400);
  expect(postponePayloads.length).toBe(1);
  const payload = postponePayloads[0] as {
    original_start_at: string[];
    reason_code: string;
    schedule_now: boolean;
    request_id: string;
  };
  expect(payload.original_start_at.length).toBe(1);
  expect(payload.reason_code).toBe("TEACHER_UNAVAILABLE");
  expect(payload.schedule_now).toBe(true);
  expect(payload.request_id).toBeTruthy();
  await expect(page.getByText("Đã hoãn buổi học.")).toBeVisible();
});

test("T-E2E-PROD-MK-002: schedule panel is read-only for staff/duration and forwards the schedule command", async ({ page }) => {
  await openMakeupMode(page);
  await page.getByRole("button", { name: "Xếp lịch bù" }).first().click();
  await expect(page.getByText("Thời lượng:")).toBeVisible();
  await expect(page.getByText("Học viên đủ điều kiện:")).toBeVisible();
  await expect(page.locator('[data-workspace-mode="makeup"] select')).toHaveCount(1);
  await page.getByPlaceholder("YYYY-MM-DD HH:MM").fill("2026-09-10 18:00");
  await expect(page.getByText("Khung giờ trống.")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Xếp buổi bù" }).click();
  await expect
    .poll(() => schedulePayloads.length, { timeout: 5_000 })
    .toBe(1);
  const payload = schedulePayloads[0] as {
    replacement_start_at: string;
    expected_version: number;
    request_id: string;
  };
  expect(payload.expected_version).toBe(1);
  expect(payload.request_id).toBeTruthy();
});

test("T-E2E-PROD-MK-003: restore forwards the exception id and version", async ({ page }) => {
  await openMakeupMode(page);
  await page.getByRole("button", { name: "Khôi phục buổi gốc" }).first().click();
  await expect
    .poll(() => restorePayloads.length, { timeout: 5_000 })
    .toBe(1);
  const payload = restorePayloads[0] as { expected_version: number; request_id: string };
  expect(payload.expected_version).toBe(1);
  expect(payload.request_id).toBeTruthy();
});
