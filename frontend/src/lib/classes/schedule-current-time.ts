export const SCHEDULE_TIMEZONE = "Asia/Ho_Chi_Minh";
export const SCHEDULE_START_MINUTES = 7 * 60;
export const SCHEDULE_END_MINUTES = 21 * 60 + 30;
export const SCHEDULE_STEP_MINUTES = 30;

// The overview has one visual row beginning at 21:30. Its lower edge is 22:00,
// but 22:00 is not a selectable or displayed business-time boundary.
export const SCHEDULE_RENDER_END_MINUTES = 22 * 60;

export interface VietnamScheduleClock {
  /** Monday = 0, Sunday = 6, matching the weekly schedule columns. */
  dayIndex: number;
  minutes: number;
  snappedMinutes: number;
  markerVisible: boolean;
  label: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function getVietnamScheduleClock(
  value: Date | number = Date.now(),
): VietnamScheduleClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const hours = Number(part("hour"));
  const minute = Number(part("minute"));
  const minutes = hours * 60 + minute;
  const snappedMinutes =
    Math.floor(minutes / SCHEDULE_STEP_MINUTES) * SCHEDULE_STEP_MINUTES;

  return {
    dayIndex: WEEKDAY_INDEX[part("weekday")] ?? 0,
    minutes,
    snappedMinutes,
    markerVisible:
      minutes >= SCHEDULE_START_MINUTES && minutes <= SCHEDULE_END_MINUTES,
    label: formatScheduleMinutes(snappedMinutes),
  };
}

export function isScheduleIntervalPast(
  dayIndex: number,
  endMinutes: number,
  clock: VietnamScheduleClock,
) {
  if (dayIndex < clock.dayIndex) return true;
  if (dayIndex > clock.dayIndex) return false;
  return endMinutes <= clock.snappedMinutes;
}

export function getCurrentTimeMarkerTop(clock: VietnamScheduleClock) {
  if (!clock.markerVisible) return null;
  const boundedMinutes = Math.min(
    SCHEDULE_RENDER_END_MINUTES,
    Math.max(
      SCHEDULE_START_MINUTES + SCHEDULE_STEP_MINUTES,
      clock.snappedMinutes + SCHEDULE_STEP_MINUTES,
    ),
  );
  return (
    ((boundedMinutes - SCHEDULE_START_MINUTES) /
      (SCHEDULE_RENDER_END_MINUTES - SCHEDULE_START_MINUTES)) *
    100
  );
}

export function millisecondsUntilNextScheduleStep(value: Date | number = Date.now()) {
  const date = typeof value === "number" ? new Date(value) : value;
  const elapsedInStep =
    (date.getUTCMinutes() % SCHEDULE_STEP_MINUTES) * 60_000 +
    date.getUTCSeconds() * 1_000 +
    date.getUTCMilliseconds();
  return SCHEDULE_STEP_MINUTES * 60_000 - elapsedInStep;
}

export function parseScheduleTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

export function formatScheduleMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
