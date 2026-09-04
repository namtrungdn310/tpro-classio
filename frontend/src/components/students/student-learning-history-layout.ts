import type { EnrollmentResponse } from "@/lib/types";

export type StudentLearningHistoryItem = {
  enrollment: EnrollmentResponse;
  connectsToPrevious: boolean;
  connectsToNext: boolean;
};

function historyTime(enrollment: EnrollmentResponse): number {
  const value = enrollment.enrollment_date ?? enrollment.class_start_date;
  return value ? Date.parse(`${value}T00:00:00`) : 0;
}

export function buildStudentLearningHistoryLayout(
  enrollments: EnrollmentResponse[],
): StudentLearningHistoryItem[] {
  const sorted = [...enrollments].sort((left, right) => {
    const statusDifference = Number(right.status === "active") - Number(left.status === "active");
    if (statusDifference !== 0) return statusDifference;

    const timeDifference = historyTime(right) - historyTime(left);
    if (timeDifference !== 0) return timeDifference;
    return left.id.localeCompare(right.id);
  });

  return sorted.map((enrollment, index) => ({
    enrollment,
    connectsToPrevious: index > 0,
    connectsToNext: index < sorted.length - 1,
  }));
}
