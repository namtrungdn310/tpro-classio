import { expect, test } from "@playwright/test";
const id = "22222222-2222-4222-8222-222222222222";

test("report selects enrollment, reads fees and operation-year history without writes", async ({ page }, testInfo) => {
  const reads: string[] = [];
  let writes = 0;
  await page.route("**/reports/billing/**", async route => {
    if (route.request().method() !== "GET") { writes++; return route.abort(); }
    const url = new URL(route.request().url()); reads.push(url.href);
    if (url.pathname.endsWith("/enrollments")) return route.fulfill({ json: { items: [{ id, student_name: "Nguyễn Minh", class_name: "6C1", enrollment_date: "2026-01-01", status: "active" }], total: 1, page: 1, has_next: false } });
    if (url.pathname.endsWith("/fees")) return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20, has_next: false, year: 2026, current_year: 2026, available_years: [2026], older_pending_count: 0, undated_pending_count: 0 } });
    return route.fulfill({ json: { items: [{ id, old_date: "2020-01-01", new_date: "2020-02-01", reason: "Phụ huynh đề nghị", created_at: "2026-09-09T03:00:00Z", actor_name: "Quản lý", created_count: 1, replaced_count: 1, kept_count: 0, charges: [{ coverage: { start: "2020-02-01", end: "2020-03-01" }, due_date: "2020-02-01", amount: 900000 }], waived_intervals: [] }], total: 1, page: 1, has_next: false, current_year: 2026, available_years: [2026, 2025] } });
  });
  await page.goto("/billing-dates.html?report");
  await page.getByLabel("Tìm học viên hoặc lớp", { exact: true }).fill("Minh");
  await expect.poll(() => reads.some(u => u.includes("q=Minh"))).toBe(true);
  await page.getByRole("button", { name: /Nguyễn Minh/ }).click();
  const report = page.getByRole("region", { name: "Báo cáo lượt học" });
  await expect(report.getByText("Lý do: Phụ huynh đề nghị")).toBeVisible();
  await report.getByText("Chi tiết kết quả", { exact: true }).click();
  await expect(report.getByText(/900.000đ/)).toBeVisible();
  await report.getByLabel("Năm thực hiện điều chỉnh", { exact: true }).selectOption("2025");
  await expect.poll(() => reads.some(u => u.includes("/history?year=2025"))).toBe(true);
  await expect(report.getByLabel("Năm của kỳ thu", { exact: true })).toHaveValue("current");
  expect(writes).toBe(0);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await report.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("billing-report-mobile.png"), fullPage: true });
});
