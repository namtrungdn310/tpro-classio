import { expect, test, type Page } from "@playwright/test";

/** Browser component harness for the current open-ended class form. */
async function openCourseMode(page: Page) {
  await page.getByRole("button", { name: "Theo gói" }).click();
  await expect(page.locator("#class-duration-weeks")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/class-form-billing.html");
  await expect(page.getByRole("heading", { name: "Thêm lớp học" })).toBeVisible();
});

test("class dates are manual and an open-ended class has no end-date control", async ({ page }) => {
  const startDate = page.locator("#class-start-date");
  await expect(startDate).toHaveAttribute("type", "text");
  await expect(startDate).toHaveAttribute("inputmode", "numeric");
  await expect(startDate).toHaveAttribute("maxlength", "10");
  await expect(page.locator("#class-end-date")).toHaveCount(0);

  // Wait for the form's mount/reset cycle before simulating fast input. This
  // mirrors the point at which the dialog becomes interactive for a user.
  await expect(startDate).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);

  await startDate.press("Control+A");
  await startDate.pressSequentially("01092026");
  await expect(startDate).toHaveValue("01/09/2026");

  await startDate.press("End");
  for (let index = 0; index < 8; index += 1) {
    await startDate.press("Backspace");
  }
  await expect(startDate).toHaveValue("");
});

test("course billing asks only for the duration of each package", async ({ page }) => {
  await openCourseMode(page);
  await expect(page.locator("#class-duration-weeks")).toBeVisible();
  await expect(page.locator("#class-package-count")).toHaveCount(0);
  await expect(page.locator("#class-total-weeks")).toHaveCount(0);
});

test("Tab after a shorthand fee collapses the next field caret", async ({ page }) => {
  await openCourseMode(page);

  const fee = page.locator("#class-fee");
  await fee.click();
  await fee.fill("1.5m");
  await page.keyboard.press("Tab");

  await expect(fee).toHaveValue("1.500.000");
  const state = await page.evaluate(() => {
    const element = document.activeElement as HTMLInputElement | null;
    return {
      id: element?.id ?? null,
      start: element?.selectionStart ?? -1,
      end: element?.selectionEnd ?? -1,
    };
  });
  expect(state.id).toBe("class-duration-weeks");
  expect(state.start).toBe(state.end);
});
