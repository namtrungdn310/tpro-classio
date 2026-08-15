import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClassMakeupWorkspace } from "@/components/classes/class-makeup-workspace";
import { classQueryKeys } from "@/lib/classes/query-keys";
import type { ClassResponse, ClassSessionExceptionResponse } from "@/lib/types";

const mockClass: ClassResponse = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Lớp 6A1",
  type: "MONTHLY",
  base_fee: 750000,
  billing_cycle_months: 1,
  billing_cycle_weeks: null,
  start_date: "2026-08-27",
  end_date: "2027-06-06",
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

function daysFromNow(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function isoAtLocal(date: string, hour: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, hour).toISOString();
}

const pendingException: ClassSessionExceptionResponse = {
  id: "22222222-2222-4222-8222-222222222222",
  adjustment_id: "33333333-3333-4333-8333-333333333333",
  class_id: mockClass.id,
  original_start_at: isoAtLocal(daysFromNow(3), 18),
  original_end_at: isoAtLocal(daysFromNow(3), 19),
  original_timezone: "Asia/Ho_Chi_Minh",
  status: "MAKEUP_PENDING",
  display_status: "MAKEUP_PENDING",
  replacement_start_at: null,
  replacement_end_at: null,
  completed_at: null,
  restored_at: null,
  version: 1,
  staff: [
    {
      staff_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      role: "TEACHER",
      display_name: "Cô Hạnh",
      source_slot_key: "Thứ 2|18:00|19:00",
    },
  ],
  eligible_student_count: 3,
  billing_impact: "NONE",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

declare global {
  interface Window {
    __makeupTest?: {
      getState: () => {
        actions: Array<{ action: string; exceptionId: string }>;
        open: boolean;
      };
      close: () => void;
    };
  }
}

function Harness() {
  const [open, setOpen] = useState(true);
  const [actions, setActions] = useState<Array<{ action: string; exceptionId: string }>>([]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const from = daysFromNow(0);
  const to = daysFromNow(14);
  queryClient.setQueryData(classQueryKeys.occurrences(mockClass.id, { from, to }), {
    class_id: mockClass.id,
    occurrences: [
      {
        key: `${mockClass.id}:${isoAtLocal(daysFromNow(3), 18)}`,
        kind: "REGULAR",
        original_start_at: isoAtLocal(daysFromNow(3), 18),
        original_end_at: isoAtLocal(daysFromNow(3), 19),
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
        key: `${mockClass.id}:${isoAtLocal(daysFromNow(5), 18)}`,
        kind: "REGULAR",
        original_start_at: isoAtLocal(daysFromNow(5), 18),
        original_end_at: isoAtLocal(daysFromNow(5), 19),
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
  queryClient.setQueryData(classQueryKeys.adjustments(mockClass.id, {}), {
    adjustments: [],
    exceptions: [pendingException],
  });

  const getState = useCallback(() => ({ actions, open }), [actions, open]);

  useEffect(() => {
    window.__makeupTest = {
      getState,
      close: () => setOpen(false),
    };
  }, [getState]);

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
          onAction={(action, exceptionId) =>
            setActions((previous) => [...previous, { action, exceptionId }])
          }
        />
      </QueryClientProvider>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
