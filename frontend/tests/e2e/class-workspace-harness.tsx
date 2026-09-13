import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/hooks/useAuth";
import { ClassWorkspaceDialog } from "@/components/classes/class-workspace-dialog";
import type { ClassResponse } from "@/lib/types";

const mockUser = {
  id: "90000000-0000-4000-8000-000000000001",
  workspace_id: "90000000-0000-4000-8000-000000000002",
  email: "teacher@example.test",
  role: "admin" as const,
  username: "admin_test",
  full_name: "TPRO Admin",
  avatar_url: null,
  is_owner: true,
};

const mockClass: ClassResponse = {
  id: "11111111-1111-1111-1111-111111111111",
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
};

declare global {
  interface Window {
    __workspaceTest?: {
      getState: () => { open: boolean; cancelCount: number };
      close: () => void;
    };
  }
}

function Harness() {
  const [open, setOpen] = useState(true);
  const [cancelCount, setCancelCount] = useState(0);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const getState = useCallback(() => ({ open, cancelCount }), [open, cancelCount]);

  useEffect(() => {
    window.__workspaceTest = {
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
        <AuthProvider initialUser={mockUser}>
          <ClassWorkspaceDialog
            class_={mockClass}
            initialMode="edit"
            showModeRail
            canEdit
            canContinue
            isSaving={false}
            isContinuing={false}
            isDeleting={false}
            isTeachersError={false}
            isTeachersLoading={false}
            teachers={[]}
            onClose={() => setOpen(false)}
            onRetryTeachers={() => undefined}
            onSubmit={() => undefined}
            onCreateContinuation={() => undefined}
            onPackageDurationChanged={() => undefined}
            onCancelClass={() => setCancelCount((count) => count + 1)}
          />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
