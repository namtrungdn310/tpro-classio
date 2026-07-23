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

const SCHEDULE_TYPOGRAPHY_CLASS =
  "font-body-ui text-[15px] font-medium leading-5";

/**
 * A compact schedule renderer shared by the classes table and class form.
 * Each session remains a distinct, familiar two-line unit while the neutral
 * background is limited to the day label instead of filling the whole card.
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
  const limit = normalizeLimit(maxVisibleSlots, normalized.length);
  const hasOverflow = normalized.length > limit;
  const visibleLimit = hasOverflow ? Math.max(0, limit - 1) : limit;
  const visibleSlots = normalized.slice(0, visibleLimit);
  const hiddenCount = normalized.length - visibleSlots.length;
  const fullLabel = getClassScheduleSlotsLabel(normalized);

  if (normalized.length === 0) {
    return null;
  }

  return (
    <span
      role="list"
      aria-label={`Lịch học: ${fullLabel}`}
      title={fullLabel}
      className={
        variant === "field"
          ? "grid min-w-0 grid-cols-4 items-stretch gap-2 overflow-hidden"
          : "grid min-w-0 grid-cols-[repeat(4,102px)] items-stretch gap-2.5 overflow-hidden"
      }
    >
      {visibleSlots.map((slot) => (
        <span
          role="listitem"
          aria-label={`${slot.day}, ${slot.start} đến ${slot.end}`}
          key={`${slot.day}-${slot.start}-${slot.end}`}
          className={scheduleItemClass(variant)}
        >
          <ScheduleDivider variant={variant} />
          <span className={scheduleContentClass(variant)}>
            <span
              className={`inline-flex max-w-full items-center justify-center whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-gray-800 ${SCHEDULE_TYPOGRAPHY_CLASS}`}
            >
              {slot.day}
            </span>
            <span
              className={`mt-0.5 block whitespace-nowrap tabular-nums text-gray-800 ${SCHEDULE_TYPOGRAPHY_CLASS}`}
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
          className={scheduleItemClass(variant)}
        >
          <ScheduleDivider variant={variant} />
          <span className={scheduleContentClass(variant)}>
            <span
              className={`inline-flex max-w-full items-center justify-center whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-gray-800 ${SCHEDULE_TYPOGRAPHY_CLASS}`}
            >
              +{hiddenCount} ca
            </span>
            <span className={`mt-0.5 block whitespace-nowrap text-gray-500 ${SCHEDULE_TYPOGRAPHY_CLASS}`}>
              Còn lại
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}

function scheduleItemClass(variant: "table" | "field"): string {
  return variant === "field"
    ? "grid min-w-0 grid-cols-[1px_minmax(0,1fr)] items-center gap-x-1.5 py-0.5"
    : "grid min-w-0 grid-cols-[1px_minmax(0,1fr)] items-center gap-x-1.5";
}

function scheduleContentClass(variant: "table" | "field"): string {
  return variant === "field" ? "min-w-0 text-center" : "min-w-0 text-left";
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
