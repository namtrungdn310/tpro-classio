import type { ClassScheduleSlot } from "@/lib/types";

export type EnrollmentFeeSuggestion = {
  amount: number;
  selectedMinutes: number;
  totalMinutes: number;
  selectedCount: number;
  totalCount: number;
};

function minutes(value: string) {
  const [hours, minute] = value.split(":").map(Number);
  return hours * 60 + minute;
}

function slotMinutes(slot: Pick<ClassScheduleSlot, "start" | "end">) {
  return Math.max(0, minutes(slot.end) - minutes(slot.start));
}

export function continuationSlotKey(slot: Pick<ClassScheduleSlot, "day" | "start" | "end">) {
  return `${slot.day}|${slot.start}|${slot.end}`;
}

/**
 * Suggest only. Slot selections remain an attendance entitlement and never
 * mutate pricing by themselves; the administrator must apply the amount.
 */
export function getEnrollmentFeeSuggestion(
  baseFee: number | null | undefined,
  allSlots: Array<Pick<ClassScheduleSlot, "day" | "start" | "end">>,
  selectedSlots: Array<Pick<ClassScheduleSlot, "day" | "start" | "end">>,
): EnrollmentFeeSuggestion | null {
  if (baseFee === null || baseFee === undefined || baseFee < 0 || allSlots.length === 0) {
    return null;
  }
  const selectedKeys = new Set(selectedSlots.map(continuationSlotKey));
  const totalMinutes = allSlots.reduce((sum, slot) => sum + slotMinutes(slot), 0);
  const selectedMinutes = allSlots.reduce(
    (sum, slot) => sum + (selectedKeys.has(continuationSlotKey(slot)) ? slotMinutes(slot) : 0),
    0,
  );
  if (selectedMinutes <= 0 || selectedMinutes >= totalMinutes || totalMinutes <= 0) {
    return null;
  }
  return {
    amount: Math.round((baseFee * selectedMinutes) / totalMinutes),
    selectedMinutes,
    totalMinutes,
    selectedCount: selectedSlots.length,
    totalCount: allSlots.length,
  };
}
