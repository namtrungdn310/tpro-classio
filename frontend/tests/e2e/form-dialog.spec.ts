import { expect, test, type Page } from "@playwright/test";

/**
 * BROWSER COMPONENT HARNESS — kiểm tra FormDialogShell: Escape/backdrop đóng,
 * xác nhận khi có thay đổi chưa lưu (dirty), và quyết định "Ở lại / Rời khỏi".
 * Không đi qua route thật/API/auth (xem pattern schedule.spec.ts).
 */

const state = (page: Page) => page.evaluate(() => window.__formDialogTest.getState());

const typeValue = (page: Page, text: string) =>
  page.evaluate((next) => window.__formDialogTest.typeValue(next), text);

/** Raw coordinate click — no actionability checks, hits whatever overlay is on top. */
const clickBackdrop = (page: Page) => page.mouse.click(5, 5);

const expectOpen = (page: Page, open: boolean) =>
  expect
    .poll(async () => (await state(page)).open, { timeout: 3000 })
    .toBe(open);

const expectConfirm = (page: Page, visible: boolean) =>
  expect
    .poll(async () => (await state(page)).confirmVisible, { timeout: 3000 })
    .toBe(visible);

test.beforeEach(async ({ page }) => {
  await page.goto("/form-dialog.html");
  await expect(page.locator('input[id="h-name"]')).toBeVisible();
});

test("clean dialog closes on Escape without confirmation", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expectOpen(page, false);
});

test("clean dialog closes on backdrop click without confirmation", async ({ page }) => {
  await clickBackdrop(page);
  await expectOpen(page, false);
});

test("dirty dialog asks before discarding and stays on cancel", async ({ page }) => {
  await typeValue(page, "Mai");
  await page.keyboard.press("Escape");
  await expectConfirm(page, true);
  await expectOpen(page, true);

  await page.getByRole("button", { name: "Ở lại" }).click();
  await expectConfirm(page, false);
  await expectOpen(page, true);
});

test("a second Escape closes the confirmation without discarding", async ({ page }) => {
  await typeValue(page, "Mai");
  await page.keyboard.press("Escape");
  await expectConfirm(page, true);
  await page.keyboard.press("Escape");
  await expectConfirm(page, false);
  await expectOpen(page, true);
});

test("dirty dialog discards changes when confirmed", async ({ page }) => {
  await typeValue(page, "Mai");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Rời khỏi" }).click();
  await expectOpen(page, false);
});

test("backdrop click on a dirty dialog asks first, then a backdrop click cancels", async ({ page }) => {
  await typeValue(page, "Mai");
  await clickBackdrop(page);
  await expectConfirm(page, true);
  await expectOpen(page, true);

  await clickBackdrop(page);
  await expectConfirm(page, false);
  await expectOpen(page, true);
});

test("dirty state is cleared when the value returns to the original", async ({ page }) => {
  await typeValue(page, "Mai");
  await page.keyboard.press("Escape");
  await expectConfirm(page, true);
  await page.getByRole("button", { name: "Ở lại" }).click();
  await typeValue(page, "");
  await expect
    .poll(async () => (await state(page)).dirty, { timeout: 3000 })
    .toBe(false);
  await page.keyboard.press("Escape");
  await expectOpen(page, false);
});
