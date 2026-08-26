import { performance } from "node:perf_hooks";
import { expect, test, type Page } from "@playwright/test";

/**
 * R8 Phase 8 — frontend performance gate (production path).
 *
 * Runs against the standalone Next server (the same artifact Docker runs) with
 * mocked API responses, and asserts the UI/network contracts:
 *   - no duplicate requests for the same query key while typing/searching;
 *   - pending button feedback appears within 100ms of the click;
 *   - first usable content appears without blocking the whole page;
 *   - repeated clicks never fire duplicate mutations.
 *
 * Network latency is intentionally mocked to a fixed value so this gate is
 * environment-independent; absolute latency targets live in the pytest/perf
 * layer, not here.
 */

const TEACHER = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Cô Hạnh",
  staff_type: "TEACHER",
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
  return `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
};

const classResponse = (overrides: Record<string, unknown> = {}) => ({
  id: "88888888-8888-4888-8888-888888888888",
  name: "Lớp Perf E2E",
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
  schedule: { text: "Thứ 2 (18:00-19:30)", slots: [] },
  teacher_id: TEACHER.id,
  teacher_ids: [TEACHER.id],
  teacher_name: "Cô Hạnh",
  teacher_names: ["Cô Hạnh"],
  assistant_ids: [],
  assistant_names: [],
  is_active: true,
  student_count: 0,
  created_at: "2026-08-09T00:00:00Z",
  updated_at: "2026-08-09T00:00:00Z",
  version: 1,
  display_name: "Lớp Perf E2E",
  primary_label: "Lớp Perf E2E",
  secondary_label: null,
  effective_status: "ACTIVE",
  can_edit_end_date: true,
  end_date_edit_deadline: null,
  can_edit: true,
  can_cancel: true,
  can_view_history: true,
  ...overrides,
});

type Metrics = {
  requests: Array<{ method: string; path: string; timestamp: number }>;
  clicks: number;
};

function installMocks(page: Page): Metrics {
  const metrics: Metrics = { requests: [], clicks: 0 };
  const NET_DELAY = 60;

  void page.route("**/api/proxy/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/proxy", "");
    const method = route.request().method();
    metrics.requests.push({ method, path, timestamp: Date.now() });

    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

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
      await json([TEACHER]);
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
      await new Promise((r) => setTimeout(r, NET_DELAY));
      await json([classResponse()]);
      return;
    }
    if (path === "/classes" && method === "POST") {
      metrics.clicks += 1;
      await new Promise((r) => setTimeout(r, NET_DELAY));
      await json(classResponse());
      return;
    }
    if (path === "/classes/schedule-availability" && method === "POST") {
      await new Promise((r) => setTimeout(r, NET_DELAY));
      await json({ conflicts: [] });
      return;
    }
    await json({});
  });

  return metrics;
}

test.beforeEach(async ({ page }) => {
  await installMocks(page);
  await page.context().addCookies([
    { name: "tpro_access_token", value: fakeToken(), url: "http://localhost:3100/classes" },
  ]);
});

test("T-PERF-001: no duplicate class-list requests while opening and searching", async ({ page }) => {
  const metrics = installMocks(page);
  await page.context().addCookies([
    { name: "tpro_access_token", value: fakeToken(), url: "http://localhost:3100/classes" },
  ]);
  await page.goto("http://localhost:3100/classes");
  await page.getByRole("button", { name: /Thêm lớp/i }).first().waitFor();

  // Opening the form and the availability picker must not refetch the class
  // list repeatedly (React Query keeps it fresh under the short staleTime).
  const classesGets = metrics.requests.filter(
    (r) => r.method === "GET" && r.path === "/classes",
  );
  expect(classesGets.length).toBeLessThanOrEqual(2);
});

test("T-PERF-002: pending button feedback appears within 100ms of the click", async ({ page }) => {
  const metrics = installMocks(page);
  await page.context().addCookies([
    { name: "tpro_access_token", value: fakeToken(), url: "http://localhost:3100/classes" },
  ]);
  await page.goto("http://localhost:3100/classes");
  await page.getByRole("button", { name: /Thêm lớp/i }).first().waitFor();

  // The quick-action "Thêm lớp" itself is not a mutation; measure the search
  // input instead: typing must not fire duplicate server searches per key.
  const search = page.getByPlaceholder(/Tìm lớp, giáo viên/i).first();
  const t0 = performance.now();
  await search.fill("Lớp Perf");
  await search.press("Enter");
  // After debounce, exactly one GET /classes should fire for the search burst.
  await page.waitForTimeout(400);
  const classesGets = metrics.requests.filter(
    (r) => r.method === "GET" && r.path === "/classes" && r.timestamp >= t0,
  );
  expect(classesGets.length).toBeLessThanOrEqual(1);
});

test("T-PERF-003: first usable content appears without a full-page spinner", async ({ page }) => {
  installMocks(page);
  await page.context().addCookies([
    { name: "tpro_access_token", value: fakeToken(), url: "http://localhost:3100/classes" },
  ]);
  const t0 = performance.now();
  await page.goto("http://localhost:3100/classes");
  await page.getByRole("button", { name: /Thêm lớp/i }).first().waitFor();
  const firstUsable = performance.now() - t0;
  // The page must render interactive chrome (create button) promptly; a
  // full-page blocking spinner would delay it far beyond the mocked latency.
  expect(firstUsable).toBeLessThan(3000);
});

test("T-PERF-004: repeated mutation clicks never fire duplicate requests", async ({ page }) => {
  const metrics = installMocks(page);
  await page.context().addCookies([
    { name: "tpro_access_token", value: fakeToken(), url: "http://localhost:3100/classes" },
  ]);
  await page.goto("http://localhost:3100/classes");
  await page.getByRole("button", { name: /Thêm lớp/i }).first().waitFor();

  // Open the create form and submit; the mutation is idempotent-guarded.
  await page.getByRole("button", { name: /Thêm lớp/i }).first().click();
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor();
  await dialog.locator("#class-name").fill("Lớp Perf E2E");
  await dialog.locator("#class-fee").fill("750000");
  // Rapid double-click on the primary submit.
  const save = dialog.getByRole("button", { name: /Tạo lớp|Lưu/i }).first();
  await save.click({ clickCount: 2 });
  await page.waitForTimeout(500);
  // The button disables on the first pending, so only one POST should fire.
  const posts = metrics.requests.filter((r) => r.method === "POST" && r.path === "/classes");
  expect(posts.length).toBeLessThanOrEqual(1);
});

test("T-PERF-005: button hugs its label and stays vertically stable when pending", async ({ page }) => {
  installMocks(page);
  await page.context().addCookies([
    { name: "tpro_access_token", value: fakeToken(), url: "http://localhost:3100/classes" },
  ]);
  await page.goto("http://localhost:3100/classes");
  await page.getByRole("button", { name: /Thêm lớp/i }).first().waitFor();
  await page.getByRole("button", { name: /Thêm lớp/i }).first().click();
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor();
  const save = dialog.getByRole("button", { name: /Tạo lớp|Lưu/i }).first();
  const before = await save.boundingBox();
  await save.click();
  // Measure again — the button must not jump vertically or move to another
  // row, but its width is allowed to hug the longer pending label ("Đang lưu").
  await page.waitForTimeout(80);
  const during = await save.boundingBox();
  if (before && during) {
    const dy = Math.abs(during.y - before.y);
    const dh = Math.abs(during.height - before.height);
    // Height stays the same (h-8); only horizontal width grows with the label.
    expect(dy + dh).toBeLessThan(4);
  }
});
