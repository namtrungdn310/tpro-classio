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

// Each grid cell is 100px wide and 30px tall with a fractional border so
// the canonical geometry normalisation is exercised.  Day columns start at
// x=80 and time rows start at y=100+0.3px, so boundary 6 (10:00) is at
// [280.3, 310.3) and boundary 10 (12:00) is at [400.3, 430.3).
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

const detailTexts = () =>
  [...document.querySelectorAll<HTMLElement>("aside span")]
    .map((element) => element.textContent?.trim() ?? "")
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

const clickAnchorCells = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button[data-click-anchor='true']")]
    .map((button) => `${button.dataset.dayIndex}:${button.dataset.timeIndex}`);

async function clickConfirm() {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes("Xác nhận"),
  );
  assert.ok(button, "confirm button must exist");
  await act(async () => {
    button.click();
  });
}

test.beforeEach(async () => {
  layoutTopOffset = 0;
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined });
});

test.afterEach(async () => {
  await unmountSlide();
});

test("two adjacent pointer clicks create a valid 60-minute session without a 30-minute commit", async () => {
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
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-11:00)"]);

  const saved: Array<{ text: string; slots: ScheduleSlot[] } | null> = [];
  const onSave = (value: { text: string; slots: ScheduleSlot[] } | null) => {
    saved.push(value);
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave,
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
  });
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
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
  });

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
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    currentValue: {
      text: "Thứ 4 (09:00-12:30)",
      slots: [{ day: "Thứ 4", start: "09:00", end: "12:30" }],
    },
  });

  assert.equal(isVisualEndpointCell(2, 11), true);
  await pressAt(2, 11);
  await moveTo(rowTopY(10) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 (09:00-12:00)"]);
  assert.equal(isVisualEndpointCell(2, 10), true);

  await releaseAt(rowTopY(10) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 (09:00-12:00)"]);
  assert.deepEqual(
    pressedCells(),
    ["2:4", "2:5", "2:6", "2:7", "2:8", "2:9"],
  );
  assert.equal(isVisualEndpointCell(2, 10), true);
});

test("after a click shrink, the moved endpoint can immediately be dragged downward", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    currentValue: {
      text: "Thứ 4 (09:00-12:30)",
      slots: [{ day: "Thứ 4", start: "09:00", end: "12:30" }],
    },
  });

  await pressAt(2, 11);
  await releaseAt(rowMidY(11));
  assert.deepEqual(detailTexts(), ["Thứ 4 (09:00-12:00)"]);
  assert.equal(isVisualEndpointCell(2, 10), true);

  await pressAt(2, 10);
  await moveTo(rowTopY(11) + 0.5);
  assert.deepEqual(
    detailTexts(),
    ["Thứ 4 (09:00-12:30)"],
    "the endpoint switches to painting as soon as the pointer moves downward",
  );
  await releaseAt(rowTopY(11) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 (09:00-12:30)"]);
  assert.equal(isVisualEndpointCell(2, 11), true);
});

test("a session keeps its visual endpoint filled without committing a phantom block", async () => {
  await pressAt(0, 6);
  await moveTo(rowTopY(7) + 0.5);
  assert.deepEqual(pressedCells(), ["0:6"], "one data block activated");
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-10:30)"]);
  assert.equal(isVisualEndpointCell(0, 7), true, "exclusive endpoint is visibly previewed");

  await moveTo(rowTopY(8) + 0.5);
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-11:00)"]);
  assert.equal(isVisualEndpointCell(0, 8), true, "next exclusive endpoint follows the pointer");

  await releaseAt(rowTopY(8) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-11:00)"]);
  assert.equal(
    isVisualEndpointCell(0, 8),
    true,
    "the endpoint fill persists after commit without becoming a data block",
  );
});

test("an 08:00-16:00 drag keeps the 15:30-16:00 cell visibly selected after release", async () => {
  await pressAt(1, 2);
  await moveTo(rowTopY(18) + 0.5);

  assert.equal(isVisualEndpointCell(1, 18), true, "16:00 receives endpoint feedback while dragging");
  assert.equal(cellButton(1, 17).getAttribute("aria-pressed"), "true");

  await releaseAt(rowTopY(18) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 3 (08:00-16:00)"]);
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
  await pressAt(2, 4);
  await moveTo(rowTopY(11) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 (09:00-12:30)"]);
  assert.equal(isVisualEndpointCell(2, 11), true);
  assert.equal(cellButton(2, 11).getAttribute("aria-pressed"), "false");

  await releaseAt(rowTopY(11) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 4 (09:00-12:30)"]);
  assert.deepEqual(
    pressedCells(),
    ["2:4", "2:5", "2:6", "2:7", "2:8", "2:9", "2:10"],
  );
  assert.equal(isVisualEndpointCell(2, 11), true);
  assert.equal(cellButton(2, 11).getAttribute("aria-pressed"), "false");
});

test("keyboard activation follows the same pending, extend and minimum-duration rules", async () => {
  const first = cellButton(0, 6);
  const second = cellButton(0, 7);
  const third = cellButton(0, 8);
  const fourth = cellButton(0, 9);
  await pressKey(first, "Enter");
  assert.deepEqual(pressedCells(), []);
  assert.deepEqual(clickAnchorCells(), ["0:6"]);

  await pressKey(second, "Enter");
  assert.deepEqual(pressedCells(), ["0:6", "0:7"]);
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-11:00)"]);

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
  await pressAt(0, 6);
  assert.deepEqual(pressedCells(), [], "the anchor alone is not a valid session");

  await moveTo(rowTopY(10));

  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9"],
    "the moment the pointer touches the 12:00 boundary the interval ends there",
  );
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:00)"]);
  assert.equal(isVisualEndpointCell(0, 10), true, "the exclusive endpoint is visibly previewed");

  await releaseAt(rowTopY(10));
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:00)"]);
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
  for (const offsetWithinRow of [0.5, ROW_HEIGHT * 0.25, ROW_HEIGHT / 2, ROW_HEIGHT - 0.5]) {
    await pressAt(0, 6);
    await moveTo(rowTopY(10) + offsetWithinRow);

    assert.deepEqual(
      pressedCells(),
      ["0:6", "0:7", "0:8", "0:9"],
      `offset ${offsetWithinRow}px inside the endpoint row must resolve immediately`,
    );
    assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:00)"]);
    assert.equal(isVisualEndpointCell(0, 10), true);

    await releaseAt(rowTopY(10) + offsetWithinRow);
    await unmountSlide();
    await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined });
  }
});

test("dragging down to 12:30 and reversing to 12:00 commits exactly 10:00-12:00", async () => {
  await pressAt(0, 6);
  await moveTo(rowTopY(11));
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:30)"]);

  await moveTo(rowTopY(10));
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:00)"]);

  await releaseAt(rowTopY(10));
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:00)"]);
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9"],
    "reversing never leaves a spare 30-minute block",
  );
});

test("the reported 09:00 to 13:00 to 12:30 reversal commits exactly 09:00-12:30", async () => {
  await pressAt(1, 4);
  await moveTo(rowTopY(12) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 3 (09:00-13:00)"]);

  await moveTo(rowTopY(11) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 3 (09:00-12:30)"]);

  await releaseAt(rowTopY(11) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 3 (09:00-12:30)"]);
  assert.deepEqual(
    pressedCells(),
    ["1:4", "1:5", "1:6", "1:7", "1:8", "1:9", "1:10"],
  );
});

test("a layout shift during a gesture invalidates geometry before the next sample", async () => {
  await pressAt(0, 6);

  layoutTopOffset = 31;
  await act(async () => {
    resizeObserverCallbacks.forEach((callback) => {
      callback([], {} as ResizeObserver);
    });
  });
  await moveTo(rowTopY(10) + 0.5);

  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:00)"]);
  assert.deepEqual(pressedCells(), ["0:6", "0:7", "0:8", "0:9"]);
  await releaseAt(rowTopY(10) + 0.5);
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:00)"]);
});

test("pointerup coordinates commit even without a final pointermove", async () => {
  await pressAt(0, 6);
  await releaseAt(rowTopY(10));

  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:00)"]);
  assert.deepEqual(pressedCells(), ["0:6", "0:7", "0:8", "0:9"]);
});

test("pointercancel discards the preview and leaves the committed state untouched", async () => {
  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(pressedCells(), ["0:6", "0:7", "0:8", "0:9"]);

  await cancelGesture();

  assert.deepEqual(pressedCells(), []);
  assert.equal(hasEmptyDetailMessage(), true);
  assert.equal(isVisualEndpointCell(0, 10), false, "endpoint cell reverts after cancel");
});

test("lostpointercapture discards the preview and prevents a later commit", async () => {
  await pressAt(0, 6);
  await moveTo(rowTopY(10));

  await loseCapture();
  await releaseAt(rowTopY(10));

  assert.deepEqual(pressedCells(), []);
  assert.equal(hasEmptyDetailMessage(), true);
});

test("returning to the anchor after moving cancels the gesture preview", async () => {
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
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined, currentValue });

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
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
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
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedSlots,
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7"],
    "the interval stops before the blocked block",
  );
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-11:00)"]);

  await releaseAt(rowTopY(10));
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-11:00)"]);
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
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedSlots,
  });

  await pressAt(0, 10);
  await moveTo(rowTopY(6));

  assert.deepEqual(pressedCells(), ["0:9"]);
  assert.deepEqual(detailTexts(), ["Thứ 2 (11:30-12:00)"]);
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
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
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
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined, currentValue });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.equal(hasLimitMessage(), true, "the limit message appears during the preview");

  await releaseAt(rowTopY(10));
  assert.equal(hasLimitMessage(), true, "the rejected gesture keeps the message");
  assert.equal(detailTexts().length, 4, "the committed slots stay unchanged");
});

test("returning to the anchor clears a temporary slot-limit warning", async () => {
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
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined, currentValue });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.equal(hasLimitMessage(), true);

  await moveTo(rowTopY(6));
  assert.equal(hasLimitMessage(), false);
});

test("dragging to boundary 29 (21:30) includes the final 21:00-21:30 block while 22:00 is rejected", async () => {
  await pressAt(0, 26);
  await moveTo(rowTopY(29));

  assert.deepEqual(pressedCells(), ["0:26", "0:27", "0:28"]);
  assert.deepEqual(detailTexts(), ["Thứ 2 (20:00-21:30)"]);
  assert.equal(isVisualEndpointCell(0, 29), true);

  await releaseAt(rowTopY(29));
  assert.deepEqual(detailTexts(), ["Thứ 2 (20:00-21:30)"]);
});

test("dragging above the grid clamps to boundary 0, returning inside resumes with the original anchor span", async () => {
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
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-12:00)"]);
});

test("erasing a single 30-minute block from a committed slot removes it", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-10:30)",
    slots: [{ day: "Thứ 2" as const, start: "10:00", end: "10:30" }],
  };
  await unmountSlide();
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined, currentValue });

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
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined, currentValue });

  // Erase 10:00-12:30 (blocks 6..10), leaving only block 11 (12:30-13:00 = 30 min).
  await pressAt(0, 6);
  await moveTo(rowTopY(11));
  await releaseAt(rowTopY(11));

  // The 30-minute orphan must be auto-cleaned.
  assert.deepEqual(pressedCells(), []);
  assert.equal(hasEmptyDetailMessage(), true);
});

test("erasing a two-block slot from its bottom cell while dragging upward", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-11:00)",
    slots: [{ day: "Thứ 2" as const, start: "10:00", end: "11:00" }],
  };
  await unmountSlide();
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined, currentValue });
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
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined, currentValue });

  // Press the bottom cell, drag into the top cell, then release exactly on
  // the shared border (boundary 7) which previously collapsed the interval.
  await pressAt(0, 7);
  await moveTo(rowMidY(6));
  await releaseAt(rowTopY(7) + 0.5);

  assert.deepEqual(pressedCells(), [], "the two-block slot is erased despite the seam release");
  assert.equal(hasEmptyDetailMessage(), true);
});

test("releasing at 13:00 keeps the last real block while removing only preview cues", async () => {
  await pressAt(0, 6);
  await moveTo(rowTopY(12));

  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9", "0:10", "0:11"],
    "the preview includes the real 12:30-13:00 block",
  );
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-13:00)"]);
  assert.equal(isVisualEndpointCell(0, 12), true);

  await releaseAt(rowTopY(12));

  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9", "0:10", "0:11"],
    "pointerup keeps the committed data blocks intact",
  );
  assert.deepEqual(detailTexts(), ["Thứ 2 (10:00-13:00)"]);
  assert.equal(
    isVisualEndpointCell(0, 12),
    true,
    "endpoint fill remains after commit without adding another 30-minute block",
  );
});

// ---------------------------------------------------------------------------
// Occupied-session rendering (single visual block) and staff selection
// ---------------------------------------------------------------------------

const occupiedBlockElements = () =>
  [...document.querySelectorAll<HTMLElement>(
    "div[class*='pointer-events-none'][class*='absolute'][class*='z-20']",
  )];

const confirmButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    /xác nhận/i.test(button.textContent ?? ""),
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

const detailChipTexts = () =>
  [...document.querySelectorAll<HTMLButtonElement>("aside button")]
    .map((button) => button.textContent?.trim() ?? "")
    .filter(Boolean);

test("an occupied session renders exactly one visual block with no per-cell rectangles behind", async () => {
  const occupiedSlots = [
    {
      day: "Thứ 2" as const,
      start: "10:00",
      end: "12:00",
      classId: "class-1",
      className: "Lớp 6A1",
    },
  ];
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
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
    },
    {
      day: "Thứ 2" as const,
      start: "10:00",
      end: "11:00",
      classId: "class-1",
      className: "Lớp 6A1",
    },
  ];
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedSlots,
  });

  assert.equal(occupiedBlockElements().length, 1);
});

test("the detail list only shows teachers and assistants selected for the class", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-12:00)",
    slots: [
      {
        day: "Thứ 2" as const,
        start: "10:00",
        end: "12:00",
        teacher_ids: ["t1"],
        assistant_ids: ["a1"],
      },
    ],
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    currentValue,
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
    selectedAssistants: [
      { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const },
    ],
  });

  const asideText = document.querySelector("aside")?.textContent ?? "";
  assert.match(asideText, /GV: Cô Hạnh/, "single teacher shows as static summary");
  const chips = detailChipTexts();
  assert.deepEqual(chips, ["Cô Lan"], "assistant chip exists for the TG pool");
  assert.ok(!asideText.includes("Thầy Phúc"), "system-wide teachers never appear");
});

test("a legacy slot without explicit ids falls back to the class pool", async () => {
  const currentValue = {
    text: "Thứ 2 (10:00-12:00)",
    slots: [{ day: "Thứ 2" as const, start: "10:00", end: "12:00" }],
  };
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    currentValue,
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
  });

  const asideText = document.querySelector("aside")?.textContent ?? "";
  assert.match(asideText, /GV: Cô Hạnh/, "fallback teacher shows via class pool");
});

test("the last assigned teacher of a slot cannot be removed", async () => {
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
    onSave: () => undefined,
    currentValue,
    selectedTeachers: [teacherOption("t1", "Cô Hạnh"), teacherOption("t2", "Thầy Phúc")],
  });

  const chip = [...document.querySelectorAll<HTMLButtonElement>("aside button")].find(
    (button) => button.textContent === "Cô Hạnh",
  );
  assert.ok(chip);
  assert.equal(chip.getAttribute("aria-pressed"), "true");
  assert.notEqual(
    chip.getAttribute("disabled"),
    null,
    "removing the only teacher of a slot is blocked",
  );
  const freeChip = [...document.querySelectorAll<HTMLButtonElement>("aside button")].find(
    (button) => button.textContent === "Thầy Phúc",
  );
  assert.ok(freeChip);
  assert.equal(freeChip.getAttribute("disabled"), null);
});

test("erasing and repainting a slot preserves its staff assignment", async () => {
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
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
  });

  // Xóa hẳn buổi 10:00-12:00 rồi vẽ lại 10:30-12:30.
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
  await renderSlide({ isOpen: true, onClose: () => undefined, onSave: () => undefined, currentValue });

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

test("painting is blocked while occupied availability is loading or failed", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedLoading: true,
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(pressedCells(), [], "no painting while availability loads");
  await releaseAt(rowTopY(10));
  assert.equal(hasEmptyDetailMessage(), true);

  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    occupiedError: "Không tải được lịch bận.",
    onRetryOccupied: () => undefined,
  });
  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(pressedCells(), [], "no painting while availability failed");
  await releaseAt(rowTopY(10));
  assert.equal(hasEmptyDetailMessage(), true);
});

// ---------------------------------------------------------------------------
// Staff-level availability (per-staff blocking) and session lineage
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
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
    occupiedSlots: [busyBlock("10:00", "11:00", "TEACHER", ["t1"])],
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  await releaseAt(rowTopY(10));
  assert.deepEqual(pressedCells(), [], "all selected teachers busy → blocked");
  assert.equal(hasEmptyDetailMessage(), true);
});

test("two teachers, only A busy: interval is creatable and defaults to B", async () => {
  let saved: ScheduleSlot[] | null = null;
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: (value) => {
      saved = value?.slots ?? null;
    },
    selectedTeachers: [teacherOption("t1", "Cô Hạnh"), teacherOption("t2", "Thầy Phúc")],
    occupiedSlots: [busyBlock("10:00", "11:00", "TEACHER", ["t1"])],
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(
    pressedCells(),
    ["0:6", "0:7", "0:8", "0:9"],
    "painting allowed because teacher B is free",
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
      teacher_ids: ["t2"],
      assistant_ids: [],
    },
  ]);
});

test("A busy first half and B busy second half: no free teacher across the interval, blocked", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [teacherOption("t1", "Cô Hạnh"), teacherOption("t2", "Thầy Phúc")],
    occupiedSlots: [
      busyBlock("10:00", "11:00", "TEACHER", ["t1"]),
      busyBlock("11:00", "12:00", "TEACHER", ["t2"]),
    ],
  });

  await pressAt(0, 6);
  await moveTo(rowTopY(10));
  assert.deepEqual(
    pressedCells(),
    [],
    "no single teacher is free across the whole interval",
  );
  await releaseAt(rowTopY(10));
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
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
    selectedAssistants: [
      { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const },
    ],
    occupiedSlots: [busyBlock("10:00", "11:00", "ASSISTANT", ["a1"])],
  });

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
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
    selectedAssistants: [
      { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const },
      { ...teacherOption("a2", "Cô Mai"), staff_type: "ASSISTANT" as const },
    ],
    occupiedSlots: [busyBlock("10:00", "11:00", "ASSISTANT", ["a1"])],
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
      teacher_ids: ["t1"],
      assistant_ids: ["a2"],
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
    selectedTeachers: [teacherOption("t1", "Cô Hạnh"), teacherOption("t2", "Thầy Phúc")],
  });

  // Xóa buổi 14:00-15:00 rồi vẽ lại 14:00-15:30.
  await pressAt(0, 14);
  await moveTo(rowTopY(16));
  await releaseAt(rowTopY(16));
  assert.ok(
    detailTexts().includes("Thứ 2 (10:00-12:00)"),
    "the untouched 10:00 session stays",
  );
  assert.ok(
    !detailTexts().includes("Thứ 2 (14:00-15:00)"),
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
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
    selectedAssistants: [
      { ...teacherOption("a1", "Cô Lan"), staff_type: "ASSISTANT" as const },
    ],
  });

  // Đổi biên: xóa hẳn rồi vẽ lại — assistant rỗng không được fallback sang pool.
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

test("availability error blocks commit, exposes retry and an alert region", async () => {  let retried = false;
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
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
  });

  // Cử chỉ pointer (touch tap): pointerdown + pointerup không move + click
  // detail 0 (như trình duyệt tổng hợp cho touch).
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

test("a dual-role conflict keeps one canonical block with both busy role sets", async () => {
  await unmountSlide();
  await renderSlide({
    isOpen: true,
    onClose: () => undefined,
    onSave: () => undefined,
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
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

  const blocks = occupiedBlockElements();
  assert.equal(blocks.length, 1, "dual-role session still renders one block");
  const label = blocks[0].getAttribute("aria-label") ?? "";
  assert.match(label, /giáo viên bận/, "teacher busy role is announced");
  assert.match(label, /trợ giảng bận/, "assistant busy role is announced");

  // Cả GV lẫn TG bận đều chặn interval vì GV (toàn bộ selected) bận.
  await pressAt(0, 6);
  await moveTo(rowTopY(9));
  assert.deepEqual(pressedCells(), [], "all selected teachers busy → blocked");
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
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
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
  // Lane reuse: A (10-12) và C (12-14) kề nhau có thể chung lane; cặp giao nhau
  // (A-B tại 11-12, B-C tại 12-13) phải nằm khác lane.
  const leftOf = (name: string) =>
    blocks.find((el) => (el.getAttribute("aria-label") ?? "").includes(name))?.style
      .left;
  assert.ok(leftOf("Lớp A") !== leftOf("Lớp B"), "A and B overlap → different lanes");
  assert.ok(leftOf("Lớp B") !== leftOf("Lớp C"), "B and C overlap → different lanes");
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
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
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
  // 10-11: A,B,C,D = 4 concurrent -> 2 hidden; 11-12: A,B,C = 3 -> 1 hidden.
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
    selectedTeachers: [teacherOption("t1", "Cô Hạnh")],
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

test("releasing a 30-minute paint gesture does not commit a sub-60-minute session", async () => {
  await pressAt(0, 6);
  await moveTo(rowTopY(7) + 0.5);
  await releaseAt(rowTopY(7) + 0.5);
  assert.deepEqual(pressedCells(), [], "30-minute paint must not commit");
  assert.equal(hasEmptyDetailMessage(), true);
});
