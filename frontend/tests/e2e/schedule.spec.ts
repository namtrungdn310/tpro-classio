import { expect, test, type Page } from "@playwright/test";

/**
 * BROWSER COMPONENT HARNESS — test pointer geometry/lane/assignment trên
 * component ScheduleGridSlide (KHÔNG phải production-path E2E: không qua
 * route thật/API/auth/query layer; xem tests/e2e/schedule.production.spec.ts).
 */

type Occ = {
  day: "Thứ 2";
  start: string;
  end: string;
  classId: string;
  className: string;
  classCategory?: "SPECIALIZED";
  gradeLevel?: number;
  busyTeacherIds?: string[];
  busyAssistantIds?: string[];
};

const occupiedBlock = (
  start: string,
  end: string,
  role: "TEACHER" | "ASSISTANT",
  staffIds: string[],
  name = "Lớp bận",
  id = "x1",
): Occ => ({
  day: "Thứ 2",
  start,
  end,
  classId: id,
  className: name,
  classCategory: "SPECIALIZED",
  gradeLevel: 6,
  busyTeacherIds: role === "TEACHER" ? staffIds : [],
  busyAssistantIds: role === "ASSISTANT" ? staffIds : [],
});

const cellRect = (page: Page, day: number, time: number) =>
  page.evaluate(
    ([d, t]) => {
      const el = document.querySelector(
        `[data-day-index="${d}"][data-time-index="${t}"]`,
      ) as HTMLElement;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },
    [day, time] as const,
  );

const drag = async (page: Page, from: [number, number], to: [number, number]) => {
  const a = await cellRect(page, from[0], from[1]);
  const b = await cellRect(page, to[0], to[1]);
  await page.mouse.move(a.x + a.w / 2, a.y + a.h / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.w / 2, b.y + b.h / 2, { steps: 8 });
  await page.mouse.up();
};

const state = (page: Page) => page.evaluate(() => window.__scheduleTest.getState());

const setOccupied = (page: Page, blocks: Occ[]) =>
  page.evaluate((next) => window.__scheduleTest.setOccupied(next), blocks);

const setAvailabilityError = (page: Page, message: string | null) =>
  page.evaluate(
    (next) => window.__scheduleTest.setAvailabilityError(next),
    message,
  );

const selectTeacher = (page: Page, name: string) =>
  page.evaluate((next) => window.__scheduleTest.selectTeacher(next), name);

const clickConfirm = (page: Page) =>
  page.evaluate(() => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => /áp dụng lịch|xác nhận/i.test(b.textContent ?? ""),
    );
    if (btn) btn.click();
    return Boolean(btn);
  });

const blockLabels = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "div[aria-label*='đến'], div[role='img']",
      ),
    ].map((el) => el.getAttribute("aria-label") ?? ""),
  );

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-schedule-grid='true']");
  await page.waitForTimeout(400);
});

test("multi-teacher default is the overview scope where painting is blocked", async ({
  page,
}) => {
  let s = await state(page);
  expect(s.activeTeacher).toBe("overview");
  await drag(page, [0, 6], [0, 8]);
  s = await state(page);
  expect(s.pressed).toEqual([]);
  await expect(page.locator("[role='status']")).toContainText(
    "Chọn một giáo viên để bắt đầu tô lịch",
  );
});

test("drag of exactly two 30-minute cells commits a 60-minute payload for the chosen teacher", async ({
  page,
}) => {
  await selectTeacher(page, "Cô Hạnh");
  let s = await state(page);
  expect(s.activeTeacher).toBe("t1");
  await drag(page, [0, 6], [0, 8]);
  s = await state(page);
  expect(s.pressed).toEqual(["0:6", "0:7"]);
  expect(s.detail).toContain("Thứ 2 10:00–11:00");
  expect(await clickConfirm(page)).toBe(true);
  s = await state(page);
  expect(s.saved?.slots?.[0]).toMatchObject({
    day: "Thứ 2",
    start: "10:00",
    end: "11:00",
    teacher_ids: ["t1"],
    assistant_ids: ["a1"],
  });
});

test("two adjacent clicks create 60 minutes without committing a 30-minute orphan", async ({
  page,
}) => {
  await selectTeacher(page, "Cô Hạnh");
  const first = await cellRect(page, 0, 6);
  const second = await cellRect(page, 0, 7);
  await page.mouse.click(first.x + first.w / 2, first.y + first.h / 2);

  let s = await state(page);
  expect(s.pressed).toEqual([]);
  expect(s.detail).toContain("Chưa chọn khung giờ nào");
  expect(s.confirmDisabled).not.toBeNull();
  await expect(page.locator("[data-click-anchor='true']")).toHaveCount(1);

  await page.mouse.click(second.x + second.w / 2, second.y + second.h / 2);
  s = await state(page);
  expect(s.pressed).toEqual(["0:6", "0:7"]);
  expect(s.detail).toContain("Thứ 2 10:00–11:00");
  expect(s.confirmDisabled).toBeNull();
  await expect(page.locator("[data-click-anchor='true']")).toHaveCount(0);
});

test("the chosen teacher's busy block locks only her scope; the free teacher paints it", async ({
  page,
}) => {
  await setOccupied(page, [occupiedBlock("10:00", "11:00", "TEACHER", ["t1"])]);
  await page.waitForTimeout(300);

  await selectTeacher(page, "Cô Hạnh");
  let s = await state(page);
  expect(s.activeTeacher).toBe("t1");
  const busyCell = page.locator(
    "button[data-schedule-day='Thứ 2'][data-schedule-time='10:00']",
  );
  await expect(busyCell).toHaveAttribute("data-schedule-state", "busy");
  await expect(busyCell).toHaveAttribute("aria-disabled", "true");
  await expect(busyCell).toHaveAttribute("title", /Cô Hạnh.*đã bận lớp/);
  await drag(page, [0, 6], [0, 8]);
  s = await state(page);
  expect(s.pressed).toEqual([], "Hạnh cannot paint her busy slot");

  await selectTeacher(page, "Thầy Phúc");
  const freeCell = page.locator(
    "button[data-schedule-day='Thứ 2'][data-schedule-time='10:00']",
  );
  await expect(freeCell).toHaveAttribute("data-schedule-state", "free");
  await expect(freeCell).not.toHaveAttribute("aria-disabled", "true");
  await drag(page, [0, 6], [0, 8]);
  s = await state(page);
  expect(s.pressed).toEqual(["0:6", "0:7"]);
  await expect(clickConfirm(page)).resolves.toBe(true);
  const saved = await state(page);
  expect(saved.saved?.slots?.[0]?.teacher_ids).toEqual(["t2"]);
});

test("a legacy conflict without staff ids fails closed for every teacher", async ({
  page,
}) => {
  await setOccupied(page, [
    {
      day: "Thứ 2",
      start: "10:00",
      end: "11:00",
      classId: "legacy",
      className: "Lớp cũ",
    },
  ]);
  await page.waitForTimeout(300);
  await selectTeacher(page, "Cô Hạnh");
  const cell = page.locator(
    "button[data-schedule-day='Thứ 2'][data-schedule-time='10:00']",
  );
  await expect(cell).toHaveAttribute("title", /Không xác định được lịch giáo viên/);
  await drag(page, [0, 6], [0, 8]);
  const s = await state(page);
  expect(s.pressed).toEqual([]);
});

test("no free teacher across the whole interval blocks painting", async ({
  page,
}) => {
  await setOccupied(page, [
    occupiedBlock("10:00", "10:30", "TEACHER", ["t1"]),
    occupiedBlock("10:30", "11:00", "TEACHER", ["t2"]),
  ]);
  await page.waitForTimeout(300);
  await selectTeacher(page, "Cô Hạnh");
  await drag(page, [0, 6], [0, 8]);
  const s = await state(page);
  expect(s.pressed).toEqual([]);
});

test("busy assistant neither blocks the slot nor is assigned", async ({
  page,
}) => {
  await setOccupied(page, [occupiedBlock("10:00", "11:00", "ASSISTANT", ["a1"])]);
  await page.waitForTimeout(300);
  await selectTeacher(page, "Cô Hạnh");
  await drag(page, [0, 6], [0, 8]);
  const s = await state(page);
  expect(s.pressed.length).toBe(2);
  await clickConfirm(page);
  const after = await state(page);
  expect(after.saved?.slots?.[0]?.assistant_ids).toEqual([]);
});

test("dual-role same session: ONE canonical block carrying the busy teacher label", async ({
  page,
}) => {
  await setOccupied(page, [
    {
      day: "Thứ 2",
      start: "10:00",
      end: "11:00",
      classId: "x9",
      className: "Lớp 6A1",
      classCategory: "SPECIALIZED",
      gradeLevel: 6,
      busyTeacherIds: ["t1"],
      busyAssistantIds: ["a1"],
    },
  ]);
  await page.waitForTimeout(300);
  await selectTeacher(page, "Cô Hạnh");
  const labels = await blockLabels(page);
  const canonical = labels.filter((label) => label.includes("Lớp 6A1"));
  expect(canonical.length).toBe(1);
  expect(canonical[0]).toContain("10:00 đến 11:00");
  expect(canonical[0]).toContain("Cô Hạnh đang bận");
});

test("lane chain A-B-C renders all three blocks with no overflow badge in overview", async ({
  page,
}) => {
  await setOccupied(page, [
    occupiedBlock("10:00", "12:00", "TEACHER", ["t1"], "Lớp A", "a"),
    occupiedBlock("11:00", "13:00", "TEACHER", ["t1"], "Lớp B", "b"),
    occupiedBlock("12:00", "14:00", "TEACHER", ["t1"], "Lớp C", "c"),
  ]);
  await page.waitForTimeout(300);
  const labels = await blockLabels(page);
  expect(labels.filter((l) => /Lớp [ABC]/.test(l)).length).toBe(3);
  const body = await page.evaluate(() => document.body.textContent ?? "");
  expect(body).not.toContain("+1 lớp bận");
});

test("Escape during drag cancels the preview, keeps the panel open and clears selection", async ({
  page,
}) => {
  await selectTeacher(page, "Cô Hạnh");
  const a = await cellRect(page, 0, 6);
  const b = await cellRect(page, 0, 8);
  await page.mouse.move(a.x + a.w / 2, a.y + a.h / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.w / 2, b.y + b.h / 2, { steps: 8 });
  const during = await state(page);
  expect(during.pressed.length).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  const after = await state(page);
  expect(after.pressed).toEqual([]);
  expect(await page.locator("[data-schedule-grid='true']").count()).toBe(1);
});

test("real availability error shows alert, disables confirm and painting; retry clears it", async ({
  page,
}) => {
  await setAvailabilityError(page, "Không thể tải lịch bận");
  await page.waitForTimeout(300);
  let s = await state(page);
  expect(s.alertText).toContain("Không thể tải lịch bận");
  expect(s.confirmDisabled).not.toBeNull();

  await selectTeacher(page, "Cô Hạnh");
  const one = await cellRect(page, 0, 6);
  await page.mouse.click(one.x + one.w / 2, one.y + one.h / 2);
  await page.keyboard.press("Space");
  s = await state(page);
  expect(s.pressed).toEqual([]);

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => /thử lại/i.test(b.textContent ?? ""),
    );
    btn?.click();
  });
  await page.waitForTimeout(300);
  s = await state(page);
  expect(s.alertText).not.toContain("Không thể tải lịch bận");
  expect(s.confirmDisabled).toBeNull();
  expect(s.retryCount).toBeGreaterThanOrEqual(1);
});

test("pointercancel does not commit a painted session", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "firefox",
    "Firefox desktop mouse có pointer capture; pointercancel chỉ tồn tại cho touch/pen — phủ bởi jsdom unit test",
  );
  await selectTeacher(page, "Cô Hạnh");
  const a = await cellRect(page, 0, 6);
  const b = await cellRect(page, 0, 8);
  await page.mouse.move(a.x + a.w / 2, a.y + a.h / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.w / 2, b.y + b.h / 2, { steps: 8 });
  await page.evaluate(() => {
    const grid = document.querySelector("[data-schedule-grid='true']") as HTMLElement;
    grid.dispatchEvent(
      new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }),
    );
  });
  const s = await state(page);
  expect(s.pressed).toEqual([]);
});
