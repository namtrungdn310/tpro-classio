import { expect, test, type Page } from "@playwright/test";

const eid = "70000000-0000-4000-8000-000000000001";
const sid = "60000000-0000-4000-8000-000000000001";
const cid = "80000000-0000-4000-8000-000000000001";
const from = "2027-08-10", resume = "2027-08-20";
const row = { id: sid, enrollment_id: eid, suspended_from: from, resume_on: resume,
  status: "ACTIVE", version: 1, reason: "Gia đình xin nghỉ", updated_at: "2027-08-01T00:00:00Z" };
const preview = { enrollment_id: eid, suspension_id: null, student_name: "Học viên kiểm thử", class_name: "TPRO lớp 6",
  suspended_from: from, resume_on: resume, calendar_days: 10, previous_preserved_days: 0, preserved_days: 10,
  delta_days: 10, overlap_or_waived_days: 0, target_coverage_start: "2027-09-10", old_due_date: "2027-09-10", new_due_date: "2027-09-20",
  pending_days: 0, protected_count: 1, late_report: false, fingerprint: "a".repeat(64), warnings: ["Giữ nguyên khoản đã báo thu."] };

async function base(page: Page, hasRow = false) {
  await page.route("**/api/proxy/**", async route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/suspensions") && route.request().method() === "GET") return route.fulfill({ json: { items: hasRow ? [row] : [], total: hasRow ? 1 : 0, pending_days: 0 } });
    if (u.pathname.endsWith("/preview")) return route.fulfill({ json: { ...preview, ...route.request().postDataJSON(), fingerprint: "a".repeat(64) } });
    await route.fulfill({ json: { ...preview, suspension_id: sid } });
  });
}
async function fillDates(page: Page) {
  for (const [label, value] of [["Ngày bắt đầu nghỉ", "10/08/2027"], ["Ngày học lại", "20/08/2027"]]) {
    const input = page.getByLabel(label, { exact: true });
    // Focus intentionally keeps a thin caret; replace via the user's explicit
    // select-all gesture rather than relying on focus to select an entire date.
    await input.click(); await input.press("ControlOrMeta+A"); await input.press("Backspace");
    await input.fill(value);
    await expect(input).toHaveValue(value);
  }
}
async function fill(page: Page) {
  await fillDates(page);
  await page.getByLabel("Lý do tạm nghỉ hoặc điều chỉnh", { exact: true }).fill("Gia đình xin nghỉ");
  await page.getByRole("button", { name: "Xem tác động", exact: true }).click();
  await expect(page.getByText("Tổng ngày bảo lưu của lượt học: 0 → 10 ngày.")).toBeVisible();
}

test("preview accepts no reason; notes can be added without recalculation; save still requires them", async ({ page }) => {
  await base(page);
  const previews: unknown[] = [], commands: unknown[] = [];
  page.on("request", request => {
    if (request.method() !== "POST") return;
    if (request.url().endsWith("/preview")) previews.push(request.postDataJSON());
    else if (request.url().endsWith("/suspensions")) commands.push(request.postDataJSON());
  });
  await page.goto("/suspensions.html");
  await fillDates(page);
  await page.getByRole("button", { name: "Tạo lần tạm nghỉ", exact: true }).click();
  await expect(page.getByText("Tổng ngày bảo lưu của lượt học: 0 → 10 ngày.")).toBeVisible();
  expect(previews).toHaveLength(1); expect(commands).toHaveLength(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByText("Nhập lý do trước khi xác nhận lưu.")).toBeVisible();
  const reason = page.getByLabel("Lý do tạm nghỉ hoặc điều chỉnh", { exact: true });
  await expect(reason).toBeFocused();
  expect(commands).toHaveLength(0);
  await reason.fill("Xin nghỉ vì việc gia đình");
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByText("Đã lưu và cập nhật ngày bảo lưu.")).toBeVisible();
  expect(previews).toHaveLength(1); expect(commands).toHaveLength(1);
});

test("TPRO controls share typography, spacing, hidden scrollbars and submit-only error rings", async ({ page }) => {
  await base(page); await page.goto("/suspensions.html");
  const start = page.getByLabel("Ngày bắt đầu nghỉ", { exact: true });
  const resumeInput = page.getByLabel("Ngày học lại", { exact: true });
  const reason = page.getByLabel("Lý do tạm nghỉ hoặc điều chỉnh", { exact: true });
  for (const input of [start, resumeInput, reason]) {
    await input.focus(); await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
  }
  await start.focus();
  await start.locator("..").screenshot({ path: test.info().outputPath("caret-filled.png"), caret: "initial", animations: "disabled" });
  await resumeInput.focus();
  await resumeInput.locator("..").screenshot({ path: test.info().outputPath("caret-empty.png"), caret: "initial", animations: "disabled" });
  const typography = (el: HTMLElement) => {
    const s = getComputedStyle(el);
    return [s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight, s.caretColor, s.height];
  };
  expect(await start.evaluate(typography)).toEqual(await resumeInput.evaluate(typography));
  await expect(reason).toHaveCSS("padding-top", "8px");
  await expect(reason).toHaveCSS("padding-bottom", "8px");
  const create = page.getByRole("button", { name: "Tạo lần tạm nghỉ", exact: true });
  const inspect = page.getByRole("button", { name: "Xem tác động", exact: true });
  await expect(create).toHaveCSS("height", "32px"); await expect(inspect).toHaveCSS("height", "32px");
  await expect(create).toHaveClass(/bg-primary/); await expect(inspect).not.toHaveClass(/bg-primary/);
  await inspect.click(); await resumeInput.focus();
  await expect(resumeInput).toHaveAttribute("aria-invalid", "true");
  await expect(resumeInput.locator("..")).toHaveCSS("border-color", "rgb(221, 3, 55)");
  await expect.poll(() => resumeInput.evaluate(el => getComputedStyle(el.parentElement!).getPropertyValue("--tw-ring-color"))).toContain("#dd0337");
  await resumeInput.fill("2"); await expect(page.getByRole("alert")).toHaveCount(0);
  const scroller = page.locator(".scrollbar-hidden.overflow-y-auto");
  await expect(scroller).toHaveCount(1); await expect(scroller).toHaveCSS("scrollbar-width", "none");
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(create).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath("tpro-individual-mobile.png"), fullPage: true, animations: "disabled" });
});

test("loading uses shared animated dots and prevents double actions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await base(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/suspensions/preview`, async route => { await gate; await route.fulfill({ json: preview }); });
  await page.goto("/suspensions.html");
  await fillDates(page);
  await page.getByRole("button", { name: "Xem tác động", exact: true }).click();
  const pending = page.locator('button[aria-busy="true"]');
  await expect(pending.locator(".loading-dots > span")).toHaveCount(3);
  await expect(pending.locator(".loading-dots > span").first()).not.toHaveCSS("animation-name", "none");
  await expect(page.getByRole("button", { name: "Tạo lần tạm nghỉ", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "Xác nhận", exact: true })).toBeVisible();
});

test("student workspace binds to the opened class even with multiple enrollments", async ({ page }) => {
  await base(page);
  await page.route("**/students/*/enrollments", route => route.fulfill({ json: [] }));
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/suspensions")) requests.push(request.url()); });
  await page.goto("/suspensions.html?workspace=scoped");
  await expect(page.getByRole("dialog", { name: "Tạm nghỉ học", exact: true })).toBeVisible();
  await expect(page.getByText(/Học viên kiểm thử.*TPRO lớp 6/)).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  await fill(page);
  expect(requests.some(url => url.includes(`/enrollments/${eid}/suspensions`))).toBe(true);
  expect(requests.some(url => url.includes("70000000-0000-4000-8000-000000000002"))).toBe(false);
  await page.screenshot({ path: test.info().outputPath("tpro-student-workspace-desktop.png"), fullPage: true, animations: "disabled" });
  await page.goto("/suspensions.html?workspace=unscoped");
  await expect(page.getByRole("tab", { name: "Tạm nghỉ học", exact: true })).toHaveCount(0);
});

test("individual preview requires confirmation and never reports errors while initially typing", async ({ page }) => {
  await base(page); await page.goto("/suspensions.html");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("Ngày học lại", { exact: true }).fill("2");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await fill(page);
  await expect(page.getByRole("button", { name: "Xác nhận", exact: true })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByText("Đã lưu và cập nhật ngày bảo lưu.")).toBeVisible();
  await expect(page.getByTestId("shell-state")).toHaveText("idle / clean");
});

test("lost response and reload retry exactly the same command", async ({ page }) => {
  await base(page);
  const bodies: object[] = [];
  await page.route(`**/api/proxy/enrollments/${eid}/suspensions`, async route => {
    if (route.request().method() === "GET") return route.fallback();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort();
    return route.fulfill({ json: { ...preview, suspension_id: sid } });
  });
  await page.goto("/suspensions.html"); await fill(page);
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kiểm tra kết quả", exact: true })).toBeVisible();
  await expect(page.getByLabel("Ngày học lại", { exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await expect(page.getByText("Đã lưu và cập nhật ngày bảo lưu.")).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
});

test("stale preview requires checking again; cancel keeps source dates and mobile fits", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await base(page, true);
  await page.route(`**/api/proxy/enrollments/${eid}/suspensions`, async route => route.request().method() === "GET" ? route.fallback()
    : route.fulfill({ status: 409, json: { detail: "Lịch nghỉ vừa thay đổi. Hãy xem lại." } }));
  await page.goto("/suspensions.html"); await page.getByRole("button", { name: "Hủy nhập nhầm", exact: true }).click();
  await expect(page.getByLabel("Ngày bắt đầu nghỉ", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Ngày học lại", { exact: true })).toBeDisabled();
  await page.getByLabel("Lý do tạm nghỉ hoặc điều chỉnh", { exact: true }).fill("Nhập nhầm");
  await page.getByRole("button", { name: "Xem tác động", exact: true }).click();
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByText("Lịch nghỉ vừa thay đổi. Hãy xem lại.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Xem tác động", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("individual-mobile.png"), fullPage: true });
});

test("class lifecycle previews restoration and blocks unsafe confirmation", async ({ page }) => {
  await page.route("**/api/proxy/**", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [{ ...row, status: "OPEN" }], total: 1 } });
    await route.fulfill({ json: { adjustment_id: sid, previous_resume_on: resume, resume_on: resume, cancel: true,
      restore_count: 2, suspend_count: 0, fingerprint: "b".repeat(64), blocked_reasons: ["Buổi đã chấm công cần kiểm tra trước."], member_summary: [] } });
  });
  await page.goto(`/suspensions.html?class=${cid}`);
  await page.getByRole("button", { name: "Hủy nhập nhầm", exact: true }).click();
  await page.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Lịch nghỉ nhập nhầm");
  await page.getByRole("button", { name: "Xem tác động", exact: true }).click();
  await expect(page.getByText("Buổi đã chấm công cần kiểm tra trước.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Xác nhận", exact: true })).toBeDisabled();
});

test("year filter can be cleared without firing partial-year requests", async ({ page }) => {
  await base(page); await page.goto("/suspensions.html");
  const years: string[] = [];
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname.endsWith("/suspensions")) years.push(url.searchParams.get("year") ?? ""); });
  const year = page.getByLabel("Năm", { exact: true });
  await year.fill(""); await year.fill("202");
  expect(years).not.toContain("202");
  await year.fill("2025"); await year.press("Enter");
  await expect.poll(() => years.includes("2025")).toBe(true);
});

test("receipt cleanup failure after commit does not offer another submission", async ({ page }) => {
  await base(page); await page.goto("/suspensions.html"); await fill(page);
  await page.evaluate(() => { Storage.prototype.removeItem = () => { throw new Error("Storage temporarily unavailable"); }; });
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByText("Đã lưu và cập nhật ngày bảo lưu.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Kiểm tra kết quả", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xác nhận", exact: true })).toHaveCount(0);
});

test("HTTP timeout and rate limit retain the same receipt across retries", async ({ page }) => {
  await base(page);
  const bodies: object[] = [];
  await page.route(`**/api/proxy/enrollments/${eid}/suspensions`, async route => {
    if (route.request().method() === "GET") return route.fallback();
    bodies.push(route.request().postDataJSON());
    if (bodies.length < 3) return route.fulfill({ status: bodies.length === 1 ? 408 : 429, json: { detail: "Vui lòng kiểm tra lại kết quả." } });
    return route.fulfill({ json: { ...preview, suspension_id: sid } });
  });
  await page.goto("/suspensions.html"); await fill(page);
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  for (let i = 0; i < 2; i++) {
    const retry = page.getByRole("button", { name: "Kiểm tra kết quả", exact: true });
    await expect(retry).toBeEnabled(); await retry.click();
  }
  await expect(page.getByText("Đã lưu và cập nhật ngày bảo lưu.")).toBeVisible();
  expect(bodies).toHaveLength(3);
  expect(bodies[1]).toEqual(bodies[0]); expect(bodies[2]).toEqual(bodies[0]);
});

test("class lifecycle protects the unsaved draft when going back", async ({ page }) => {
  await page.route("**/api/proxy/**", route => route.fulfill({ json: { items: [{ ...row, status: "OPEN" }], total: 1 } }));
  await page.goto("/suspensions.html?class=1");
  await page.getByRole("button", { name: "Gia hạn / học lại sớm", exact: true }).click();
  await page.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Đang nhập chưa muốn bỏ");
  await page.getByRole("button", { name: "Quay lại tạo lần hoãn", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Bỏ điều chỉnh chưa lưu?" })).toBeVisible();
  await page.getByRole("button", { name: "Tiếp tục chỉnh sửa", exact: true }).click();
  await expect(page.getByLabel("Lý do điều chỉnh", { exact: true })).toHaveValue("Đang nhập chưa muốn bỏ");
});

test("class lifecycle reload resumes the identical accepted adjustment", async ({ page }) => {
  const bodies: object[] = [];
  const response = { adjustment_id: sid, previous_resume_on: resume, resume_on: resume, cancel: true,
    restore_count: 2, suspend_count: 0, fingerprint: "b".repeat(64), blocked_reasons: [], member_summary: [] };
  await page.route("**/api/proxy/**", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [{ ...row, status: "OPEN" }], total: 1 } });
    if (route.request().url().endsWith("/preview")) return route.fulfill({ json: response });
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort();
    return route.fulfill({ json: response });
  });
  await page.goto("/suspensions.html?class=1");
  await page.getByRole("button", { name: "Hủy nhập nhầm", exact: true }).click();
  await page.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Hủy nhập nhầm có kiểm tra");
  await page.getByRole("button", { name: "Xem tác động", exact: true }).click();
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kiểm tra kết quả", exact: true })).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "Kiểm tra kết quả", exact: true }).click();
  await expect(page.getByText("Đã lưu điều chỉnh hoãn lớp.")).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
});
