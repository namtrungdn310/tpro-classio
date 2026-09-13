import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FeeDeadlineDialog } from "@/components/fees/fee-deadline-dialog";
import type { StudentFeeGroup } from "@/lib/fees/view-model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BillingScheduleDialog } from "@/components/students/billing-schedule-dialog";
import { BillingFeesBrowser } from "@/components/reports/billing-fees-browser";
import { BillingScheduleReport } from "@/components/reports/billing-schedule-report";
import { BillingDateField, type BillingDateSelection } from "@/components/students/billing-date-field";
import { ClassAdmissionDateDialog } from "@/components/classes/class-admission-date-dialog";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { ClassResponse } from "@/lib/types";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const params = new URLSearchParams(location.search);
const group = {
  student_name: "E2E Minh", records: [{
    id: params.get("fee") ?? "11111111-1111-4111-8111-111111111111", class_name: "E2E 6C1",
    status: "UNPAID", final_amount: 900000, paid_amount: 0, refunded_amount: 0,
    paid_date: null, due_date: "2026-09-01", adjusted_due_date: "2026-09-01",
  }],
} as unknown as StudentFeeGroup;

function Harness() {
  const [state, setState] = useState("open");
  if (params.has("fees")) return <QueryClientProvider client={client}><BillingFeesBrowser enrollmentId="22222222-2222-4222-8222-222222222222" /></QueryClientProvider>;
  if (params.has("report")) return <QueryClientProvider client={client}><BillingScheduleReport /></QueryClientProvider>;
  if (params.has("inline")) return <QueryClientProvider client={client}><InlineHarness /></QueryClientProvider>;
  if (state === "open" && params.has("class")) return <QueryClientProvider client={client}>
    <ClassHarness onDone={() => setState("saved")} />
  </QueryClientProvider>;
  if (state === "open" && new URLSearchParams(location.search).has("schedule")) {
    return <QueryClientProvider client={client}><BillingScheduleDialog
      enrollmentId={params.get("enrollment") ?? "22222222-2222-4222-8222-222222222222"} className="E2E 6C1"
      onClose={() => setState("closed")} onApplied={() => setState("saved")} /></QueryClientProvider>;
  }
  return state === "open" ? <FeeDeadlineDialog group={group}
    onClose={() => setState("closed")} onApplied={() => setState("saved")} />
    : <p role="status">{state}</p>;
}
function InlineHarness() {
  const enrollmentId = params.get("enrollment") ?? "22222222-2222-4222-8222-222222222222";
  const [saved, setSaved] = useState(false);
  const [selection, setSelection] = useState<BillingDateSelection | undefined>();
  const [open, setOpen] = useState(false);
  return <main className="p-6">{saved && <p role="status">saved</p>}<BillingDateField enrollmentId={enrollmentId}
    initialAnchor="2026-09-01" initialVersion={0}
    onReview={(next) => { setSelection(next); setOpen(true); }} />
    {open && <BillingScheduleDialog enrollmentId={enrollmentId} className="6C1"
      selection={selection} onClose={() => setOpen(false)} onApplied={() => { setOpen(false); setSaved(true); }} />}</main>;
}
function ClassHarness({ onDone }: { onDone: () => void }) {
  const query = useQuery({ queryKey: ["real-class", params.get("class")], queryFn: async () =>
    (await apiClient.get<ClassResponse>(`/classes/${params.get("class")}`)).data });
  if (!query.data) return <p role="status">Loading class</p>;
  return <ClassAdmissionDateDialog class_={query.data} newStartDate={params.get("start")!}
    onApplied={onDone} onClose={onDone} />;
}
createRoot(document.getElementById("root")!).render(<Harness />);
