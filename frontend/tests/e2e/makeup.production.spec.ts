import { expect, test, type Page } from "@playwright/test";

/**
 * PRODUCTION-PATH E2E — make-up flow qua route thật /classes + React Query +
 * network boundary (mocked API qua page.route) + workspace/rail thật.
 * Chạy Chromium + Firefox (project config).
 */

const CLASS_ID = "88888888-8888-4888-8888-888888888888";
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
      exception_id: null,
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
    {
      key: `${CLASS_ID}:${isoAtLocal(daysFromNow(12), 18)}`,
      kind: "REGULAR",
      original_start_at: isoAtLocal(daysFromNow(12), 18),
      original_end_at: isoAtLocal(daysFromNow(12), 19),
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

const installApiMocks = (page: Page) => {
  postponePayloads = [];

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
    const suspensionMatch = path.match(/^\/classes\/([^/]+)\/suspensions(?:\/preview)?$/);
    if (suspensionMatch && method === "POST") {
      const body = route.request().postDataJSON();
      console.log("PROD-MK POST suspension", JSON.stringify(body).slice(0, 160));
      if (path.endsWith("/preview")) {
        await json({
          class_id: CLASS_ID,
          suspended_from: body.suspended_from,
          resume_on: body.resume_on,
          credit_days: 14,
          member_summary: [
            { enrollment_id: "55555555-5555-4555-8555-555555555555", overlap_days: 14 },
          ],
          target_cycle_count: 1,
          protected_case_count: 0,
        });
        return;
      }
      postponePayloads.push(body);
      await json({
        class_id: CLASS_ID,
        suspended_from: body.suspended_from,
        resume_on: body.resume_on,
        credit_days: 14,
        member_summary: [
          { enrollment_id: "55555555-5555-4555-8555-555555555555", overlap_days: 14 },
        ],
        target_cycle_count: 1,
        protected_case_count: 0,
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
  await page.getByRole("heading", { name: "Hoãn buổi học — Lớp 6A1" }).waitFor();
};

const chooseEndDate = async (page: Page) => {
  const target = new Date();
  target.setDate(target.getDate() + 14);
  await page.getByRole("button", { name: /^Đến ngày/ }).click();
  // The workspace keeps the outer class-form date pickers mounted but hidden.
  // Scope to the visible dialog to avoid resolving a hidden duplicate with the
  // same date-picker title/id when this production path is rendered.
  const picker = page
    .locator('[role="dialog"]:visible')
    .filter({ hasText: "Chọn ngày kết thúc hoãn" })
    .last();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: String(target.getFullYear()), exact: true }).click();
  await picker
    .getByRole("button", { name: `Tháng ${target.getMonth() + 1}`, exact: true })
    .click();
  await picker.getByRole("button", { name: String(target.getDate()), exact: true }).click();
  await picker.getByRole("button", { name: "Xác nhận", exact: true }).click();
};

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
  await page.context().addCookies([
    { name: "tpro_access_token", value: fakeToken(), url: "http://localhost:3100/classes" },
  ]);
});

test("T-E2E-PROD-MK-001: date range postpones every eligible occurrence and keeps the template untouched", async ({ page }) => {
  await openMakeupMode(page);
  await chooseEndDate(page);
  await expect(page.locator('[data-workspace-mode="makeup"] input[type="checkbox"]')).toHaveCount(0);
  const autoSelectionSummary = page.getByText(/Hệ thống sẽ tự động hoãn/);
  await expect(autoSelectionSummary).toBeVisible();
  await expect(autoSelectionSummary).toContainText("2 buổi");
  await page.getByRole("button", { name: /Hoãn \(2\)/ }).click();
  await expect
    .poll(() => postponePayloads.length, { timeout: 5_000 })
    .toBe(1);
  await page.waitForTimeout(400);
  expect(postponePayloads.length).toBe(1);
  const payload = postponePayloads[postponePayloads.length - 1] as {
    suspended_from: string;
    resume_on: string;
    reason_code: string;
    request_id: string;
  };
  expect(payload.suspended_from).toBe(daysFromNow(0));
  expect(payload.resume_on).toBe(daysFromNow(14));
  expect(payload.reason_code).toBe("TEACHER_UNAVAILABLE");
  expect(payload.request_id).toBeTruthy();
  await expect(page.getByText("Đã hoãn buổi học.")).toBeVisible();
});

test("T-E2E-PROD-MK-002: workspace does not expose legacy make-up scheduling", async ({ page }) => {
  await openMakeupMode(page);
  await chooseEndDate(page);
  await expect(page.getByRole("button", { name: /Xếp lịch bù|Xếp bù ngay|Xếp sau/ })).toHaveCount(0);
  await expect(page.getByText(/Ngày thu sẽ dời theo số ngày hoãn thực tế/)).toBeVisible();
});

test("T-E2E-PROD-MK-003: preview keeps the suspension flow authoritative", async ({ page }) => {
  await openMakeupMode(page);
  await expect(page.getByText(/Chọn khoảng ngày để xem các buổi học/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Đóng", exact: true }).last()).toBeVisible();
});
