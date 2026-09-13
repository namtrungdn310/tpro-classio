import { expect, test } from "@playwright/test";

test.skip(!process.env.TPRO_E2E_REAL_API, "Requires isolated authenticated PostgreSQL runner");

test("real authenticated API persists deadline and audit without moving anchor", async ({ page }) => {
  const fee = process.env.TPRO_E2E_FEE!;
  const enrollment = process.env.TPRO_E2E_ENROLLMENT!;
  await page.goto(`/billing-dates.html?fee=${fee}`);
  await page.getByLabel("Lý do", { exact: true }).fill("E2E real API deadline acceptance");
  const previewResponse = page.waitForResponse(r => r.url().endsWith("/due-date/preview"));
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  expect((await previewResponse).status()).toBe(200);
  await expect(page.getByLabel("Xem trước hạn thu")).toBeVisible();
  const applyResponse = page.waitForResponse(r => r.url().endsWith("/due-date/apply"));
  await page.getByRole("button", { name: "Xác nhận hạn thu" }).click();
  expect((await applyResponse).status()).toBe(200);
  await expect(page.getByRole("status")).toHaveText("saved");
  const audit = await (await page.request.get(`/api/proxy/enrollments/${enrollment}/billing-schedule`)).json();
  expect(audit.history.some((h: { reason: string }) => h.reason === "E2E real API deadline acceptance")).toBe(true);
});

test("real committed apply survives lost response without duplicate audit", async ({ page }) => {
  const commands: unknown[] = [];
  await page.route("**/due-date/apply", async route => {
    commands.push(route.request().postDataJSON());
    // Let the REAL backend commit before simulating a lost response.
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (commands.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.goto(`/billing-dates.html?fee=${process.env.TPRO_E2E_FEE}`);
  await page.getByLabel("Lý do", { exact: true }).fill("E2E committed response lost");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận hạn thu" }).click();
  await expect(page.getByText("Chưa rõ kết quả lưu.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận hạn thu" }).click();
  await expect(page.getByRole("status")).toHaveText("saved");
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual(commands[1]);
});

test("real schedule change explicitly waives bridge and persists a new revision", async ({ page }) => {
  const loaded = page.waitForResponse(r => r.url().includes("/billing-schedule") && r.request().method() === "GET");
  await page.goto(`/billing-dates.html?inline&enrollment=${process.env.TPRO_E2E_ENROLLMENT}`);
  expect((await loaded).status()).toBe(200);
  await page.getByLabel("Mốc thu học phí", { exact: true }).click();
  await page.getByLabel("Mốc thu học phí", { exact: true }).press("ControlOrMeta+A");
  await page.getByLabel("Mốc thu học phí", { exact: true }).pressSequentially(process.env.TPRO_E2E_ANCHOR_DISPLAY!);
  await expect(page.getByLabel("Mốc thu học phí", { exact: true })).toHaveValue(process.env.TPRO_E2E_ANCHOR_DISPLAY!);
  await page.getByRole("button", { name: "Xử lý thay đổi", exact: true }).click();
  await page.getByLabel("Lý do điều chỉnh", { exact: true }).fill("E2E real explicit bridge waiver");
  const preview = page.waitForResponse(r => r.url().endsWith("/billing-schedule/preview"));
  await page.getByRole("button", { name: "Xác nhận mốc", exact: true }).click();
  const previewResponse = await preview;
  expect(previewResponse.status()).toBe(200);
  expect(previewResponse.request().postDataJSON().gap_policy).toBe("WAIVE");
  await expect(page.getByText("Miễn thu khoảng chuyển tiếp:", { exact: false })).toBeVisible();
  const applied = page.waitForResponse(r => r.url().endsWith("/billing-schedule/apply"));
  await page.getByRole("button", { name: "Lưu" }).click();
  expect((await applied).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: /^saved$/ })).toBeVisible();
  const history = await page.request.get(`/api/proxy/reports/billing/enrollments/${process.env.TPRO_E2E_ENROLLMENT}/history?year=0`);
  expect(history.status()).toBe(200);
  expect((await history.json()).items.some((h: { reason: string }) => h.reason === "E2E real explicit bridge waiver")).toBe(true);
});

test("real class date change preserves financial schedule", async ({ page }) => {
  await page.goto(`/billing-dates.html?class=${process.env.TPRO_E2E_CLASS}&start=${process.env.TPRO_E2E_CLASS_START}`);
  await page.getByLabel("Lý do", { exact: true }).fill("E2E academic class date only");
  await page.getByRole("button", { name: "Kiểm tra thay đổi", exact: true }).click();
  await expect(page.getByText("Không thay đổi khoản học phí.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^saved$/ })).toBeVisible();
});

test("real membership v4 changes admission without changing billing", async ({ page }) => {
  // API-level acceptance from the browser request client, not the student form UI.
  const student = process.env.TPRO_E2E_STUDENT!;
  const enrollment = process.env.TPRO_E2E_ENROLLMENT!;
  const base = "/api/proxy";
  const original = await page.request.get(`${base}/students/${student}`);
  expect(original.status()).toBe(200);
  const profile = await original.json();
  const before = await (await page.request.get(`${base}/enrollments/${enrollment}/billing-schedule`)).json();
  const payload = { contract_version: 4, expected_updated_at: profile.updated_at,
    mode: "supplement", targets: [], enrollment_updates: [{ enrollment_id: enrollment,
      enrollment_date: process.env.TPRO_E2E_ADMISSION, expected_admission_version: 0 }],
  };
  const preview = await page.request.post(`${base}/students/${student}/membership-command/preview`, { data: payload });
  expect(preview.status()).toBe(200);
  const impact = await preview.json();
  expect(impact.can_apply).toBe(true);
  const command = { ...payload, profile: {}, request_id: crypto.randomUUID(), expected_preview_fingerprint: impact.preview_fingerprint };
  const applied = await page.request.post(`${base}/students/${student}/membership-command`, { data: command });
  expect(applied.status()).toBe(200);
  const retry = await page.request.post(`${base}/students/${student}/membership-command`, { data: command });
  expect(retry.status()).toBe(200);
  const after = await (await page.request.get(`${base}/enrollments/${enrollment}/billing-schedule`)).json();
  expect(after.anchor_date).toBe(before.anchor_date);
  expect(after.version).toBe(before.version);
  expect(after.fees).toEqual(before.fees);
});
