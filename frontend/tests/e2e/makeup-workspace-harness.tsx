import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClassMakeupWorkspace } from "@/components/classes/class-makeup-workspace";
import { classQueryKeys } from "@/lib/classes/query-keys";
import type { ClassResponse } from "@/lib/types";

function daysFromNow(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

const mockClass: ClassResponse = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Lớp 6A1",
  type: "MONTHLY",
  base_fee: 750000,
  billing_cycle_months: 1,
  billing_cycle_weeks: null,
  start_date: daysFromNow(-30),
  end_date: daysFromNow(120),
  identity_scheme: "ACADEMIC_YEAR",
  class_category: "GENERAL",
  grade_mode: "GRADE",
  program_name: null,
  grade_level: 6,
  education_level: "MIDDLE",
  academic_year_start: 2026,
  schedule: null,
  teacher_id: null,
  teacher_ids: [],
  teacher_name: null,
  teacher_names: [],
  assistant_ids: [],
  assistant_names: [],
  is_active: true,
  student_count: 4,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  version: 1,
  display_name: "Lớp 6A1",
  primary_label: "Lớp 6A1",
  secondary_label: null,
  effective_status: "ACTIVE",
  can_edit_end_date: true,
  end_date_edit_deadline: null,
  can_edit: true,
  can_cancel: true,
  can_view_history: true,
  operational_end_date: "2027-06-06",
  unresolved_makeup_count: 2,
};

function Harness() {
  const [open, setOpen] = useState(true);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // The end date is intentionally blank on first render. The test selects
  // today + 14 days, so seed the exact date-range query key that follows.
  const from = daysFromNow(0);
  const to = daysFromNow(14);
  queryClient.setQueryData(classQueryKeys.occurrences(mockClass.id, { from, to }), {
    class_id: mockClass.id,
    occurrences: [
      {
        key: `${mockClass.id}:${new Date(`${daysFromNow(3)}T18:00:00`).toISOString()}`,
        kind: "REGULAR",
        original_start_at: new Date(`${daysFromNow(3)}T18:00:00`).toISOString(),
        original_end_at: new Date(`${daysFromNow(3)}T19:00:00`).toISOString(),
        source_slot_key: "Thứ 2|18:00|19:00",
        teacher_ids: [],
        assistant_ids: [],
        exception_id: null,
        status: null,
        replacement_start_at: null,
        replacement_end_at: null,
        adjustable: true,
        already_adjusted: false,
        passed: false,
      },
      {
        key: `${mockClass.id}:${new Date(`${daysFromNow(5)}T18:00:00`).toISOString()}`,
        kind: "REGULAR",
        original_start_at: new Date(`${daysFromNow(5)}T18:00:00`).toISOString(),
        original_end_at: new Date(`${daysFromNow(5)}T19:00:00`).toISOString(),
        source_slot_key: "Thứ 2|18:00|19:00",
        teacher_ids: [],
        assistant_ids: [],
        exception_id: "44444444-4444-4444-8444-444444444444",
        status: "MAKEUP_PENDING",
        replacement_start_at: null,
        replacement_end_at: null,
        adjustable: false,
        already_adjusted: true,
        passed: false,
      },
    ],
  });
  queryClient.setQueryData(classQueryKeys.suspensionPreview(mockClass.id, from, to), {
    class_id: mockClass.id,
    suspended_from: from,
    resume_on: to,
    credit_days: 14,
    member_summary: [
      { enrollment_id: "55555555-5555-4555-8555-555555555555", overlap_days: 14 },
    ],
    target_cycle_count: 1,
    protected_case_count: 0,
  });
  if (!open) {
    return null;
  }

  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ClassMakeupWorkspace
          class_={mockClass}
          isSaving={false}
          onClose={() => setOpen(false)}
        />
      </QueryClientProvider>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
