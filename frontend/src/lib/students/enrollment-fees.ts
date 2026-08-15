export type EnrollmentFeeValues = Record<
  string,
  {
    custom_fee: number | null;
    enrollment_date: string | null;
  }
>;
