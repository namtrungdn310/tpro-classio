import { expect, test } from "@playwright/test";

/** Component harness for the whole-class postponement flow. */
async function chooseEndDate(page: import("@playwright/test").Page) {
  const target = new Date();
  target.setDate(target.getDate() + 14);
  await page.locator("#makeup-range-to").fill(
    `${String(target.getDate()).padStart(2, "0")}/${String(target.getMonth() + 1).padStart(2, "0")}/${target.getFullYear()}`,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/makeup-workspace.html");
  await expect(page.getByRole("heading", { name: "Hoãn lớp — Lớp 6A1" })).toBeVisible();
});

test("renders a postponement-only workspace", async ({ page }) => {
  await expect(page.locator('section[aria-label="Hoãn lớp"]')).toBeVisible();
  await expect(page.getByLabel("Ngày bắt đầu nghỉ")).toBeVisible();
  await expect(page.getByLabel("Ngày học lại")).toBeVisible();
  await expect(page.getByText("Lý do hoãn")).toBeVisible();
  await expect(page.getByText("Ghi chú (không bắt buộc)", { exact: true })).toBeVisible();
  await expect(page.getByText(/Xếp lịch bù|Xếp bù ngay|Xếp sau|Đã học bù/)).toHaveCount(0);
});

test("shows automatic occurrence and member preview after choosing a range", async ({ page }) => {
  await chooseEndDate(page);
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByText(/Hoãn 1 buổi;/)).toBeVisible();
  await page.getByText("Xem ngày thu của từng học viên").click();
  await expect(page.getByText(/Học viên thử · 14 ngày bảo lưu/)).toBeVisible();
});

test("requires confirmation and retries an uncertain result using the same request", async ({ page }) => {
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/classes/*/suspensions", async route => {
    payloads.push(route.request().postDataJSON());
    await route.abort("failed");
  });
  await chooseEndDate(page);
  const postponeButton = page.getByRole("button", { name: "Xác nhận hoãn lớp" });
  await expect(postponeButton).toBeDisabled();
  await page.getByRole("checkbox").check();
  await postponeButton.click();
  await expect(page.getByLabel("Ngày học lại", { exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel("Ngày học lại", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Kiểm tra lại kết quả" }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0].expected_fingerprint).toBe("a".repeat(64));
});

test("does not show a date error while the user edits a date", async ({ page }) => {
  await chooseEndDate(page);
  const start = page.getByLabel("Ngày bắt đầu nghỉ", { exact: true });
  await start.click(); await start.press("ControlOrMeta+A"); await start.press("Backspace");
  await start.fill("1/");
  await expect(page.locator("#makeup-range-error")).toHaveCount(0);
  await page.getByLabel("Ngày bắt đầu nghỉ").blur();
  await expect(page.locator("#makeup-range-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Xác nhận hoãn lớp" })).toBeDisabled();
});
