import {
  getClassScheduleSlotsLabel,
  normalizeClassScheduleSlots,
} from "@/lib/classes/presentation";
import type { ClassScheduleSlot } from "@/lib/types";
import { InlineFieldDivider } from "@/components/ui/inline-field-divider";

type ClassScheduleListProps = {
  activeDay?: string;
  maxVisibleSlots?: number;
  slots: readonly ClassScheduleSlot[];
  variant?: "table" | "field";
};

const SCHEDULE_FIELD_TYPOGRAPHY_CLASS =
  "font-body-ui text-[15px] font-medium leading-5";

const SCHEDULE_DAY_CLASS =
  "inline-flex max-w-full items-center justify-center whitespace-nowrap rounded-md bg-gray-100 px-1.5 py-0.5 font-body-ui text-[12px] font-semibold leading-4 text-gray-700";

const SCHEDULE_TIME_CLASS =
  "mt-0.5 block whitespace-nowrap font-body-ui text-[13px] font-medium leading-[18px] tabular-nums text-gray-700";

const MAX_SCHEDULE_TRACKS = 4;

/**
 * A compact schedule renderer shared by the classes table and class form.
 * The table variant always reserves four flexible tracks: one to four
 * sessions sit on a single row in track order, and anything beyond four is
 * surfaced as a data error instead of being trimmed.
 */
export function ClassScheduleList({
  activeDay,
  maxVisibleSlots,
  slots,
  variant = "table",
}: ClassScheduleListProps) {
  const normalized = normalizeClassScheduleSlots(slots).filter(
    (slot) => !activeDay || slot.day === activeDay,
  );
  const fullLabel = getClassScheduleSlotsLabel(normalized);

  if (normalized.length === 0) {
    return null;
  }

  if (variant === "field") {
    const limit = normalizeLimit(maxVisibleSlots, normalized.length);
    const hasOverflow = normalized.length > limit;
    const visibleLimit = hasOverflow ? Math.max(0, limit - 1) : limit;
    const visibleSlots = normalized.slice(0, visibleLimit);
    const hiddenCount = normalized.length - visibleSlots.length;

    return (
      <span
        role="list"
        aria-label={`Lịch học: ${fullLabel}`}
        title={fullLabel}
        className="grid min-w-0 grid-cols-4 items-stretch gap-2 overflow-hidden"
      >
        {visibleSlots.map((slot) => (
          <span
            role="listitem"
            aria-label={`${slot.day}, ${slot.start} đến ${slot.end}`}
            key={`${slot.day}-${slot.start}-${slot.end}`}
            className="grid min-w-0 grid-cols-[var(--inline-field-divider-width)_minmax(0,1fr)] items-center gap-x-2.5 py-0.5"
          >
            <ScheduleDivider variant={variant} />
            <span className="min-w-0 text-center">
              <span
                className={`inline-flex max-w-full items-center justify-center whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-gray-800 ${SCHEDULE_FIELD_TYPOGRAPHY_CLASS}`}
              >
                {slot.day}
              </span>
              <span
                className={`mt-0.5 block whitespace-nowrap tabular-nums text-gray-800 ${SCHEDULE_FIELD_TYPOGRAPHY_CLASS}`}
              >
                {slot.start}–{slot.end}
              </span>
            </span>
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span
            role="listitem"
            aria-label={`Còn ${hiddenCount} buổi học khác`}
            className="grid min-w-0 grid-cols-[var(--inline-field-divider-width)_minmax(0,1fr)] items-center gap-x-2.5 py-0.5"
          >
            <ScheduleDivider variant={variant} />
            <span className="min-w-0 text-center">
              <span
                className={`inline-flex max-w-full items-center justify-center whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-gray-800 ${SCHEDULE_FIELD_TYPOGRAPHY_CLASS}`}
              >
                +{hiddenCount} ca
              </span>
              <span className={`mt-0.5 block whitespace-nowrap text-gray-500 ${SCHEDULE_FIELD_TYPOGRAPHY_CLASS}`}>
                Còn lại
              </span>
            </span>
          </span>
        ) : null}
      </span>
    );
  }

  const visibleSlots = normalized.slice(0, MAX_SCHEDULE_TRACKS);
  const overflowCount = normalized.length - visibleSlots.length;

  return (
    <span
      role="list"
      aria-label={`Lịch học: ${fullLabel}`}
      title={fullLabel}
      className="grid min-w-0 grid-cols-[repeat(4,minmax(0,1fr))] items-start gap-2"
    >
      {visibleSlots.map((slot) => (
        <span
          role="listitem"
          aria-label={`${slot.day}, ${slot.start} đến ${slot.end}`}
          key={`${slot.day}-${slot.start}-${slot.end}`}
          className="grid min-w-0 grid-cols-[var(--inline-field-divider-width)_minmax(0,1fr)] items-center gap-x-1"
        >
          <ScheduleDivider variant={variant} />
          <span className="min-w-0 text-left">
            <span className={SCHEDULE_DAY_CLASS}>{slot.day}</span>
            <span className={SCHEDULE_TIME_CLASS}>
              {slot.start}–{slot.end}
            </span>
          </span>
        </span>
      ))}
      {overflowCount > 0 ? (
        <span
          role="listitem"
          className="col-span-full inline-flex w-fit items-center rounded-md bg-amber-50 px-2 py-0.5 text-[12px] font-semibold leading-4 text-amber-700"
        >
          Lịch học vượt quá {MAX_SCHEDULE_TRACKS} buổi — kiểm tra dữ liệu
        </span>
      ) : null}
    </span>
  );
}

function ScheduleDivider({ variant }: { variant: "table" | "field" }) {
  return (
    <InlineFieldDivider
      data-schedule-divider="true"
      data-schedule-divider-variant={variant}
      className="self-center"
    />
  );
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}
