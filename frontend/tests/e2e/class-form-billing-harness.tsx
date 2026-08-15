import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClassFormDialog } from "@/components/classes/class-form-dialog";

function Harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ClassFormDialog
          class_={null}
          isSaving={false}
          isTeachersError={false}
          isTeachersLoading={false}
          onClose={() => undefined}
          onRetryTeachers={() => undefined}
          onSubmit={() => undefined}
          teachers={[]}
        />
      </QueryClientProvider>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
