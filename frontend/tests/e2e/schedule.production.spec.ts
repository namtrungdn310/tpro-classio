import { expect, test } from "@playwright/test";

/**
 * PRODUCTION-PATH E2E — đi qua Next route thật + auth/session (cookie) +
 * network boundary (mocked API qua page.route) + React Query layer.
 * KHÔNG phải browser component harness (tests/e2e/schedule.spec.ts).
 */

const TEACHER_T1 = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Cô Hạnh",
  staff_type: "TEACHER",
  is_active: true,
  phone: null,
  zalo_name: null,
  email: null,
};
const TEACHER_T2 = {
  id: "22222222-2222-4222-8222-222222222222",
  full_name: "Thầy Phúc",
  staff_type: "TEACHER",
  is_active: true,
  phone: null,
  zalo_name: null,
  email: null,
};
const ASSISTANT_A1 = {
  id: "33333333-3333-4333-8333-333333333333",
  full_name: "Cô Lan",
  staff_type: "ASSISTANT",
  is_active: true,
  phone: null,
  zalo_name: null,
  email: null,
};

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

// The product's date domain is Asia/Ho_Chi_Minh.  CI runners use UTC, so
// deriving these values from `new Date().getDate()` can select yesterday and
// make the legitimate start date disabled around 17:00 UTC.  Keep test data
// in the same canonical timezone as the application.
const vietnamTodayParts = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
};

// Pick a stable future date for the E2E form. It is not a domain minimum.
const today = vietnamTodayParts();
const chosenEndDate = () => {
  const m = new Date(today.year, today.month, today.day + 1);
  const y = m.getFullYear();
  const mo = String(m.getMonth() + 1).padStart(2, "0");
  const d = String(m.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
};

const classResponse = (overrides: Record<string, unknown> = {}) => ({
  id: "88888888-8888-4888-8888-888888888888",
  name: "Lớp Mới E2E",
  type: "MONTHLY",
  base_fee: 750000,
  billing_cycle_months: 1,
  billing_cycle_weeks: null,
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  identity_scheme: "LEGACY",
  class_category: null,
  grade_mode: null,
  program_name: null,
  grade_level: null,
  education_level: null,
  academic_year_start: null,
  schedule: { text: "Thứ 2 (10:00-11:00)", slots: [] },
  teacher_id: TEACHER_T1.id,
  teacher_ids: [TEACHER_T1.id],
  teacher_name: "Cô Hạnh",
  teacher_names: ["Cô Hạnh"],
  assistant_ids: [],
  assistant_names: [],
  is_active: true,
  student_count: 0,
  created_at: "2026-08-09T00:00:00Z",
  updated_at: "2026-08-09T00:00:00Z",
  version: 1,
  display_name: "Lớp Mới E2E",
  primary_label: "Lớp Mới E2E",
  secondary_label: null,
  effective_status: "SCHEDULED",
  can_edit_end_date: true,
  end_date_edit_deadline: null,
  can_edit: true,
  can_cancel: true,
  can_view_history: true,
  ...overrides,
});

let availabilityConflicts: unknown[] = [];
let availabilityRequests = 0;
let availabilityFailures = 0;
let saveRequests: unknown[] = [];
let meFailures = 0;

const installApiMocks = (page: Parameters<Parameters<typeof test>[1]>[0]["page"]) => {
  availabilityConflicts = [];
  availabilityRequests = 0;
  availabilityFailures = 0;
  saveRequests = [];
  meFailures = 0;

  return page.route("**/api/proxy/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/proxy", "");
    const method = route.request().method();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/me") {
      if (meFailures > 0) {
        meFailures -= 1;
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Phiên đăng nhập đã bị thay thế trên thiết bị khác" }),
        });
        return;
      }
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
      await json([TEACHER_T1, TEACHER_T2, ASSISTANT_A1]);
      return;
    }

    if (path === "/staff") {
      await json([]);
      return;
    }

    if (path === "/classes/summary") {
      await json({ operational: 1, active: 1, scheduled: 0, completed: 0, cancelled: 0 });
      return;
    }

    if (path === "/classes" && method === "GET") {
      await json([classResponse()]);
      return;
    }

    if (path === "/classes/schedule-availability" && method === "POST") {
      availabilityRequests += 1;
      if (availabilityFailures > 0) {
        availabilityFailures -= 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Lỗi tạm thời" }),
        });
        return;
      }
      await json({ conflicts: availabilityConflicts });
      return;
    }

    if (path === "/classes" && method === "POST") {
      const payload = route.request().postDataJSON();
      saveRequests.push(payload);
      await json(classResponse({ schedule: payload.schedule }));
      return;
    }

    await json({});
  });
};

const openSchedulePicker = async (page: Parameters<Parameters<typeof test>[1]>[0]["page"]) => {
  await page.getByRole("button", { name: /Thêm lớp/i }).first().click();
  const formDialog = page.getByRole("dialog").first();
  await formDialog.waitFor();
  await formDialog.locator("#class-name").fill("Lớp Mới E2E");
  await formDialog.locator("#class-fee").fill("750000");
  await formDialog.getByRole("button", { name: /Ngày bắt đầu/i }).click();
  // DatePicker là dialog LỒNG trong form dialog; có 3 section (năm/tháng/ngày).
  const picker = page.getByRole("dialog").nth(1);
  await picker.waitFor();
  const now = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
  });
  await picker.getByRole("button", { name: String(now.year), exact: true }).click();
  await picker.getByRole("button", { name: `Tháng ${now.month}`, exact: true }).click();
  await picker.getByRole("button", { name: String(now.day), exact: true }).click();
  await picker.getByRole("button", { name: "Xác nhận" }).click();
  await picker.waitFor({ state: "detached" });
  // The end date is freely selected and remains independent from fee cadence.
  await formDialog.locator("#class-end-date").click();
  const endPicker = page.getByRole("dialog").nth(1);
  await endPicker.waitFor();
  const chosenEnd = chosenEndDate().split("-").map(Number);
  await endPicker
    .getByRole("button", { name: String(chosenEnd[0]), exact: true })
    .click();
  await endPicker
    .getByRole("button", { name: `Tháng ${chosenEnd[1]}`, exact: true })
    .click();
  await endPicker.getByRole("button", { name: String(chosenEnd[2]), exact: true }).click();
  await endPicker.getByRole("button", { name: "Xác nhận" }).click();
  await endPicker.waitFor({ state: "detached" });
  await page.getByRole("button", { name: /Giáo viên \/ Trợ giảng/i }).click();
  const teacherSlide = page.getByRole("dialog").nth(1);
  await teacherSlide.waitFor();
  await teacherSlide.getByRole("button", { name: "Cô Hạnh" }).click();
  // Staff-pool selection commits through the existing confirmation action.
  await teacherSlide.getByRole("button", { name: "Xác nhận" }).click();
  await teacherSlide.waitFor({ state: "detached" });
  await page.getByRole("button", { name: /Lịch học/i }).click();
  await page.locator("[data-schedule-grid='true']").waitFor();
  await page.waitForTimeout(600);
};

const dragTwoCells = async (page: Parameters<Parameters<typeof test>[1]>[0]["page"]) => {
  const cell = page.locator("[data-day-index='0'][data-time-index='6']");
  const box = await cell.boundingBox();
  if (!box) throw new Error("grid cell missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 2.5, { steps: 6 });
  await page.mouse.up();
};

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
  await page.context().addCookies([
    { name: "tpro_access_token", value: fakeToken(), url: "http://localhost:3100/classes" },
  ]);
});

test("T-E2E-PROD-001: valid session loads the classes route, opens the form and the schedule picker", async ({ page }) => {
  await page.goto("http://localhost:3100/classes");
  await page.getByRole("button", { name: /Thêm lớp/i }).first().waitFor();
  await openSchedulePicker(page);
  await expect(page.getByRole("button", { name: /Áp dụng lịch|Xác nhận/i })).toBeVisible();
  expect(availabilityRequests).toBeGreaterThanOrEqual(1);
});

test("T-E2E-PROD-002: two adjacent clicks create and save one valid 60-minute session", async ({ page }) => {
  await page.goto("http://localhost:3100/classes");
  await openSchedulePicker(page);

  const first = page.locator("[data-day-index='0'][data-time-index='6']");
  const second = page.locator("[data-day-index='0'][data-time-index='7']");
  await first.click();
  await expect(page.locator("[data-click-anchor='true']")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Chọn thêm một ô liền kề", exact: true })).toBeDisabled();

  await second.click();
  await expect(page.locator("[data-click-anchor='true']")).toHaveCount(0);
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Áp dụng lịch|Xác nhận/i }).click();
  await page.getByRole("button", { name: /Tạo lớp|Lưu/i }).first().click();
  await page.waitForTimeout(500);

  const payload = saveRequests[0] as {
    schedule?: {
      slots?: Array<{
        day: string;
        start: string;
        end: string;
        teacher_ids: string[];
      }>;
    };
  };
  expect(payload.schedule?.slots).toHaveLength(1);
  expect(payload.schedule?.slots?.[0]).toMatchObject({
    day: "Thứ 2",
    start: "10:00",
    end: "11:00",
    teacher_ids: [TEACHER_T1.id],
  });
});

test("T-E2E-PROD-003: availability 500 shows alert, disables confirm; no save is sent", async ({ page }) => {
  availabilityFailures = 1;
  await page.goto("http://localhost:3100/classes");
  await openSchedulePicker(page);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Thử lại/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Áp dụng lịch|Xác nhận/i })).toBeDisabled();
  await dragTwoCells(page);
  await page.waitForTimeout(300);
  expect(saveRequests).toHaveLength(0);
});

test("T-E2E-PROD-004: retry after error succeeds; painting and confirm send the exact payload", async ({ page }) => {
  availabilityFailures = 1;
  await page.goto("http://localhost:3100/classes");
  await openSchedulePicker(page);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.getByRole("button", { name: /Thử lại/i }).click();
  await expect(page.getByRole("button", { name: /Thử lại/i })).toHaveCount(0);
  await dragTwoCells(page);
  await page.getByRole("button", { name: /Áp dụng lịch|Xác nhận/i }).click();
  await page.getByRole("button", { name: /Tạo lớp|Lưu/i }).first().click();
  await page.waitForTimeout(500);
  const payload = saveRequests[0] as {
    schedule?: { slots?: Array<{ day: string; start: string; end: string; teacher_ids: string[]; assistant_ids: string[] }> };
  };
  expect(payload.schedule?.slots?.[0]).toMatchObject({
    day: "Thứ 2",
    start: "10:00",
    end: "11:00",
    teacher_ids: [TEACHER_T1.id],
  });
});

test("T-E2E-PROD-005: session 401 triggers auth recovery without ambiguous data loss", async ({ page }) => {
  meFailures = 1;
  await page.goto("http://localhost:3100/classes");
  await page.waitForTimeout(1200);
  expect(new URL(page.url()).pathname).not.toBe("/classes");
});

test("T-E2E-PROD-006: reopening the schedule picker within staleTime reuses cached availability (no redundant fetch)", async ({ page }) => {
  await page.goto("http://localhost:3100/classes");
  await openSchedulePicker(page);
  const first = availabilityRequests;
  // Đóng schedule slide bằng Escape (không drag → Escape đóng panel).
  await page.keyboard.press("Escape");
  await page.locator("[data-schedule-grid='true']").waitFor({ state: "detached" });
  await page.getByRole("button", { name: /Lịch học/i }).click();
  await page.locator("[data-schedule-grid='true']").waitFor();
  await page.waitForTimeout(400);
  // Availability is cached (staleTime 10s) so a quick reopen must NOT issue a
  // redundant request — this is the Round 8 perf contract.
  expect(availabilityRequests).toBe(first);
});

test("T-E2E-PROD-008: another class block is locked before per-session assignment", async ({ page }) => {
  availabilityConflicts = [
    {
      class_id: "77777777-7777-4777-8777-777777777777",
      class_name: "Lớp Khác",
      class_category: null,
      grade_level: null,
      day: "Thứ 2",
      start: "10:00",
      end: "11:00",
      // Cô Hạnh is the active teacher scope in the picker, so this slot must
      // be marked busy for the selected assignment to be locked.
      busy_teacher_ids: [TEACHER_T1.id],
      busy_assistant_ids: [ASSISTANT_A1.id],
    },
  ];
  await page.goto("http://localhost:3100/classes");
  await openSchedulePicker(page);
  // The right panel stays a compact list; the teacher scope tab above the
  // grid is the single context selector for the chosen teacher.
  await expect(page.getByRole("heading", { name: /Buổi học/ })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
  const busyCell = page.locator("[data-day-index='0'][data-time-index='6']");
  await expect(busyCell).toHaveAttribute("data-schedule-state", "busy");
  await expect(busyCell).toHaveAttribute("aria-disabled", "true");
  await expect(busyCell).toBeDisabled();
  const busyBox = await busyCell.boundingBox();
  if (!busyBox) throw new Error("busy schedule cell is not measurable");
  await page.mouse.click(busyBox.x + busyBox.width / 2, busyBox.y + busyBox.height / 2);
  await dragTwoCells(page);
  await expect(page.locator("button[aria-pressed='true'][data-day-index='0']")).toHaveCount(0);
  expect(saveRequests).toHaveLength(0);
});

test("T-E2E-PROD-009: the final real cell keeps the same visible fill after an 08:00-16:00 commit", async ({ page }) => {
  await page.goto("http://localhost:3100/classes");
  await openSchedulePicker(page);

  const startCell = page.locator("[data-day-index='1'][data-time-index='2']");
  const endBoundaryCell = page.locator("[data-day-index='1'][data-time-index='18']");
  const startBox = await startCell.boundingBox();
  const endBox = await endBoundaryCell.boundingBox();
  if (!startBox || !endBox) throw new Error("schedule grid cells are missing");

  await page.mouse.move(
    startBox.x + startBox.width / 2,
    startBox.y + startBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    endBox.x + endBox.width / 2,
    endBox.y + 0.5,
    { steps: 24 },
  );

  await expect(endBoundaryCell).toHaveAttribute(
    "data-schedule-endpoint",
    "true",
  );
  const endpointPreviewColor = await endBoundaryCell.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(endpointPreviewColor).not.toBe("rgb(255, 255, 255)");
  expect(endpointPreviewColor).not.toBe("rgba(0, 0, 0, 0)");

  await page.mouse.up();

  const finalRealCell = page.locator("[data-day-index='1'][data-time-index='17']");
  await expect(finalRealCell).toHaveAttribute("aria-pressed", "true");
  await expect(endBoundaryCell).toHaveAttribute("aria-pressed", "false");
  await expect(endBoundaryCell).toHaveAttribute(
    "data-schedule-endpoint",
    "true",
  );
  await expect(
    page.locator("[data-schedule-session-key='Thứ 3|08:00|16:00']"),
  ).toBeVisible();

  const colors = await page.evaluate(() => {
    const styleAt = (timeIndex: number) => {
      const element = document.querySelector<HTMLElement>(
        `[data-day-index="1"][data-time-index="${timeIndex}"]`,
      );
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
      };
    };
    return {
      middle: styleAt(10),
      last: styleAt(17),
      endpoint: styleAt(18),
    };
  });

  expect(colors.middle?.backgroundColor).toBe(colors.last?.backgroundColor);
  expect(colors.endpoint?.backgroundColor).toBe(colors.last?.backgroundColor);
  expect(colors.endpoint?.backgroundColor).not.toBe("rgb(255, 255, 255)");
  expect(colors.endpoint?.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors.endpoint?.boxShadow).toContain("inset");
  expect(colors.endpoint?.boxShadow).toContain("-2px");
});

test("T-E2E-PROD-010: the filled endpoint supports click shrinking and bidirectional dragging", async ({ page }) => {
  await page.goto("http://localhost:3100/classes");
  await openSchedulePicker(page);

  const startCell = page.locator("[data-day-index='1'][data-time-index='2']");
  const endCell = page.locator("[data-day-index='1'][data-time-index='18']");
  const startBox = await startCell.boundingBox();
  const endBox = await endCell.boundingBox();
  if (!startBox || !endBox) throw new Error("schedule grid cells are missing");

  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + 0.5, { steps: 24 });
  await page.mouse.up();
  await expect(
    page.locator("[data-schedule-session-key='Thứ 3|08:00|16:00']"),
  ).toBeVisible();

  // The filled 16:00 endpoint behaves like the visible end edge: one click
  // shrinks by 30 minutes instead of extending the data to 16:30.
  await endCell.click();
  await expect(
    page.locator("[data-schedule-session-key='Thứ 3|08:00|15:30']"),
  ).toBeVisible();
  await expect(
    page.locator("[data-day-index='1'][data-time-index='17']"),
  ).toHaveAttribute("data-schedule-endpoint", "true");

  // The endpoint has moved to 15:30. Dragging down from that exact endpoint
  // must switch to extension mode immediately and restore the 30 minutes.
  const movedEndpointCell = page.locator(
    "[data-day-index='1'][data-time-index='17']",
  );
  const movedEndpointBox = await movedEndpointCell.boundingBox();
  const restoreBoundaryBox = await endCell.boundingBox();
  if (!movedEndpointBox || !restoreBoundaryBox) {
    throw new Error("moved schedule endpoint cells are missing");
  }
  await page.mouse.move(
    movedEndpointBox.x + movedEndpointBox.width / 2,
    movedEndpointBox.y + movedEndpointBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    restoreBoundaryBox.x + restoreBoundaryBox.width / 2,
    restoreBoundaryBox.y + 4,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect(
    page.locator("[data-schedule-session-key='Thứ 3|08:00|16:00']"),
  ).toBeVisible();

  const newEndBox = await endCell.boundingBox();
  const previousBoundaryCell = page.locator(
    "[data-day-index='1'][data-time-index='17']",
  );
  const previousBoundaryBox = await previousBoundaryCell.boundingBox();
  if (!newEndBox || !previousBoundaryBox) {
    throw new Error("schedule endpoint cells are missing");
  }
  await page.mouse.move(
    newEndBox.x + newEndBox.width / 2,
    newEndBox.y + newEndBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    previousBoundaryBox.x + previousBoundaryBox.width / 2,
    previousBoundaryBox.y + 4,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect(
    page.locator("[data-schedule-session-key='Thứ 3|08:00|15:30']"),
  ).toBeVisible();
  await expect(previousBoundaryCell).toHaveAttribute(
    "data-schedule-endpoint",
    "true",
  );
});
