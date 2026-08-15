import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * BROWSER COMPONENT HARNESS — form lớp học (khu vực Học phí / Theo gói):
 * vị trí thật của "Tổng số tuần", aria-describedby trên input thời lượng gói,
 * lỗi thay thế helper, bố cục mobile và hành vi caret khi nhấn Tab sau khi
 * nhập học phí dạng rút gọn (1.5m). R6-D01: không còn input "Số gói"
 * (#class-package-count) — thời lượng mỗi gói + số gói để hỗ trợ tính nhanh
 * ngày kết thúc.
 * Không đi qua route thật/API/auth.
 */

const SPLIT_INPUT = (page: Page) => page.locator("#class-duration-weeks");

async function openCourseMode(page: Page) {
  await page.getByRole("button", { name: "Theo gói" }).click();
  await expect(page.locator("#class-duration-weeks")).toBeVisible();
}

const boxes = (page: Page, target: string | Locator) =>
  (typeof target === "string" ? page.locator(target) : target).boundingBox();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/class-form-billing.html");
  await expect(
    page.getByRole("heading", { name: "Thêm lớp học" }),
  ).toBeVisible();
});

test("total weeks helper sits under the split field inside the left column", async ({ page }) => {
  await openCourseMode(page);

  const split = await boxes(page, SPLIT_INPUT(page));
  const helper = await boxes(page, "#class-total-weeks");
  const endDate = await boxes(page, "#class-end-date");
  expect(split).not.toBeNull();
  expect(helper).not.toBeNull();
  expect(endDate).not.toBeNull();

  expect(Math.abs(helper!.x - split!.x)).toBeLessThanOrEqual(1.5);
  expect(helper!.y).toBeGreaterThan(split!.y + split!.height - 1);
  expect(helper!.x + helper!.width).toBeLessThanOrEqual(endDate!.x + 1);

  await expect(page.locator("#class-total-weeks")).toHaveText("Tổng số tuần: —");

  await page.locator("#class-duration-weeks").fill("3");
  await expect(page.locator("#class-total-weeks")).toHaveText("Tổng số tuần: —");

  const helperAfter = await boxes(page, "#class-total-weeks");
  expect(Math.abs(helperAfter!.x - split!.x)).toBeLessThanOrEqual(1.5);
  expect(helperAfter!.y).toBeGreaterThan(split!.y + split!.height - 1);
});

test("the weeks input announces the helper via aria-describedby", async ({ page }) => {
  await openCourseMode(page);
  await expect(page.locator("#class-duration-weeks")).toHaveAttribute(
    "aria-describedby",
    "class-total-weeks",
  );
  await expect(page.locator("#class-package-count")).toBeVisible();
});

test("invalid package config replaces the helper with the error in place", async ({ page }) => {
  await openCourseMode(page);
  await page.locator("#class-duration-weeks").fill("0");
  await page.locator("#class-fee").focus();

  await expect(page.locator("#class-billing-cycle-error")).toBeVisible();
  await expect(page.locator("#class-total-weeks")).toHaveCount(0);
  await expect(page.locator("#class-duration-weeks")).toHaveAttribute(
    "aria-describedby",
    "class-billing-cycle-error",
  );

  const split = await boxes(page, SPLIT_INPUT(page));
  const error = await boxes(page, "#class-billing-cycle-error");
  expect(Math.abs(error!.x - split!.x)).toBeLessThanOrEqual(1.5);
  expect(error!.y).toBeGreaterThan(split!.y + split!.height - 1);
});

test("mobile single column keeps the helper directly under the split field", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await page.goto("/class-form-billing.html");
  await openCourseMode(page);

  const split = await boxes(page, SPLIT_INPUT(page));
  const helper = await boxes(page, "#class-total-weeks");
  const endDate = await boxes(page, "#class-end-date");
  expect(split).not.toBeNull();
  expect(helper).not.toBeNull();
  expect(endDate).not.toBeNull();

  expect(Math.abs(helper!.x - split!.x)).toBeLessThanOrEqual(1.5);
  expect(helper!.y).toBeGreaterThan(split!.y + split!.height - 1);
  expect(helper!.y + helper!.height).toBeLessThanOrEqual(endDate!.y + 1);
});

test("Tab after a shorthand fee collapses the caret and never selects all", async ({ page }) => {
  await openCourseMode(page);
  await page.locator("#class-duration-weeks").fill("12");

  const fee = page.locator("#class-fee");
  await fee.click();
  await fee.fill("1.5m");
  await page.keyboard.press("Tab");

  await expect(page.locator("#class-fee")).toHaveValue("1.500.000");

  const state = await page.evaluate(() => {
    const element = document.activeElement as HTMLInputElement | null;
    return {
      id: element?.id ?? null,
      value: element?.value ?? "",
      start: element?.selectionStart ?? -1,
      end: element?.selectionEnd ?? -1,
    };
  });
  expect(state.id).toBe("class-duration-weeks");
  expect(state.value).toBe("12");
  expect(state.start).toBe(state.end);
  expect(state.start).toBe(2);
});
