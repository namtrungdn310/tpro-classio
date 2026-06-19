export type ClassType = "MONTHLY" | "COURSE";

export type ClassSchedule = {
  text?: string;
  [key: string]: unknown;
} | null;

export type ClassResponse = {
  id: string;
  name: string;
  type: ClassType;
  base_fee: number;
  billing_cycle_months: number;
  start_date: string | null;
  end_date: string | null;
  schedule: ClassSchedule;
  is_active: boolean;
  student_count: number;
  created_at: string;
};

export type ClassCreate = {
  name: string;
  type: ClassType;
  base_fee: number;
  billing_cycle_months: number;
  start_date?: string | null;
  end_date?: string | null;
  schedule?: ClassSchedule;
};

export type ClassUpdate = Partial<ClassCreate> & {
  is_active?: boolean;
};
