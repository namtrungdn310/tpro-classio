import type { StudentEnrollmentInfo } from "@/lib/types";

export type EnrollmentBillingValues = {
  custom_fee: number | null;
  enrollment_date: string | null;
};

export type EnrollmentFeeValues = Record<string, EnrollmentBillingValues>;

export function applySharedEnrollmentDate(
  enrollments: StudentEnrollmentInfo[],
  currentValues: EnrollmentFeeValues,
  enrollmentDate: string,
): EnrollmentFeeValues {
  return Object.fromEntries(
    enrollments.map((enrollment) => {
      const current = currentValues[enrollment.id];
      return [
        enrollment.id,
        {
          custom_fee: current ? current.custom_fee : enrollment.custom_fee,
          enrollment_date: enrollmentDate,
        },
      ];
    }),
  );
}
