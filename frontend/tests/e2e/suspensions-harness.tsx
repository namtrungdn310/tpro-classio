import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/hooks/useAuth";
import { EnrollmentSuspensionPanel } from "@/components/students/enrollment-suspension-panel";
import { ClassSuspensionLifecyclePanel } from "@/components/classes/class-suspension-lifecycle-panel";
import { StudentWorkspaceDialog } from "@/components/students/student-workspace-dialog";
import { classResponseSchema } from "@/lib/schemas/class";
import { studentResponseSchema } from "@/lib/schemas/student";

const currentClass = classResponseSchema.parse({
  id: "80000000-0000-4000-8000-000000000001", name: "TPRO lớp 6", type: "MONTHLY", base_fee: 750000,
  billing_cycle_months: 1, start_date: "2027-01-01", end_date: null, identity_scheme: "LEGACY",
  class_category: null, grade_mode: null, program_name: null, grade_level: null, education_level: null,
  academic_year_start: null, schedule: null, teacher_id: null, teacher_name: null, is_active: true, student_count: 1,
  created_at: "2027-01-01T00:00:00Z", updated_at: "2027-01-01T00:00:00Z", version: 1,
  display_name: "TPRO lớp 6", primary_label: "TPRO lớp 6", secondary_label: null, effective_status: "ACTIVE",
  can_edit_end_date: true, end_date_edit_deadline: null,
});
const student = studentResponseSchema.parse({
  id: "50000000-0000-4000-8000-000000000001", student_code: "TP000000001", full_name: "Học viên kiểm thử",
  birth_date: null, school: null, parent_name: null, parent_phone: null, parent_zalo: null,
  student_zalo: null, student_phone: null, notes: null, hidden_fields: [], status: "active", classes: [],
  created_at: "2027-01-01T00:00:00Z", updated_at: "2027-01-01T00:00:00Z",
  // Deliberately put the other class first: never fall back to the first membership.
  active_enrollments: [
    { id: "70000000-0000-4000-8000-000000000002", class_id: "80000000-0000-4000-8000-000000000002", class_name: "Lớp khác" },
    { id: "70000000-0000-4000-8000-000000000001", class_id: currentClass.id, class_name: currentClass.name },
  ].map(e => ({ ...e, custom_fee: null, effective_fee: 750000, enrollment_date: "2027-01-01", status: "active" })),
});

const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const user = { id: "90000000-0000-4000-8000-000000000001", workspace_id: "90000000-0000-4000-8000-000000000002",
  email: "suspension@example.test", role: "admin" as const, username: "test", full_name: "TPRO test", avatar_url: null, is_owner: true };
function Harness() {
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const isClass = new URLSearchParams(location.search).has("class");
  const workspace = new URLSearchParams(location.search).get("workspace");
  return <QueryClientProvider client={client}><AuthProvider initialUser={user}>
    <main style={{ maxWidth: 640, margin: "0 auto", height: "100dvh", display: "flex", flexDirection: "column" }}>
      <p data-testid="shell-state">{busy ? "busy" : "idle"} / {dirty ? "dirty" : "clean"}</p>
      {workspace ? <StudentWorkspaceDialog student={student} selectedClass={workspace === "unscoped" ? null : currentClass} initialMode={workspace === "unscoped" ? "edit" : "suspension"} isSaving={false} isDeleting={false} onClose={() => {}} onRemoveFromClass={() => {}} renderEditPanel={() => <p>Hồ sơ học viên</p>} />
        : isClass ? <ClassSuspensionLifecyclePanel classId="80000000-0000-4000-8000-000000000001" onBusyChange={setBusy} onBack={() => {}} />
        : <EnrollmentSuspensionPanel enrollmentId="70000000-0000-4000-8000-000000000001" onBusyChange={setBusy} onDirtyChange={setDirty} />}
    </main>
  </AuthProvider></QueryClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
