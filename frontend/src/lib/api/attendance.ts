import { z } from "zod";
import { apiClient } from "@/lib/api/client";

const attendanceOccurrenceSchema = z.object({
  occurrence_id: z.string().uuid(),
  key: z.string().min(1),
  kind: z.enum(["REGULAR", "MAKEUP", "POSTPONED"]),
  original_start_at: z.string().datetime({ offset: true }),
  original_end_at: z.string().datetime({ offset: true }),
  status: z.string().nullable().optional(),
});

const attendanceCheckinSchema = z.object({
  key: z.string().min(1),
  checkin_at: z.string().datetime({ offset: true }),
  rate_amount: z.number().int().nonnegative(),
});

const attendanceTodaySchema = z.object({
  staff_id: z.string().uuid(),
  occurrences: z.array(attendanceOccurrenceSchema),
  checkins: z.array(attendanceCheckinSchema),
});

const attendanceResultSchema = z.object({
  attendance_id: z.string().uuid(),
  status: z.literal("CHECKED_IN"),
  checkin_at: z.string().datetime({ offset: true }),
  rate_amount: z.number().int().positive(),
  occurrence_start_at: z.string().datetime({ offset: true }),
});

export type AttendanceToday = z.infer<typeof attendanceTodaySchema>;

export async function getAttendanceToday(): Promise<AttendanceToday> {
  const response = await apiClient.get<unknown>("/attendance/me/today");
  return attendanceTodaySchema.parse(response.data);
}

export async function checkInAttendance(occurrenceId: string) {
  const response = await apiClient.post<unknown>(
    `/attendance/me/occurrences/${occurrenceId}/check-in`,
    { request_id: crypto.randomUUID() },
  );
  return attendanceResultSchema.parse(response.data);
}
