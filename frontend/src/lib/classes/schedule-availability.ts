/**
 * Pure selectors for schedule availability.
 *
 * The grid interacts with one explicit scope at a time:
 * - overview: view-only, every occupied block of the whole staff pool is drawn;
 * - teacher: only the active teacher's busy blocks matter for painting.
 *
 * Legacy conflict blocks (no `busyTeacherIds` / `busyAssistantIds`) fail
 * closed: they are busy for every teacher and report an explicit message
 * instead of being treated as free.
 */

export interface ScheduleConflictBlock {
  day: string;
  start: string;
  end: string;
  className: string;
  classId?: string;
  busyTeacherIds?: string[];
  busyAssistantIds?: string[];
}

export const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export const minutesToTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
};

export const LEGACY_CONFLICT_MESSAGE = "Không xác định được lịch giáo viên";

/** Legacy block with no staff metadata: cannot tell who is busy. */
export function isLegacyConflictBlock(block: ScheduleConflictBlock): boolean {
  return (
    block.busyTeacherIds === undefined && block.busyAssistantIds === undefined
  );
}

/**
 * Blocks overlapping the given 30-minute block (half-open interval).
 */
export function getBlocksAtBlock(
  blocks: readonly ScheduleConflictBlock[],
  day: string,
  timeBlock: string,
): ScheduleConflictBlock[] {
  const blockStart = timeToMinutes(timeBlock);
  const blockEnd = blockStart + 30;
  return blocks.filter((slot) => {
    if (slot.day !== day) return false;
    const slotStart = timeToMinutes(slot.start);
    const slotEnd = timeToMinutes(slot.end);
    return slotStart < blockEnd && blockStart < slotEnd;
  });
}

/**
 * Class schedule picker rule: an occupied block is blocked only if ALL teachers
 * of the class are busy during this time block. If at least one teacher is free
 * (or if no teachers are assigned yet), the cell remains open for scheduling.
 */
export function isClassScheduleCellBlocked(
  blocks: readonly ScheduleConflictBlock[],
  day: string,
  timeBlock: string,
  teacherIds: readonly string[] = [],
): boolean {
  const conflicting = getBlocksAtBlock(blocks, day, timeBlock);
  if (conflicting.length === 0) return false;
  if (conflicting.some((slot) => isLegacyConflictBlock(slot))) {
    return true;
  }
  if (teacherIds.length === 0) return false;
  return teacherIds.every(
    (teacherId) => getTeacherBlockAvailability(blocks, day, timeBlock, teacherId).busy,
  );
}

export type TeacherBlockAvailability = {
  /** The teacher is busy at this block (including legacy fail-closed). */
  busy: boolean;
  /** Only a legacy conflict covers this block — identity cannot be known. */
  legacy: boolean;
  /** Class names that concretely occupy the teacher at this block. */
  classNames: string[];
};

export function getTeacherBlockAvailability(
  blocks: readonly ScheduleConflictBlock[],
  day: string,
  timeBlock: string,
  teacherId: string,
): TeacherBlockAvailability {
  const conflicting = getBlocksAtBlock(blocks, day, timeBlock);
  if (conflicting.length === 0) {
    return { busy: false, legacy: false, classNames: [] };
  }
  const classNames = conflicting
    .filter(
      (slot) =>
        !isLegacyConflictBlock(slot) &&
        ((slot.busyTeacherIds ?? []).includes(teacherId) ||
          (slot.busyAssistantIds ?? []).includes(teacherId)),
    )
    .map((slot) => slot.className);
  const legacy = conflicting.some((slot) => isLegacyConflictBlock(slot));
  return { busy: legacy || classNames.length > 0, legacy, classNames };
}

/**
 * Class names occupying the teacher across the whole interval; empty when the
 * teacher is free (or when only legacy blocks cover the interval — reported
 * separately through `legacy`).
 */
export function getTeacherBusyClassNamesAcrossInterval(
  blocks: readonly ScheduleConflictBlock[],
  day: string,
  startMinutes: number,
  endMinutes: number,
  teacherId: string,
): string[] {
  const classNames = new Set<string>();
  for (let minutes = startMinutes; minutes < endMinutes; minutes += 30) {
    const availability = getTeacherBlockAvailability(
      blocks,
      day,
      minutesToTime(minutes),
      teacherId,
    );
    if (availability.legacy) return [];
    for (const className of availability.classNames) classNames.add(className);
  }
  return [...classNames];
}

/** True when the teacher is free across every 30-minute block of the interval. */
export function isTeacherFreeAcrossInterval(
  blocks: readonly ScheduleConflictBlock[],
  day: string,
  startMinutes: number,
  endMinutes: number,
  teacherId: string,
): boolean {
  for (let minutes = startMinutes; minutes < endMinutes; minutes += 30) {
    if (getTeacherBlockAvailability(blocks, day, minutesToTime(minutes), teacherId).busy) {
      return false;
    }
  }
  return true;
}

/** True when an unidentifiable legacy block covers any part of the interval. */
export function hasLegacyConflictAcrossInterval(
  blocks: readonly ScheduleConflictBlock[],
  day: string,
  startMinutes: number,
  endMinutes: number,
): boolean {
  for (let minutes = startMinutes; minutes < endMinutes; minutes += 30) {
    if (
      getBlocksAtBlock(blocks, day, minutesToTime(minutes)).some((slot) =>
        isLegacyConflictBlock(slot),
      )
    ) {
      return true;
    }
  }
  return false;
}
