import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScheduleGridSlide } from "../src/components/layout/schedule-grid-slide";
import type { ScheduleSlot } from "../src/components/layout/weekly-schedule-board";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
const { window } = dom;

Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  PointerEvent: window.PointerEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: window.navigator,
  configurable: true,
});
const resizeObserverCallbacks = new Set<ResizeObserverCallback>();
window.ResizeObserver = class ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObserverCallbacks.add(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    resizeObserverCallbacks.delete(this.callback);
  }
} as unknown as typeof window.ResizeObserver;
Object.defineProperty(globalThis, "ResizeObserver", {
  value: window.ResizeObserver,
  configurable: true,
});

window.requestAnimationFrame = (callback: FrameRequestCallback) =>
  window.setTimeout(() => callback(performance.now()), 16) as unknown as number;
window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
window.matchMedia = (() => ({
  matches: false,
  media: "",
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const captureTarget = new WeakMap<HTMLElement, number>();
window.HTMLElement.prototype.setPointerCapture = function setPointerCapture(
  this: HTMLElement,
  pointerId: number,
) {
  captureTarget.set(this, pointerId);
};
window.HTMLElement.prototype.hasPointerCapture = function hasPointerCapture(
  this: HTMLElement,
  pointerId: number,
) {
  return captureTarget.get(this) === pointerId;
};
window.HTMLElement.prototype.releasePointerCapture = function releasePointerCapture(
  this: HTMLElement,
  pointerId: number,
) {
  if (captureTarget.get(this) === pointerId) {
    captureTarget.delete(this);
  }
};

const ROW_HEIGHT = 30;
const GRID_TOP = 100.3;
const GRID_LEFT = 0.2;
const GRID_WIDTH = 780;
let layoutTopOffset = 0;
const originalGetBoundingClientRect =
  window.HTMLElement.prototype.getBoundingClientRect;
window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(
  this: HTMLElement,
) {
  const { dataset } = this;
  if (dataset.scheduleGrid === "true") {
    const top = GRID_TOP + layoutTopOffset;
    return {
      x: GRID_LEFT,
      y: top,
      left: GRID_LEFT,
      top,
      right: GRID_LEFT + GRID_WIDTH,
      bottom: top + ROW_HEIGHT * 30,
      width: GRID_WIDTH,
      height: ROW_HEIGHT * 30,
      toJSON: () => ({}),
    } as DOMRect;
  }
  if (dataset.dayIndex !== undefined && dataset.timeIndex !== undefined) {
    const dayIndex = Number(dataset.dayIndex);
    const timeIndex = Number(dataset.timeIndex);
    const left = 80.2 + dayIndex * 100;
    const top = GRID_TOP + layoutTopOffset + timeIndex * ROW_HEIGHT;
    return {
      x: left,
      y: top,
      left,
      top,
      right: left + 100,
      bottom: top + ROW_HEIGHT,
      width: 100,
      height: ROW_HEIGHT,
      toJSON: () => ({}),
    } as DOMRect;
  }
  return originalGetBoundingClientRect.call(this);
};

const rowMidY = (timeIndex: number) =>
  GRID_TOP + layoutTopOffset + timeIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
const rowTopY = (timeIndex: number) =>
  GRID_TOP + layoutTopOffset + timeIndex * ROW_HEIGHT;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderSlide(
  props: ComponentProps<typeof ScheduleGridSlide>,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ScheduleGridSlide, props));
  });
}

async function unmountSlide() {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
}

const gridElement = () => {
  const firstCell = document.querySelector<HTMLElement>(
    '[data-day-index="0"][data-time-index="0"]',
  );
  assert.ok(firstCell, "grid cell must be rendered");
  return firstCell.parentElement!.parentElement as HTMLElement;
};

const cellButton = (dayIndex: number, timeIndex: number) => {
  const cell = document.querySelector<HTMLButtonElement>(
    `[data-day-index="${dayIndex}"][data-time-index="${timeIndex}"]`,
  );
  assert.ok(cell, `cell ${dayIndex}:${timeIndex} must exist`);
  return cell;
};

const dispatchPointer = (
  type: string,
  clientY: number,
  target: HTMLElement = gridElement(),
) => {
  target.dispatchEvent(
    new window.PointerEvent(type, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      bubbles: true,
      cancelable: true,
      clientX: 130,
      clientY,
    }),
  );
};

async function pressAt(dayIndex: number, timeIndex: number) {
  await act(async () => {
    dispatchPointer("pointerdown", rowMidY(timeIndex), cellButton(dayIndex, timeIndex));
  });
}

async function moveTo(clientY: number) {
  await act(async () => {
    dispatchPointer("pointermove", clientY);
  });
}

async function releaseAt(clientY: number) {
  await act(async () => {
    dispatchPointer("pointerup", clientY);
  });
}

async function cancelGesture() {
  await act(async () => {
    dispatchPointer("pointercancel", rowMidY(0));
  });
}

async function loseCapture() {
  await act(async () => {
    dispatchPointer("lostpointercapture", rowMidY(0));
  });
}

async function pressKey(target: HTMLElement, key: string) {
  await act(async () => {
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

const pressedCells = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed='true']")]
    .map((button) => `${button.dataset.dayIndex}:${button.dataset.timeIndex}`)
    .sort((left, right) => {
      const [leftDay, leftTime] = left.split(":").map(Number);
      const [rightDay, rightTime] = right.split(":").map(Number);
      return leftDay - rightDay || leftTime - rightTime;
    });

/** Normalized "Thứ 2 10:00–11:00" labels of the committed/preview session rows. */
const detailTexts = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      "button[data-schedule-session-key] .font-body-ui",
    ),
  ]
    .map((element) =>
      (element.textContent ?? "")
        .replace(/(\d{2}:\d{2})/, " $1")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .sort();

const hasEmptyDetailMessage = () =>
  [...document.querySelectorAll<HTMLElement>("aside p")].some((element) =>
    element.textContent?.includes("Chưa chọn khung giờ nào"),
  );

const isVisualEndpointCell = (dayIndex: number, timeIndex: number) => {
  const cell = document.querySelector<HTMLButtonElement>(
    `[data-day-index="${dayIndex}"][data-time-index="${timeIndex}"]`,
  );
  return (
    cell?.classList.contains("schedule-grid-cell-endpoint") === true &&
    cell.getAttribute("data-schedule-endpoint") === "true" &&
    cell.getAttribute("aria-pressed") === "false"
  );
};

const hasLimitMessage = () =>
  [...document.querySelectorAll<HTMLElement>("[role='status']")].some((element) =>
    element.textContent?.includes("Mỗi lớp chỉ có tối đa 4 buổi mỗi tuần"),
  );

const hasOverviewHint = () =>
  [...document.querySelectorAll<HTMLElement>("[role='status']")].some((element) =>
    element.textContent?.includes("Chọn một giáo viên để bắt đầu tô lịch"),
  );

const clickAnchorCells = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button[data-click-anchor='true']")]
    .map((button) => `${button.dataset.dayIndex}:${button.dataset.timeIndex}`);

async function clickConfirm() {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => /Áp dụng lịch|Xác nhận/i.test(candidate.textContent ?? ""),
  );
  assert.ok(button, "confirm button must exist");
  await act(async () => {
    button.click();
  });
}

const confirmButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    /áp dụng lịch|xác nhận/i.test(button.textContent ?? ""),
  );

const teacherOption = (id: string, fullName: string) => ({
  id,
  full_name: fullName,
  staff_type: "TEACHER" as const,
  is_active: true,
  phone: null,
  zalo_name: null,
  email: null,
});

const T1 = teacherOption("t1", "Cô Hạnh");
const T2 = teacherOption("t2", "Thầy Phúc");
const singleTeacherProps: ComponentProps<typeof ScheduleGridSlide> = {
  isOpen: true,
  onClose: () => undefined,
  onSave: () => undefined,
  selectedTeachers: [T1],
};

async function clickTeacherTab(name: string) {
  const tab = [...document.querySelectorAll<HTMLButtonElement>("button[role='tab']")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  assert.ok(tab, `tab "${name}" must exist`);
  await act(async () => {
    tab.click();
  });
}

const teacherTabSelected = (name: string) => {
  const tab = [...document.querySelectorAll<HTMLButtonElement>("button[role='tab']")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  return tab?.getAttribute("aria-selected") === "true";
};

const panelMode = () =>
  document.querySelector<HTMLElement>("[data-schedule-panel-mode]")?.getAttribute(
    "data-schedule-panel-mode",
  );

async function openSessionRow(day: string, start: string, end: string) {
  const row = document.querySelector<HTMLButtonElement>(
    `button[data-schedule-session-key="${day}|${start}|${end}"]`,
  );
  assert.ok(row, `session row ${day}|${start}|${end} must exist`);
  await act(async () => {
    row.click();
  });
}

const detailTeacherButton = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-schedule-panel-teacher="${id}"]`);

const occupiedBlockElements = () =>
  [...document.querySelectorAll<HTMLElement>(
    "div[class*='pointer-events-none'][class*='absolute'][class*='z-20']",
  )];

const ownSessionOverlayElements = () =>
  [...document.querySelectorAll<HTMLElement>(
    "[class*='absolute'][class*='z-30']",
  )];

const cellState = (dayIndex: number, timeIndex: number) =>
  cellButton(dayIndex, timeIndex).getAttribute("data-schedule-state");

test.beforeEach(async () => {
  layoutTopOffset = 0;
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined });
});

test.afterEach(async () => {
  await unmountSlide();
});

// ---------------------------------------------------------------------------
// Pointer / keyboard lifecycle (single teacher = auto-selected teacher scope)
// ---------------------------------------------------------------------------

test("two adjacent pointer clicks create a valid 60-minute session without a 30-minute commit", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await releaseAt(rowMidY(6));

  assert.deepEqual(pressedCells(), []);
  assert.deepEqual(clickAnchorCells(), ["0:6"]);
  assert.equal(hasEmptyDetailMessage(), true);
  assert.deepEqual(detailTexts(), []);
  assert.equal(isVisualEndpointCell(0, 6), false, "no endpoint cell fill after release when no commit");
  assert.notEqual(confirmButton()?.getAttribute("disabled"), null);

  await pressAt(0, 7);
  await releaseAt(rowMidY(7));
  assert.deepEqual(clickAnchorCells(), []);
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–11:00"]);

  const saved: Array<{ text: string; slots: ScheduleSlot[] } | null> = [];
  const onSave = (value: { text: string; slots: ScheduleSlot[] } | null) => {
    saved.push(value);
  };
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, onSave });
  await pressAt(0, 6);
  await releaseAt(rowMidY(6));
  await pressAt(0, 7);
  await releaseAt(rowMidY(7));
  await clickConfirm();

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0]?.slots.map(({ day, start, end }) => ({ day, start, end })), [
    { day: "Thứ 2", start: "10:00", end: "11:00" },
  ]);
});

test("pointer clicks extend beyond and shrink from the visible endpoint", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await releaseAt(rowMidY(6));
  await pressAt(0, 7);
  await releaseAt(rowMidY(7));
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);

  await pressAt(0, 6);
  await releaseAt(rowMidY(6));
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7"],
    "a 60-minute session cannot be shortened",
  );

  await pressAt(0, 9);
  await releaseAt(rowMidY(9));
  assert.deepEqual(pressedCells(), ["0:6", "0:7", "0:8"]);

  await pressAt(0, 9);
  await releaseAt(rowMidY(9));
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7"],
    "clicking the filled endpoint removes the last 30-minute data block",
  );

  await pressAt(0, 9);
  await releaseAt(rowMidY(9));
  assert.deepEqual(pressedCells(), ["0:6", "0:7", "0:8"]);

  await pressAt(0, 6);
  await releaseAt(rowMidY(6));
  assert.deepEqual(
    pressedCells(),
    ["0:7", "0:8"],
    "clicking an outer edge removes exactly one 30-minute cell",
  );

  await pressAt(0, 7);
  await releaseAt(rowMidY(7));
  assert.deepEqual(
    pressedCells(),
    ["0:7", "0:8"],
    "the remaining 60-minute session is protected",
  );
});

test("dragging upward from the filled endpoint erases from that endpoint", async () => {
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    currentValue: {
      text: "Thứ 4 (09:00-12:30)",
      slots: [{ day: "Thứ 4", start: "09:00", end: "12:30" }],
    },
  });

  assert.equal(isVisualEndpointCell(2, 11), true);
  await pressAt(2, 11);
  await moveTo(rowTopY(10) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 09:00–12:00"]);
  assert.equal(isVisualEndpointCell(2, 10), true);

  await releaseAt(rowTopY(10) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 09:00–12:00"]);
  assert.deepEqual(
    pressedCells(),
    ["2:4", "2:5", "2:6", "2:7", "2:8", "2:9"],
  );
  assert.equal(isVisualEndpointCell(2, 10), true);
});

test("after a click shrink, the moved endpoint can immediately be dragged downward", async () => {
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    currentValue: {
      text: "Thứ 4 (09:00-12:30)",
      slots: [{ day: "Thứ 4", start: "09:00", end: "12:30" }],
    },
  });

  await pressAt(2, 11);
  await releaseAt(rowMidY(11));
  assert.deepEqual(detailTexts(), ["Thứ 4 09:00–12:00"]);
  assert.equal(isVisualEndpointCell(2, 10), true);

  await pressAt(2, 10);
  await moveTo(rowTopY(11) + 0.5);
  assert.deepEqual(
    detailTexts(),
    ["Thứ 4 09:00–12:30"],
    "the endpoint switches to painting as soon as the pointer moves downward",
  );
  await releaseAt(rowTopY(11) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 09:00–12:30"]);
  assert.equal(isVisualEndpointCell(2, 11), true);
});

test("a session keeps its visual endpoint filled without committing a phantom block", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await moveTo(rowTopY(7) + 0.5);
  assert.deepEqual(pressedCells(), ["0:6"], "one data block activated");
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–10:30"]);
  assert.equal(isVisualEndpointCell(0, 7), true, "exclusive endpoint is visibly previewed");

  await moveTo(rowTopY(8) + 0.5);
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–11:00"]);
  assert.equal(isVisualEndpointCell(0, 8), true, "next exclusive endpoint follows the pointer");

  await releaseAt(rowTopY(8) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–11:00"]);
  assert.equal(
    isVisualEndpointCell(0, 8),
    true,
    "the endpoint fill persists after commit without becoming a data block",
  );
});

test("an 08:00-16:00 drag keeps the 15:30-16:00 cell visibly selected after release", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(1, 2);
  await moveTo(rowTopY(18) + 0.5);

  assert.equal(isVisualEndpointCell(1, 18), true, "16:00 receives endpoint feedback while dragging");
  assert.equal(cellButton(1, 17).getAttribute("aria-pressed"), "true");

  await releaseAt(rowTopY(18) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 3 08:00–16:00"]);
  assert.equal(cellButton(1, 17).getAttribute("aria-pressed"), "true");
  assert.match(
    cellButton(1, 17).className,
    /schedule-grid-cell-selected/,
    "the final real 30-minute cell keeps the committed fill",
  );
  assert.equal(cellButton(1, 18).getAttribute("aria-pressed"), "false");
  assert.equal(isVisualEndpointCell(1, 18), true);
});

test("a 09:00-12:30 drag keeps the 12:30 endpoint filled without saving until 13:00", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(2, 4);
  await moveTo(rowTopY(11) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 09:00–12:30"]);
  assert.equal(isVisualEndpointCell(2, 11), true);
  assert.equal(cellButton(2, 11).getAttribute("aria-pressed"), "false");

  await releaseAt(rowTopY(11) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 09:00–12:30"]);
  assert.deepEqual(
    pressedCells(),
    ["2:4", "2:5", "2:6", "2:7", "2:8", "2:9", "2:10"],
  );
  assert.equal(isVisualEndpointCell(2, 11), true);
  assert.equal(cellButton(2, 11).getAttribute("aria-pressed"), "false");
});

test("keyboard activation follows the same pending, extend and minimum-duration rules", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  const first = cellButton(0, 6);
  const second = cellButton(0, 7);
  const third = cellButton(0, 8);
  const fourth = cellButton(0, 9);
  await pressKey(first, "Enter");
  assert.deepEqual(pressedCells(), []);
  assert.deepEqual(clickAnchorCells(), ["0:6"]);

  await pressKey(second, "Enter");
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–11:00"]);

  await pressKey(first, "Enter");
  assert.deepEqual(pressedCells(), ["0:6", "0:7"], "cannot shrink below 60 minutes");

  await pressKey(third, "Enter");
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7"],
    "the visible endpoint cannot shrink a 60-minute session",
  );
  await pressKey(fourth, "Enter");
  assert.deepEqual(pressedCells(), ["0:6", "0:7", "0:8"]);
  await pressKey(first, "Enter");
  assert.deepEqual(pressedCells(), ["0:7", "0:8"], "edge click shrinks one block");
});

test("touching the 12:00 boundary updates the preview and detail list immediately", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  assert.deepEqual(pressedCells(), [], "the anchor alone is not a valid session");

  await moveTo(rowTopY(10));

  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9"],
    "the moment the pointer touches the 12:00 boundary the interval ends there",
  );
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:00"]);
  assert.equal(isVisualEndpointCell(0, 10), true, "the exclusive endpoint is visibly previewed");

  await releaseAt(rowTopY(10));
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:00"]);
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9"],
    "no extra block is added when releasing at the boundary",
  );
  assert.equal(
    isVisualEndpointCell(0, 10),
    true,
    "the committed visual endpoint remains filled but is not aria-pressed",
  );
});

test("entering any part of the 12:00 row resolves 12:00 without waiting for its bottom edge", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  for (const offsetWithinRow of [0.5, ROW_HEIGHT * 0.25, ROW_HEIGHT / 2, ROW_HEIGHT - 0.5]) {
    await pressAt(0, 6);
    await moveTo(rowTopY(10) + offsetWithinRow);

    assert.deepEqual(
      pressedCells(),
      ["0:6", "0:7", "0:8", "0:9"],
      `offset ${offsetWithinRow}px inside the endpoint row must resolve immediately`,
    );
    assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:00"]);
    assert.equal(isVisualEndpointCell(0, 10), true);

    await releaseAt(rowTopY(10) + offsetWithinRow);
    await unmountSlide();
    await renderSlide(singleTeacherProps);
  }
});

test("dragging down to 12:30 and reversing to 12:00 commits exactly 10:00-12:00", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await moveTo(rowTopY(11));
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:30"]);

  await moveTo(rowTopY(10));
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:00"]);

  await releaseAt(rowTopY(10));
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:00"]);
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9"],
    "reversing never leaves a spare 30-minute block",
  );
});

test("the reported 09:00 to 13:00 to 12:30 reversal commits exactly 09:00-12:30", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(1, 4);
  await moveTo(rowTopY(12) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 3 09:00–13:00"]);

  await moveTo(rowTopY(11) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 3 09:00–12:30"]);

  await releaseAt(rowTopY(11) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 3 09:00–12:30"]);
  assert.deepEqual(
    pressedCells(),
    ["1:4", "1:5", "1:6", "1:7", "1:8", "1:9", "1:10"],
  );
});

test("a layout shift during a gesture invalidates geometry before the next sample", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);

  layoutTopOffset = 31;
  await act(async () => {
    resizeObserverCallbacks.forEach((callback) => {
      callback([], {} as ResizeObserver);
    });
  });
  await moveTo(rowTopY(10) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:00"]);
  assert.deepEqual(pressedCells(), ["0:6", "0:7", "0:8", "0:9"]);
  await releaseAt(rowTopY(10) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:00"]);
});

test("pointerup coordinates commit even without a final pointermove", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await releaseAt(rowTopY(10));

  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:00"]);
  assert.deepEqual(pressedCells(), ["0:6", "0:7", "0:8", "0:9"]);
});

test("pointercancel discards the preview and leaves the committed state untouched", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(pressedCells(), ["0:6", "0:7", "0:8", "0:9"]);

  await cancelGesture();

  assert.deepEqual(pressedCells(), []);
  assert.equal(hasEmptyDetailMessage(), true);
  assert.equal(isVisualEndpointCell(0, 10), false, "endpoint cell reverts after cancel");
});

test("lostpointercapture discards the preview and prevents a later commit", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await moveTo(rowTopY(10));

  await loseCapture();
  await releaseAt(rowTopY(10));

  assert.deepEqual(pressedCells(), []);
  assert.equal(hasEmptyDetailMessage(), true);
});

test("returning to the anchor after moving cancels the gesture preview", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  await moveTo(rowTopY(6));
  assert.deepEqual(pressedCells(), [], "back at the anchor the preview disappears");
  assert.equal(
    gridElement().getAttribute("data-schedule-dragging"),
    "true",
    "visual transitions stay disabled until the pointer gesture actually ends",
  );

  await releaseAt(rowTopY(6));
  assert.deepEqual(pressedCells(), []);
  assert.equal(hasEmptyDetailMessage(), true);
  assert.equal(gridElement().hasAttribute("data-schedule-dragging"), false);
});

test("erasing a committed region removes it on release", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-12:00)",
    slots: [{ day: "Thứ 2" as const, start: "10:00", end: "12:00" }],
  };
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, currentValue });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(pressedCells(), [], "erasing ungreys the interval while held");

  await releaseAt(rowTopY(10));
  assert.deepEqual(pressedCells(), []);
  assert.equal(hasEmptyDetailMessage(), true);
});

test("erasing an old overlapping region is not blocked by occupied slots", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-12:00)",
    slots: [{ day: "Thứ 2" as const, start: "10:00", end: "12:00" }],
  };
  const occupiedSlots = [
    {
      day: "Thứ 2" as const,
      start: "11:00",
      end: "11:30",
      className: "Lớp khác",
      classCategory: null,
      gradeLevel: null,
    },
  ];
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    currentValue,
    occupiedSlots,
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(pressedCells(), [], "erase traverses the conflicting old block");

  await releaseAt(rowTopY(10));
  assert.equal(hasEmptyDetailMessage(), true);
});

test("a paint gesture stops at the first fully-booked block", async () => {
  const occupiedSlots = [
    {
      day: "Thứ 2" as const,
      start: "11:00",
      end: "11:30",
      className: "Lớp tiếng Anh",
      classCategory: null,
      gradeLevel: null,
    },
  ];
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    occupiedSlots,
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7"],
    "the interval stops before the blocked block",
  );
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–11:00"]);

  await releaseAt(rowTopY(10));
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–11:00"]);
  assert.equal(cellButton(0, 8).getAttribute("aria-disabled"), "true");
});

test("an upward paint gesture stops at the first occupied block encountered", async () => {
  const occupiedSlots = [
    {
      day: "Thứ 2" as const,
      start: "11:00",
      end: "11:30",
      className: "Lớp tiếng Anh",
      classCategory: null,
      gradeLevel: null,
    },
  ];
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    occupiedSlots,
  });

  await pressAt(0, 10);
  await moveTo(rowTopY(6));

  assert.deepEqual(pressedCells(), ["0:9"]);
  assert.deepEqual(detailTexts(), ["Thứ 2 11:30–12:00"]);
});

test("pointerdown on a fully-booked cell starts no gesture", async () => {
  const occupiedSlots = [
    {
      day: "Thứ 2" as const,
      start: "11:00",
      end: "11:30",
      className: "Lớp tiếng Anh",
      classCategory: null,
      gradeLevel: null,
    },
  ];
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    occupiedSlots,
  });

  await pressAt(0, 8);
  await moveTo(rowTopY(10));
  await releaseAt(rowTopY(10));

  assert.deepEqual(pressedCells(), []);
  assert.equal(isVisualEndpointCell(0, 10), false);
  assert.equal(hasEmptyDetailMessage(), true);
});

test("a gesture that would exceed four weekly slots is never committed", async () => {
  const currentValue = {
    text: "Thứ 2 (07:00-07:30); Thứ 3 (07:00-07:30); Thứ 4 (07:00-07:30); Thứ 5 (07:00-07:30)",
    slots: [
      { day: "Thứ 2" as const, start: "07:00", end: "07:30" },
      { day: "Thứ 3" as const, start: "07:00", end: "07:30" },
      { day: "Thứ 4" as const, start: "07:00", end: "07:30" },
      { day: "Thứ 5" as const, start: "07:00", end: "07:30" },
    ],
  };
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, currentValue });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.equal(hasLimitMessage(), true, "the limit message appears during the preview");

  await releaseAt(rowTopY(10));
  assert.equal(hasLimitMessage(), true, "the rejected gesture keeps the message");
  assert.equal(detailTexts().length, 4, "the committed slots stay unchanged");
});

test("when class already has 4 slots, the limit message remains visible steadily", async () => {
  const currentValue = {
    text: "Thứ 2 (07:00-07:30); Thứ 3 (07:00-07:30); Thứ 4 (07:00-07:30); Thứ 5 (07:00-07:30)",
    slots: [
      { day: "Thứ 2" as const, start: "07:00", end: "07:30" },
      { day: "Thứ 3" as const, start: "07:00", end: "07:30" },
      { day: "Thứ 4" as const, start: "07:00", end: "07:30" },
      { day: "Thứ 5" as const, start: "07:00", end: "07:30" },
    ],
  };
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, currentValue });

  assert.equal(hasLimitMessage(), true, "limit message is visible when 4 slots exist");
  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.equal(hasLimitMessage(), true);

  await moveTo(rowTopY(6));
  assert.equal(hasLimitMessage(), true, "limit message stays visible");
  await releaseAt(rowTopY(6));
  assert.equal(hasLimitMessage(), true);
});

test("dragging to boundary 29 (21:30) includes the final 21:00-21:30 block while 22:00 is rejected", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 26);
  await moveTo(rowTopY(29));

  assert.deepEqual(pressedCells(), ["0:26", "0:27", "0:28"]);
  assert.deepEqual(detailTexts(), ["Thứ 2 20:00–21:30"]);
  assert.equal(isVisualEndpointCell(0, 29), true);

  await releaseAt(rowTopY(29));
  assert.deepEqual(detailTexts(), ["Thứ 2 20:00–21:30"]);
});

test("dragging above the grid clamps to boundary 0, returning inside resumes with the original anchor span", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await moveTo(10);
  assert.deepEqual(
    pressedCells(),
    ["0:0", "0:1", "0:2", "0:3", "0:4", "0:5"],
    "above grid clamps to boundary 0, showing 07:00-10:00",
  );

  await moveTo(rowTopY(10));
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9"],
    "returning to boundary 10 recomputes from the fixed anchor, restoring 10:00-12:00",
  );

  await releaseAt(rowTopY(10));
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–12:00"]);
});

test("erasing a single 30-minute block from a committed slot removes it", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-10:30)",
    slots: [{ day: "Thứ 2" as const, start: "10:00", end: "10:30" }],
  };
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, currentValue });

  await pressAt(0, 6);
  await moveTo(rowTopY(7));
  assert.deepEqual(pressedCells(), [], "erase 1 block clears it immediately");

  await releaseAt(rowTopY(7));
  assert.deepEqual(pressedCells(), []);
  assert.equal(hasEmptyDetailMessage(), true, "single block erased, detail list empty");
});

test("erasing most of a slot auto-drops the remaining sub-60-minute orphan", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-13:00)",
    slots: [{ day: "Thứ 2" as const, start: "10:00", end: "13:00" }],
  };
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, currentValue });

  await pressAt(0, 6);
  await moveTo(rowTopY(11));
  await releaseAt(rowTopY(11));

  assert.deepEqual(pressedCells(), []);
  assert.equal(hasEmptyDetailMessage(), true);
});

test("erasing a two-block slot from its bottom cell while dragging upward", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-11:00)",
    slots: [{ day: "Thứ 2" as const, start: "10:00", end: "11:00" }],
  };
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, currentValue });
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);

  await pressAt(0, 7);
  await moveTo(rowTopY(6));
  assert.deepEqual(pressedCells(), [], "bottom-up drag ungreys the interval while held");

  await releaseAt(rowTopY(6));
  assert.deepEqual(pressedCells(), [], "both cells of the two-block slot are erased");
  assert.equal(hasEmptyDetailMessage(), true);
});

test("a bottom-up erase still commits when releasing on the seam between the two cells", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-11:00)",
    slots: [{ day: "Thứ 2" as const, start: "10:00", end: "11:00" }],
  };
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, currentValue });

  await pressAt(0, 7);
  await moveTo(rowMidY(6));
  await releaseAt(rowTopY(7) + 0.5);

  assert.deepEqual(pressedCells(), [], "the two-block slot is erased despite the seam release");
  assert.equal(hasEmptyDetailMessage(), true);
});

test("releasing at 13:00 keeps the last real block while removing only preview cues", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await moveTo(rowTopY(12));

  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9", "0:10", "0:11"],
    "the preview includes the real 12:30-13:00 block",
  );
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–13:00"]);
  assert.equal(isVisualEndpointCell(0, 12), true);

  await releaseAt(rowTopY(12));

  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9", "0:10", "0:11"],
    "pointerup keeps the committed data blocks intact",
  );
  assert.deepEqual(detailTexts(), ["Thứ 2 10:00–13:00"]);
  assert.equal(
    isVisualEndpointCell(0, 12),
    true,
    "endpoint fill remains after commit without adding another 30-minute block",
  );
});

test("releasing a 30-minute paint gesture does not commit a sub-60-minute session", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await moveTo(rowTopY(7) + 0.5);
  await releaseAt(rowTopY(7) + 0.5);
  assert.deepEqual(pressedCells(), [], "30-minute paint must not commit");
  assert.equal(hasEmptyDetailMessage(), true);
});

test("painting is blocked while occupied availability is loading or failed", async () => {
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, occupiedLoading: true });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(pressedCells(), [], "no painting while availability loads");
  await releaseAt(rowTopY(10));
  assert.equal(hasEmptyDetailMessage(), true);

  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    occupiedError: "Không tải được lịch bận.",
    onRetryOccupied: () => undefined,
  });
  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(pressedCells(), [], "no painting while availability failed");
  await releaseAt(rowTopY(10));
  assert.equal(hasEmptyDetailMessage(), true);
});

test("availability error blocks commit, exposes retry and an alert region", async () => {
  let retried = false;
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedError: "Không tải được lịch bận.",
    onRetryOccupied: () => {
      retried = true;
    },
  });

  const alert = [...document.querySelectorAll<HTMLElement>("[role='alert']")].find(
    (element) => element.textContent?.includes("Không tải được lịch bận"),
  );
  assert.ok(alert, "error banner is announced");
  const retryButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes("Thử lại"),
  );
  assert.ok(retryButton);
  retryButton.click();
  assert.equal(retried, true);

  const confirm = confirmButton();
  assert.ok(confirm);
  assert.notEqual(
    confirm.getAttribute("disabled"),
    null,
    "confirm blocked while availability failed",
  );
});

test("touch taps use the same two-click 60-minute flow without double-applying synthetic click", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await releaseAt(rowMidY(6));
  await act(async () => {
    cellButton(0, 6).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });

  assert.deepEqual(pressedCells(), [], "single tap must not commit a 30-minute session");
  assert.deepEqual(clickAnchorCells(), ["0:6"]);
  assert.equal(hasEmptyDetailMessage(), true);

  await pressAt(0, 7);
  await releaseAt(rowMidY(7));
  await act(async () => {
    cellButton(0, 7).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);
  assert.deepEqual(clickAnchorCells(), []);
});

// ---------------------------------------------------------------------------
// Teacher scope: chọn giáo viên trước khi tô
// ---------------------------------------------------------------------------

test("single teacher is auto-selected and painting works without any click on tabs", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  assert.equal(teacherTabSelected("Cô Hạnh"), true, "the only teacher tab is active");
  assert.ok(
    document.body.textContent?.includes("Đang xếp cho Cô Hạnh"),
    "the visible caption states who the schedule is being built for",
  );
  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);
});

test("multiple teachers default to overview where painting is blocked until a teacher is chosen", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2],
  });

  assert.equal(teacherTabSelected("Tổng quan"), true, "overview is the default scope");
  assert.equal(panelMode(), "list");

  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  assert.deepEqual(pressedCells(), [], "no painting in overview");
  assert.equal(hasOverviewHint(), true, "a hint explains a teacher must be chosen");

  await clickTeacherTab("Thầy Phúc");
  assert.equal(teacherTabSelected("Thầy Phúc"), true);
  assert.ok(
    document.body.textContent?.includes("Đang xếp cho Thầy Phúc"),
    "caption switches to the selected teacher",
  );

  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  assert.deepEqual(pressedCells(), ["0:6", "0:7"], "painting works for the chosen teacher");
  assert.equal(hasOverviewHint(), false);
});

test("painting in teacher mode only ever assigns the chosen teacher", async () => {
  const savedRef: { value: { text: string; slots: ScheduleSlot[] } | null } = {
    value: null,
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      savedRef.value = value;
    },
    selectedTeachers: [T1, T2],
  });

  await clickTeacherTab("Cô Hạnh");
  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  await clickConfirm();

  assert.deepEqual(savedRef.value?.slots[0]?.teacher_ids, ["t1"]);
});

test("the grid never refetches when switching teachers: busy blocks swap instantly", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2],
    occupiedSlots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        classId: "busy-class",
        className: "Lớp 6C1",
        busyTeacherIds: ["t1"],
        busyAssistantIds: [],
      },
    ],
  });

  await clickTeacherTab("Cô Hạnh");
  assert.equal(cellState(0, 6), "busy", "Hạnh sees her own busy block");
  assert.equal(cellState(0, 7), "busy");
  assert.equal(cellState(0, 8), "free", "outside the block stays paintable");

  await clickTeacherTab("Thầy Phúc");
  assert.equal(cellState(0, 6), "free", "Phúc's view has no busy block there");
  assert.equal(cellState(0, 7), "free");
});

test("one teacher busy blocks only that teacher's scope, not the other teacher's", async () => {
  const savedRef: { value: { text: string; slots: ScheduleSlot[] } | null } = {
    value: null,
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      savedRef.value = value;
    },
    selectedTeachers: [T1, T2],
    occupiedSlots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        classId: "busy-class",
        className: "Lớp 6C1",
        busyTeacherIds: ["t1"],
        busyAssistantIds: [],
      },
    ],
  });

  // Cô Hạnh bận 10:00-11:00 → không tô được.
  await clickTeacherTab("Cô Hạnh");
  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  assert.deepEqual(pressedCells(), [], "Hạnh's scope is locked at 10:00-11:00");
  assert.equal(hasEmptyDetailMessage(), true);

  // Thầy Phúc rảnh → tô được và payload chỉ có Phúc.
  await clickTeacherTab("Thầy Phúc");
  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);
  await clickConfirm();
  assert.deepEqual(savedRef.value?.slots[0]?.teacher_ids, ["t2"]);
});

test("busy first half for A and busy second half for B: each teacher paints their free half", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2],
    occupiedSlots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        classId: "c1",
        className: "Lớp 6C1",
        busyTeacherIds: ["t1"],
        busyAssistantIds: [],
      },
      {
        day: "Thứ 2" as const,
        start: "11:00",
        end: "12:00",
        classId: "c2",
        className: "Lớp 6C2",
        busyTeacherIds: ["t2"],
        busyAssistantIds: [],
      },
    ],
  });

  await clickTeacherTab("Cô Hạnh");
  await pressAt(0, 8);
  await moveTo(rowTopY(10));
  await releaseAt(rowTopY(10));
  assert.deepEqual(
    pressedCells(),
    ["0:8", "0:9"],
    "Hạnh paints her free 11:00-12:00 half only",
  );

  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2],
    occupiedSlots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        classId: "c1",
        className: "Lớp 6C1",
        busyTeacherIds: ["t1"],
        busyAssistantIds: [],
      },
      {
        day: "Thứ 2" as const,
        start: "11:00",
        end: "12:00",
        classId: "c2",
        className: "Lớp 6C2",
        busyTeacherIds: ["t2"],
        busyAssistantIds: [],
      },
    ],
  });
  await clickTeacherTab("Thầy Phúc");
  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7"],
    "Phúc paints his free 10:00-11:00 half only",
  );
});

test("legacy conflicts without staff ids fail closed and block every teacher scope", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2],
    occupiedSlots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        className: "Lớp cũ",
      },
    ],
  });

  await clickTeacherTab("Cô Hạnh");
  const title = cellButton(0, 6).getAttribute("title") ?? "";
  assert.match(title, /Không xác định được lịch giáo viên/);
  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  assert.deepEqual(pressedCells(), [], "legacy block fails closed for Hạnh");

  await clickTeacherTab("Thầy Phúc");
  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  assert.deepEqual(pressedCells(), [], "legacy block fails closed for Phúc too");
});

test("Escape cancels a preview, then closes the dialog", async () => {
  await unmountSlide();
  await renderSlide(singleTeacherProps);

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.equal(pressedCells().length, 4);

  await pressKey(gridElement(), "Escape");
  assert.deepEqual(pressedCells(), [], "Escape cancels the preview");

  await releaseAt(rowTopY(10));
  assert.deepEqual(pressedCells(), []);
});

// ---------------------------------------------------------------------------
// Own-session overlays (chế độ giáo viên)
// ---------------------------------------------------------------------------

test("the active teacher's committed session renders a primary overlay above outside blocks", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2],
    currentValue: {
      text: "Thứ 2 (10:00-12:00)",
      slots: [{ day: "Thứ 2", start: "10:00", end: "12:00", teacher_ids: ["t1"] }],
    },
    occupiedSlots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        classId: "busy-class",
        className: "Lớp 6C1",
        busyTeacherIds: ["t1"],
        busyAssistantIds: [],
      },
    ],
  });

  await clickTeacherTab("Cô Hạnh");
  const own = ownSessionOverlayElements().find((el) =>
    (el.getAttribute("aria-label") ?? "").includes("Buổi của lớp"),
  );
  assert.ok(own, "own session overlay exists in teacher scope");
  assert.match(own?.getAttribute("aria-label") ?? "", /Cô Hạnh/);
  assert.match(own?.className ?? "", /z-30/, "own session sits above outside blocks (z-20)");
  const topPercent = (value: string) =>
    Number.parseFloat(value.match(/([\d.]+)%/)?.[1] ?? "9999");
  const ownTop = topPercent(own?.style.top ?? "");
  const busyTop = topPercent(occupiedBlockElements()[0]?.style.top ?? "");
  assert.ok(ownTop <= busyTop, "own overlay starts at the same or earlier row");
});

test("a session taught by another teacher renders neutral dashed and opens the assignment screen", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2],
    currentValue: {
      text: "Thứ 2 (10:00-12:00)",
      slots: [{ day: "Thứ 2", start: "10:00", end: "12:00", teacher_ids: ["t2"] }],
    },
  });

  await clickTeacherTab("Cô Hạnh");
  const other = ownSessionOverlayElements().find((el) =>
    (el.getAttribute("aria-label") ?? "").includes("do giáo viên khác phụ trách"),
  );
  assert.ok(other, "other-teacher session renders as a neutral overlay");
  assert.match(other?.className ?? "", /border-dashed/);

  await openSessionRow("Thứ 2", "10:00", "12:00");
  assert.equal(panelMode(), "detail", "clicking the overlay opens the assignment screen");
  assert.equal(
    document.querySelector("[data-schedule-session-detail]")?.getAttribute(
      "data-schedule-session-detail",
    ),
    "Thứ 2|10:00|12:00",
  );
});

// ---------------------------------------------------------------------------
// Master–detail session panel
// ---------------------------------------------------------------------------

test("the list shows compact rows: day, time and at most two teacher names", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2, teacherOption("t3", "Cô Mai")],
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      slots: [
        {
          day: "Thứ 2",
          start: "10:00",
          end: "11:00",
          teacher_ids: ["t1", "t2", "t3"],
        },
      ],
    },
  });

  const row = document.querySelector<HTMLButtonElement>(
    "button[data-schedule-session-key='Thứ 2|10:00|11:00']",
  );
  assert.ok(row, "session row exists");
  const rowText = row.textContent ?? "";
  assert.match(rowText, /Thứ\s*2\s*10:00–11:00/, "day and time stay visible");
  assert.match(rowText, /Cô Hạnh · Thầy Phúc \+1/, "names capped at two plus a count");
  assert.equal(
    document.querySelector('aside button[aria-label^="Xoá buổi"]'),
    null,
    "the list keeps the row uncluttered; delete lives in detail",
  );
});

test("opening a session shows the assignment screen; back returns to the list", async () => {
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      slots: [{ day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1"] }],
    },
  });

  assert.equal(panelMode(), "list");
  await openSessionRow("Thứ 2", "10:00", "11:00");
  assert.equal(panelMode(), "detail");
  assert.equal(
    document.querySelector("[data-schedule-session-list]")?.getAttribute("aria-hidden"),
    "true",
    "the list stays mounted (scroll preserved) but is hidden",
  );
  const back = document.querySelector<HTMLButtonElement>(
    'aside button[aria-label="Quay lại danh sách buổi"]',
  );
  assert.ok(back);
  await act(async () => {
    back.click();
  });
  assert.equal(panelMode(), "list");
});

test("only one assignment screen can be open at a time", async () => {
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    currentValue: {
      text: "Thứ 2 (10:00-11:00); Thứ 4 (14:00-15:00)",
      slots: [
        { day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1"] },
        { day: "Thứ 4", start: "14:00", end: "15:00", teacher_ids: ["t1"] },
      ],
    },
  });

  await openSessionRow("Thứ 2", "10:00", "11:00");
  await openSessionRow("Thứ 4", "14:00", "15:00");
  assert.equal(
    document.querySelectorAll("[data-schedule-session-detail]").length,
    1,
    "a second open replaces the first detail screen",
  );
  assert.equal(
    document.querySelector("[data-schedule-session-detail]")?.getAttribute(
      "data-schedule-session-detail",
    ),
    "Thứ 4|14:00|15:00",
  );
});

test("Escape inside the assignment screen returns to the list instead of closing", async () => {
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      slots: [{ day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1"] }],
    },
  });

  await openSessionRow("Thứ 2", "10:00", "11:00");
  assert.equal(panelMode(), "detail");
  await pressKey(document.querySelector("aside")!, "Escape");
  assert.equal(panelMode(), "list");
  assert.ok(
    document.querySelector("[data-schedule-grid='true']"),
    "the dialog stays open",
  );
});

test("the assignment screen shows every pool teacher state and adds a co-teacher", async () => {
  const savedRef: { value: { text: string; slots: ScheduleSlot[] } | null } = {
    value: null,
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      savedRef.value = value;
    },
    selectedTeachers: [T1, T2],
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      slots: [{ day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1"] }],
    },
  });

  await openSessionRow("Thứ 2", "10:00", "11:00");
  const hahn = detailTeacherButton("t1");
  const phuc = detailTeacherButton("t2");
  assert.ok(hahn && phuc, "both pool teachers are listed");
  assert.equal(hahn?.getAttribute("aria-pressed"), "true");
  assert.match(hahn?.textContent ?? "", /Đã chọn/);
  assert.equal(phuc?.getAttribute("aria-pressed"), "false");
  assert.match(phuc?.textContent ?? "", /Rảnh/);
  assert.equal(phuc?.getAttribute("disabled"), null);

  await act(async () => {
    phuc?.click();
  });
  assert.equal(phuc?.getAttribute("aria-pressed"), "true");

  await act(async () => {
    confirmButton()?.click();
  });
  assert.deepEqual(savedRef.value?.slots[0]?.teacher_ids, ["t1", "t2"]);
});

test("the last assigned teacher of a slot cannot be removed", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2],
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      slots: [{ day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1"] }],
    },
  });

  await openSessionRow("Thứ 2", "10:00", "11:00");
  const hahn = detailTeacherButton("t1");
  assert.ok(hahn);
  assert.notEqual(hahn.getAttribute("disabled"), null, "removing the only teacher is blocked");
  const phuc = detailTeacherButton("t2");
  assert.equal(phuc?.getAttribute("disabled"), null, "the free teacher can still be added");
});

test("removing one co-teacher keeps the other; both can be restored", async () => {
  const savedRef: { value: { text: string; slots: ScheduleSlot[] } | null } = {
    value: null,
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      savedRef.value = value;
    },
    selectedTeachers: [T1, T2],
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      slots: [
        { day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1", "t2"] },
      ],
    },
  });

  await openSessionRow("Thứ 2", "10:00", "11:00");
  const hahn = detailTeacherButton("t1");
  assert.ok(hahn);
  await act(async () => {
    hahn.click();
  });
  assert.equal(hahn.getAttribute("aria-pressed"), "false");
  const phuc = detailTeacherButton("t2");
  assert.equal(phuc?.getAttribute("aria-pressed"), "true");

  await act(async () => {
    confirmButton()?.click();
  });
  assert.deepEqual(savedRef.value?.slots[0]?.teacher_ids, ["t2"]);
});

test("a busy pool teacher is listed with the conflicting class and cannot be added", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1, T2],
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      slots: [{ day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1"] }],
    },
    occupiedSlots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        classId: "busy-class",
        className: "Lớp 6C2",
        busyTeacherIds: ["t2"],
        busyAssistantIds: [],
      },
    ],
  });

  await openSessionRow("Thứ 2", "10:00", "11:00");
  const phuc = detailTeacherButton("t2");
  assert.ok(phuc);
  assert.match(phuc.textContent ?? "", /Bận · Lớp 6C2/);
  assert.notEqual(phuc.getAttribute("disabled"), null, "busy teacher cannot be added");
});

test("the assignment screen marks an assigned-but-busy teacher and blocks the save", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1],
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      slots: [{ day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1"] }],
    },
    occupiedSlots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        classId: "busy-class",
        className: "Lớp 6C1",
        busyTeacherIds: ["t1"],
        busyAssistantIds: [],
      },
    ],
  });

  assert.notEqual(
    confirmButton()?.getAttribute("disabled"),
    null,
    "commit is blocked while the assigned teacher is busy",
  );
  const listText = document.querySelector("aside")?.textContent ?? "";
  assert.match(listText, /Xung đột lịch nhân sự/);
});

test("legacy slots without explicit ids fall back to the class pool in the assignment screen", async () => {
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    currentValue: {
      text: "Thứ 2 (10:00-12:00)",
      slots: [{ day: "Thứ 2", start: "10:00", end: "12:00" }],
    },
  });

  await openSessionRow("Thứ 2", "10:00", "12:00");
  const hahn = detailTeacherButton("t1");
  assert.ok(hahn);
  assert.equal(hahn.getAttribute("aria-pressed"), "true", "fallback teacher shows as assigned");
});

test("deleting a session from the assignment screen removes it and returns to the list", async () => {
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    currentValue: {
      text: "Thứ 2 (10:00-11:00); Thứ 4 (14:00-15:00)",
      slots: [
        { day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1"] },
        { day: "Thứ 4", start: "14:00", end: "15:00", teacher_ids: ["t1"] },
      ],
    },
  });

  await openSessionRow("Thứ 2", "10:00", "11:00");
  const deleteButton = [...document.querySelectorAll<HTMLButtonElement>("aside button")].find(
    (button) => button.textContent?.includes("Xóa buổi"),
  );
  assert.ok(deleteButton, "detail screen exposes the delete action");
  await act(async () => {
    deleteButton.click();
  });

  assert.equal(panelMode(), "list");
  assert.deepEqual(detailTexts(), ["Thứ 4 14:00–15:00"], "the other session survives");
});

test("the detail list only shows teachers and assistants selected for the class", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [T1],
    selectedAssistants: [
      { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const },
    ],
    currentValue: {
      text: "Thứ 2 (10:00-12:00)",
      slots: [
        {
          day: "Thứ 2",
          start: "10:00",
          end: "12:00",
          teacher_ids: ["t1"],
          assistant_ids: ["a1"],
        },
      ],
    },
  });

  await openSessionRow("Thứ 2", "10:00", "12:00");
  const detailText = document.querySelector("[data-schedule-session-detail]")?.textContent ?? "";
  assert.match(detailText, /Cô Hạnh/, "teacher appears");
  assert.match(detailText, /Cô Lan/, "assistant appears");
  assert.ok(!detailText.includes("Thầy Phúc"), "system-wide teachers never appear");
});

// ---------------------------------------------------------------------------
// Occupied-session rendering
// ---------------------------------------------------------------------------

test("an occupied session renders exactly one visual block with no per-cell rectangles behind", async () => {
  const occupiedSlots = [
    {
      day: "Thứ 2" as const,
      start: "10:00",
      end: "12:00",
      classId: "class-1",
      className: "Lớp 6A1",
      busyTeacherIds: ["t1"],
      busyAssistantIds: [],
    },
  ];
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    occupiedSlots,
  });

  const blocks = occupiedBlockElements();
  assert.equal(blocks.length, 1, "exactly one visual block for the session");
  assert.match(
    blocks[0].getAttribute("aria-label") ?? "",
    /Lớp 6A1, Thứ 2 10:00 đến 12:00/,
    "block label carries the full class name, day and time",
  );
  for (let timeIndex = 6; timeIndex < 10; timeIndex += 1) {
    assert.equal(
      cellButton(0, timeIndex).getAttribute("style"),
      null,
      `booked cell ${timeIndex} has no inline background/border`,
    );
    assert.equal(
      cellButton(0, timeIndex).getAttribute("aria-disabled"),
      "true",
      `booked cell ${timeIndex} stays disabled for hit-test`,
    );
  }
});

test("duplicate occupied blocks with the same class/day/time render once", async () => {
  const occupiedSlots = [
    {
      day: "Thứ 2" as const,
      start: "10:00",
      end: "11:00",
      classId: "class-1",
      className: "Lớp 6A1",
      busyTeacherIds: ["t1"],
      busyAssistantIds: [],
    },
    {
      day: "Thứ 2" as const,
      start: "10:00",
      end: "11:00",
      classId: "class-1",
      className: "Lớp 6A1",
      busyTeacherIds: ["t1"],
      busyAssistantIds: [],
    },
  ];
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    occupiedSlots,
  });

  assert.equal(occupiedBlockElements().length, 1);
});

test("a dual-role conflict keeps one canonical block with the active teacher busy label", async () => {
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    selectedAssistants: [
      { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const },
    ],
    occupiedSlots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        classId: "c1",
        className: "Lớp 6A1",
        busyTeacherIds: ["t1"],
        busyAssistantIds: ["a1"],
      },
    ],
  });

  await clickTeacherTab("Cô Hạnh");
  const blocks = occupiedBlockElements();
  assert.equal(blocks.length, 1, "dual-role session still renders one block");
  const label = blocks[0].getAttribute("aria-label") ?? "";
  assert.match(label, /Cô Hạnh đang bận/, "teacher busy state is announced by name");

  await pressAt(0, 6);
  await moveTo(rowTopY(9));
  assert.deepEqual(pressedCells(), [], "an occupied teacher interval is blocked");
});

test("lane partitioning reuses a lane when the previous interval ends (A-B-C chain)", async () => {
  const block = (id: string, name: string, start: string, end: string) => ({
    day: "Thứ 2" as const,
    start,
    end,
    classId: id,
    className: name,
    busyTeacherIds: ["t1"],
    busyAssistantIds: [],
  });
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedSlots: [
      block("a", "Lớp A", "10:00", "12:00"),
      block("b", "Lớp B", "11:00", "13:00"),
      block("c", "Lớp C", "12:00", "14:00"),
    ],
  });

  const blocks = occupiedBlockElements();
  assert.equal(blocks.length, 3, "all three chain blocks are rendered");
  const labels = blocks.map((el) => el.getAttribute("aria-label") ?? "").sort();
  assert.ok(labels.some((label) => label.includes("Lớp A")));
  assert.ok(labels.some((label) => label.includes("Lớp B")));
  assert.ok(labels.some((label) => label.includes("Lớp C")));
  assert.ok(
    !document.body.textContent?.includes("+1 lớp bận"),
    "a two-lane chain must not show a false overflow badge",
  );
  const leftOf = (name: string) =>
    blocks.find((el) => (el.getAttribute("aria-label") ?? "").includes(name))?.style
      .left;
  assert.ok(leftOf("Lớp A") !== leftOf("Lớp B"), "A and B overlap → different lanes");
  assert.ok(leftOf("Lớp B") !== leftOf("Lớp C"), "B and C overlap → different lanes");
});

test("sequential occupied blocks keep full width when another pair overlaps elsewhere", async () => {
  const block = (id: string, name: string, start: string, end: string) => ({
    day: "Thứ 2" as const,
    start,
    end,
    classId: id,
    className: name,
    busyTeacherIds: ["t1"],
    busyAssistantIds: [],
  });
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedSlots: [
      block("a", "Lớp A", "10:00", "11:00"),
      block("b", "Lớp B", "10:00", "11:00"),
      block("c", "Lớp C", "12:00", "13:00"),
    ],
  });

  const blocks = occupiedBlockElements();
  const widthOf = (name: string) =>
    blocks.find((el) => (el.getAttribute("aria-label") ?? "").includes(name))?.style
      .width;
  const widthA = widthOf("Lớp A");
  const widthB = widthOf("Lớp B");
  const widthC = widthOf("Lớp C");
  assert.ok(widthA && widthB && widthC, "all occupied widths must be rendered");
  assert.equal(widthA, widthB, "overlapping blocks share the split width");
  assert.notEqual(widthC, widthA, "a sequential block must reclaim the full width");
});

test("three simultaneous occupied classes show two blocks plus a separate summary", async () => {
  const block = (id: string, name: string) => ({
    day: "Thứ 2" as const,
    start: "10:00",
    end: "12:00",
    classId: id,
    className: name,
    busyTeacherIds: ["t1"],
    busyAssistantIds: [],
  });
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedSlots: [block("a", "Lớp A"), block("b", "Lớp B"), block("c", "Lớp C")],
  });

  const blocks = occupiedBlockElements();
  const summary = [...document.querySelectorAll<HTMLElement>("div[class*='z-20']")].find(
    (el) => el.textContent?.includes("+1 lớp bận"),
  );
  assert.ok(summary, "overflow summary exists");
  const realBlocks = blocks.filter(
    (el) => !(el.textContent ?? "").includes("+1 lớp bận"),
  );
  assert.equal(realBlocks.length, 2, "two real blocks stay visible");
  const summaryLeft = summary?.style.left;
  const blockLefts = realBlocks.map((el) => el.style.left);
  assert.ok(
    blockLefts.every((left) => left !== summaryLeft),
    "summary sits in its own reserved lane, not on top of a block",
  );
  assert.match(
    summary?.getAttribute("aria-label") ?? "",
    /1 lớp khác cũng bận trong khoảng 10:00 đến 12:00/,
  );
});

test("overflow count splits per segment when concurrency changes across a boundary", async () => {
  const block = (id: string, name: string, start: string, end: string) => ({
    day: "Thứ 2" as const,
    start,
    end,
    classId: id,
    className: name,
    busyTeacherIds: ["t1"],
    busyAssistantIds: [],
  });
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedSlots: [
      block("a", "Lớp A", "10:00", "12:00"),
      block("b", "Lớp B", "10:00", "12:00"),
      block("c", "Lớp C", "10:00", "12:00"),
      block("d", "Lớp D", "10:00", "11:00"),
    ],
  });

  const summaries = [...document.querySelectorAll<HTMLElement>("div[class*='z-20']")]
    .filter((el) => (el.textContent ?? "").includes("lớp bận"))
    .map((el) => ({
      label: el.getAttribute("aria-label") ?? "",
      text: el.textContent ?? "",
    }));
  const morning = summaries.find((s) => s.label.includes("10:00 đến 11:00"));
  const afternoon = summaries.find((s) => s.label.includes("11:00 đến 12:00"));
  assert.ok(morning, "segment 10:00-11:00 summary exists");
  assert.ok(afternoon, "segment 11:00-12:00 summary exists");
  assert.match(morning.text, /\+2 lớp bận/, "two hidden classes at 10:00-11:00");
  assert.match(afternoon.text, /\+1 lớp bận/, "one hidden class at 11:00-12:00");
});

// ---------------------------------------------------------------------------
// Staff-level availability and session lineage
// ---------------------------------------------------------------------------

const busyBlock = (
  start: string,
  end: string,
  role: "TEACHER" | "ASSISTANT",
  staffIds: string[],
) => ({
  day: "Thứ 2" as const,
  start,
  end,
  classId: "busy-class",
  className: "Lớp bận",
  classCategory: "SPECIALIZED" as const,
  gradeLevel: 6,
  busyTeacherIds: role === "TEACHER" ? staffIds : [],
  busyAssistantIds: role === "ASSISTANT" ? staffIds : [],
});

test("one selected teacher busy blocks the interval entirely", async () => {
  await unmountSlide();
  await renderSlide({
    ...singleTeacherProps,
    occupiedSlots: [busyBlock("10:00", "11:00", "TEACHER", ["t1"])],
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  await releaseAt(rowTopY(10));
  assert.deepEqual(pressedCells(), [], "an occupied teacher interval is blocked");
  assert.equal(hasEmptyDetailMessage(), true);
});

test("a busy assistant never blocks the slot and is not assigned", async () => {
  let saved: ScheduleSlot[] | null = null;
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      saved = value?.slots ?? null;
    },
    selectedTeachers: [T1],
    selectedAssistants: [
      { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const },
    ],
    occupiedSlots: [busyBlock("10:00", "11:00", "ASSISTANT", ["a1"])],
  });

  await clickTeacherTab("Cô Hạnh");
  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9"],
    "busy assistant does not lock the slot",
  );
  await releaseAt(rowTopY(10));

  const confirm = confirmButton();
  assert.ok(confirm);
  confirm.click();
  assert.deepEqual(saved, [
    {
      day: "Thứ 2",
      start: "10:00",
      end: "12:00",
      teacher_ids: ["t1"],
      assistant_ids: [],
    },
  ]);
});

test("multiple assistants, one busy: only the free assistant is assigned", async () => {
  let saved: ScheduleSlot[] | null = null;
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      saved = value?.slots ?? null;
    },
    selectedTeachers: [T1],
    selectedAssistants: [
      { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const },
      { ...teacherOption("a2", "Cô Mai"), staff_type: "ASSISTANT" as const },
    ],
    occupiedSlots: [busyBlock("10:00", "11:00", "ASSISTANT", ["a1"])],
  });

  await clickTeacherTab("Cô Hạnh");
  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  await releaseAt(rowTopY(10));

  const confirm = confirmButton();
  assert.ok(confirm);
  confirm.click();
  assert.deepEqual(saved, [
    {
      day: "Thứ 2",
      start: "10:00",
      end: "12:00",
      teacher_ids: ["t1"],
      assistant_ids: ["a2"],
    },
  ]);
});

test("multiple teachers, one busy: slot remains open and only the free teacher is auto-assigned", async () => {
  let saved: ScheduleSlot[] | null = null;
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    scheduleMode: "class-schedule",
    onClose: () => undefined,
    onSave: (value) => {
      saved = value?.slots ?? null;
    },
    selectedTeachers: [T1, T2],
    selectedAssistants: [],
    occupiedSlots: [busyBlock("10:00", "11:00", "TEACHER", ["t1"])],
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  await releaseAt(rowTopY(10));

  const confirm = confirmButton();
  assert.ok(confirm);
  confirm.click();
  assert.deepEqual(saved, [
    {
      day: "Thứ 2",
      start: "10:00",
      end: "12:00",
      teacher_ids: ["t2"],
      assistant_ids: [],
    },
  ]);
});

test("two sessions on the same day keep independent assignments across erase/repaint", async () => {
  let saved: ScheduleSlot[] | null = null;
  const currentValue = {
    text: "Thứ 2 (10:00-12:00); Thứ 2 (14:00-15:00)",
    slots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "12:00",
        teacher_ids: ["t1"],
      },
      {
        day: "Thứ 2" as const,
        start: "14:00",
        end: "15:00",
        teacher_ids: ["t2"],
      },
    ],
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      saved = value?.slots ?? null;
    },
    currentValue,
    selectedTeachers: [T1, T2],
  });

  // Xóa buổi 14:00-15:00 rồi vẽ lại 14:00-15:30 trong phạm vi Thầy Phúc.
  await clickTeacherTab("Thầy Phúc");
  await pressAt(0, 14);
  await moveTo(rowTopY(16));
  await releaseAt(rowTopY(16));
  assert.ok(
    detailTexts().includes("Thứ 2 10:00–12:00"),
    "the untouched 10:00 session stays",
  );
  assert.ok(
    !detailTexts().includes("Thứ 2 14:00–15:00"),
    "the erased 14:00 session is gone",
  );

  await pressAt(0, 14);
  await moveTo(rowTopY(17));
  await releaseAt(rowTopY(17));

  const confirm = confirmButton();
  assert.ok(confirm);
  confirm.click();
  assert.deepEqual(saved, [
    { day: "Thứ 2", start: "10:00", end: "12:00", teacher_ids: ["t1"], assistant_ids: [] },
    { day: "Thứ 2", start: "14:00", end: "15:30", teacher_ids: ["t2"], assistant_ids: [] },
  ]);
});

test("erasing and repainting a slot in the same teacher scope preserves its staff assignment", async () => {
  let saved: ScheduleSlot[] | null = null;
  const currentValue = {
    text: "Thứ 2 (10:00-12:00)",
    slots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "12:00",
        teacher_ids: ["t1"],
      },
    ],
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      saved = value?.slots ?? null;
    },
    currentValue,
    selectedTeachers: [T1],
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  await releaseAt(rowTopY(10));
  assert.equal(hasEmptyDetailMessage(), true);

  await pressAt(0, 7);
  await moveTo(rowTopY(11));
  await releaseAt(rowTopY(11));

  const confirm = confirmButton();
  assert.ok(confirm, "confirm button exists");
  confirm.click();
  assert.deepEqual(saved, [
    {
      day: "Thứ 2",
      start: "10:30",
      end: "12:30",
      teacher_ids: ["t1"],
      assistant_ids: [],
    },
  ]);
});

test("repainting an erased slot in ANOTHER teacher scope assigns the new teacher", async () => {
  let saved: ScheduleSlot[] | null = null;
  const currentValue = {
    text: "Thứ 2 (10:00-11:00)",
    slots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "11:00",
        teacher_ids: ["t1"],
      },
    ],
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      saved = value?.slots ?? null;
    },
    currentValue,
    selectedTeachers: [T1, T2],
  });

  await clickTeacherTab("Cô Hạnh");
  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));
  assert.equal(hasEmptyDetailMessage(), true);

  // Đổi sang Thầy Phúc rồi tô lại đúng vùng: không lấy nhầm lineage của Hạnh.
  await clickTeacherTab("Thầy Phúc");
  await pressAt(0, 6);
  await moveTo(rowTopY(8));
  await releaseAt(rowTopY(8));

  const confirm = confirmButton();
  assert.ok(confirm);
  confirm.click();
  assert.deepEqual(saved, [
    {
      day: "Thứ 2",
      start: "10:00",
      end: "11:00",
      teacher_ids: ["t2"],
      assistant_ids: [],
    },
  ]);
});

test("explicit empty assistant stays empty after resize and save", async () => {
  let saved: ScheduleSlot[] | null = null;
  const currentValue = {
    text: "Thứ 2 (10:00-12:00)",
    slots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "12:00",
        teacher_ids: ["t1"],
        assistant_ids: [],
      },
    ],
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      saved = value?.slots ?? null;
    },
    currentValue,
    selectedTeachers: [T1],
    selectedAssistants: [
      { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const },
    ],
  });

  await clickTeacherTab("Cô Hạnh");
  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  await releaseAt(rowTopY(10));
  await pressAt(0, 7);
  await moveTo(rowTopY(11));
  await releaseAt(rowTopY(11));

  const confirm = confirmButton();
  assert.ok(confirm);
  confirm.click();
  assert.deepEqual(saved, [
    {
      day: "Thứ 2",
      start: "10:30",
      end: "12:30",
      teacher_ids: ["t1"],
      assistant_ids: [],
    },
  ]);
});

test("the fifth weekly slot is never painted even during preview", async () => {
  const currentValue = {
    text: "Thứ 2 (07:00-07:30); Thứ 3 (07:00-07:30); Thứ 4 (07:00-07:30); Thứ 5 (07:00-07:30)",
    slots: [
      { day: "Thứ 2" as const, start: "07:00", end: "07:30" },
      { day: "Thứ 3" as const, start: "07:00", end: "07:30" },
      { day: "Thứ 4" as const, start: "07:00", end: "07:30" },
      { day: "Thứ 5" as const, start: "07:00", end: "07:30" },
    ],
  };
  await unmountSlide();
  await renderSlide({ ...singleTeacherProps, currentValue });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));

  assert.deepEqual(
    pressedCells(),
    ["0:0", "1:0", "2:0", "3:0"],
    "the fifth slot is not rendered during preview",
  );
  assert.equal(hasLimitMessage(), true);

  await releaseAt(rowTopY(10));
  assert.deepEqual(pressedCells(), ["0:0", "1:0", "2:0", "3:0"]);
});

test("class-schedule list shows assistants and locks the last teacher without fading", async () => {
  const assistant = { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const };
  const savedRef: { value: { text: string; slots: ScheduleSlot[] } | null } = {
    value: null,
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      savedRef.value = value;
    },
    scheduleMode: "class-schedule",
    selectedTeachers: [T1, T2],
    selectedAssistants: [assistant],
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      slots: [
        {
          day: "Thứ 2",
          start: "10:00",
          end: "11:00",
          teacher_ids: ["t1"],
          assistant_ids: ["a1"],
        },
      ],
    },
  });

  // The compact "Danh sách chi tiết" must render the assistant name.
  const listText =
    document.querySelector("[data-schedule-session-list]")?.textContent ?? "";
  assert.match(listText, /Cô Lan/, "assistant appears in the class-schedule list");

  // Only t1 is assigned and the pool has t1 + t2, so t1 is the last teacher:
  // it must be locked (cannot be removed) but keep its full assigned color and
  // never be faded via opacity.
  const t1 = document.querySelector<HTMLButtonElement>('[data-schedule-panel-teacher="t1"]');
  const t2 = document.querySelector<HTMLButtonElement>('[data-schedule-panel-teacher="t2"]');
  assert.ok(t1 && t2, "both pool teachers are listed");
  assert.equal(t1.getAttribute("aria-pressed"), "true");
  assert.equal(t1.disabled, true, "last teacher is locked");
  assert.equal(
    t1.classList.contains("opacity-60"),
    false,
    "last teacher is not faded/dimmed",
  );
  assert.equal(t2.getAttribute("aria-pressed"), "false");
  assert.equal(t2.disabled, false, "unassigned co-teacher is clickable");
});

test("class-schedule list falls back to the class assistant pool for legacy slots without per-slot assistant_ids", async () => {
  const assistant = { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    scheduleMode: "class-schedule",
    selectedTeachers: [T1],
    selectedAssistants: [assistant],
    currentValue: {
      text: "Thứ 2 (10:00-11:00)",
      // Legacy slot: no per-slot assistant_ids field → fall back to the
      // class-level selected assistant pool.
      slots: [{ day: "Thứ 2", start: "10:00", end: "11:00", teacher_ids: ["t1"] }],
    },
  });

  const listText =
    document.querySelector("[data-schedule-session-list]")?.textContent ?? "";
  assert.match(
    listText,
    /Cô Lan/,
    "legacy slot without per-slot assistant_ids falls back to the class assistant",
  );
});
