import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getCurrentTimeMarkerTop,
  getVietnamScheduleClock,
  isScheduleIntervalPast,
  millisecondsUntilNextScheduleStep,
  parseScheduleTime,
} from "../src/lib/classes/schedule-current-time";

const weeklyScheduleSource = readFileSync(
  new URL("../src/components/layout/weekly-schedule-board.tsx", import.meta.url),
  "utf8",
);

test("Vietnam schedule clock snaps to the previous half-hour independently of the host timezone", () => {
  const clock = getVietnamScheduleClock(new Date("2026-08-26T07:17:42.000Z"));
  assert.equal(clock.dayIndex, 2);
  assert.equal(clock.minutes, 14 * 60 + 17);
  assert.equal(clock.snappedMinutes, 14 * 60);
  assert.equal(clock.label, "14:00");
  assert.equal(clock.markerVisible, true);
});

test("current-time marker sits on the lower edge of the active half-hour row", () => {
  const beforeOpening = getVietnamScheduleClock(new Date("2026-08-25T23:59:00.000Z"));
  const duringFirstRow = getVietnamScheduleClock(new Date("2026-08-26T00:17:00.000Z"));
  const atClosing = getVietnamScheduleClock(new Date("2026-08-26T14:30:00.000Z"));
  const afterClosing = getVietnamScheduleClock(new Date("2026-08-26T14:31:00.000Z"));
  assert.equal(beforeOpening.markerVisible, false);
  assert.equal(getCurrentTimeMarkerTop(beforeOpening), null);
  assert.equal(getCurrentTimeMarkerTop(duringFirstRow), 100 / 30);
  assert.equal(atClosing.markerVisible, true);
  assert.equal(getCurrentTimeMarkerTop(atClosing), 100);
  assert.equal(afterClosing.markerVisible, false);
});

test("past sessions are day-aware and keep an in-progress class prominent", () => {
  const clock = getVietnamScheduleClock(new Date("2026-08-26T07:30:00.000Z"));
  assert.equal(isScheduleIntervalPast(1, parseScheduleTime("20:00"), clock), true);
  assert.equal(isScheduleIntervalPast(2, parseScheduleTime("14:30"), clock), true);
  assert.equal(isScheduleIntervalPast(2, parseScheduleTime("15:30"), clock), false);
  assert.equal(isScheduleIntervalPast(3, parseScheduleTime("09:00"), clock), false);
});

test("schedule timer aligns itself to the next half-hour after seconds and milliseconds", () => {
  assert.equal(
    millisecondsUntilNextScheduleStep(new Date("2026-08-26T07:17:42.250Z")),
    12 * 60_000 + 17_750,
  );
  assert.equal(
    millisecondsUntilNextScheduleStep(new Date("2026-08-26T07:30:00.000Z")),
    30 * 60_000,
  );
});

test("overview schedule exposes a non-interactive, reduced-motion-safe current-time indicator", () => {
  assert.match(weeklyScheduleSource, /data-dashboard-current-time/);
  assert.match(weeklyScheduleSource, /pointer-events-none/);
  assert.match(weeklyScheduleSource, /motion-reduce:transition-none/);
  assert.match(weeklyScheduleSource, /visibilitychange/);
  assert.match(weeklyScheduleSource, /data-schedule-past/);
  assert.match(weeklyScheduleSource, /đã qua/);
});
