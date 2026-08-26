import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScheduleGridSlide } from "@/components/layout/schedule-grid-slide";
import type { ScheduleSlot } from "@/components/layout/weekly-schedule-board";

type Occ = ScheduleSlot & {
  classId?: string;
  className: string;
  classCategory?: "GENERAL" | "SPECIALIZED" | "IELTS" | "CUSTOM" | null;
  gradeLevel?: number | null;
  /** Thiếu (undefined) = conflict legacy không xác định được giáo viên. */
  busyTeacherIds?: string[];
  busyAssistantIds?: string[];
};

const teacher = (id: string, name: string) => ({
  id,
  full_name: name,
  staff_type: "TEACHER" as const,
  is_active: true,
  phone: null,
  zalo_name: null,
  email: null,
});
const assistant = (id: string, name: string) => ({
  ...teacher(id, name),
  staff_type: "ASSISTANT" as const,
});

declare global {
  interface Window {
    __scheduleTest?: {
      setOccupied: (blocks: Occ[]) => void;
      setSelected: (teachers: string[], assistants: string[]) => void;
      /** Inject lỗi tải availability thật qua prop occupiedError; retry xóa lỗi. */
      setAvailabilityError: (message: string | null) => void;
      /** Chọn một giáo viên trong thanh phạm vi (tab). */
      selectTeacher: (name: string) => void;
      getState: () => {
        pressed: string[];
        detail: string;
        saved: { text: string; slots: ScheduleSlot[] } | null;
        alertText: string;
        confirmDisabled: string | null;
        availabilityError: string;
        retryCount: number;
        panelMode: string;
        activeTeacher: string | null;
      };
    };
  }
}

function Harness() {
  const [occupied, setOccupied] = useState<Occ[]>([]);
  const [teachers, setTeachers] = useState<string[]>(["t1", "t2"]);
  const [assistants, setAssistants] = useState<string[]>(["a1"]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [saved, setSaved] = useState<{ text: string; slots: ScheduleSlot[] } | null>(
    null,
  );

  const selectedTeachers = teachers.map((id) =>
    id === "t1"
      ? teacher("t1", "Cô Hạnh")
      : id === "t2"
        ? teacher("t2", "Thầy Phúc")
        : teacher(id, id),
  );
  const selectedAssistants = assistants.map((id) =>
    id === "a1" ? assistant("a1", "Cô Lan") : assistant(id, id),
  );

  const getState = useCallback(() => {
    const pressed = Array.from(
      document.querySelectorAll<HTMLElement>("button[aria-pressed='true']"),
    )
      .filter((el) => el.dataset.dayIndex !== undefined)
      .map((el) => `${el.dataset.dayIndex}:${el.dataset.timeIndex}`)
      .sort();
    const detail = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button[data-schedule-session-key] .font-body-ui",
      ),
    )
      .map(
        (el) =>
          (el.textContent ?? "")
            .replace(/(\d{2}:\d{2})/, " $1")
            .replace(/\s+/g, " ")
            .trim(),
      )
      .join(" | ");
    const emptyHint = detail
      ? ""
      : (document.querySelector("aside")?.textContent ?? "").includes(
            "Chưa chọn khung giờ nào",
          )
        ? "Chưa chọn khung giờ nào"
        : "";
    const activeTab = document.querySelector<HTMLElement>(
      "button[role='tab'][aria-selected='true']",
    );
    const panel = document.querySelector<HTMLElement>("[data-schedule-panel-mode]");
    return {
      pressed,
      detail: `${detail}${emptyHint}`.trim(),
      saved,
      alertText: Array.from(document.querySelectorAll<HTMLElement>("[role='alert']"))
        .map((el) => el.textContent?.trim() ?? "")
        .join(" | "),
      confirmDisabled: (() => {
        const btn = Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).find((b) => /áp dụng lịch|xác nhận/i.test(b.textContent ?? ""));
        return btn ? btn.getAttribute("disabled") : "missing";
      })(),
      availabilityError: availabilityError ?? "",
      retryCount,
      panelMode: panel?.getAttribute("data-schedule-panel-mode") ?? "",
      activeTeacher: activeTab?.getAttribute("data-teacher-scope") ?? null,
    };
  }, [saved, availabilityError, retryCount]);

  useEffect(() => {
    window.__scheduleTest = {
      setOccupied: (blocks) => setOccupied(blocks),
      setSelected: (t, a) => {
        setTeachers(t);
        setAssistants(a);
      },
      setAvailabilityError: (message) => {
        setAvailabilityError(message);
        if (message === null) {
          setRetryCount((count) => count + 1);
        }
      },
      selectTeacher: (name) => {
        const tab = Array.from(
          document.querySelectorAll<HTMLButtonElement>("button[role='tab']"),
        ).find((candidate) => candidate.textContent?.trim() === name);
        tab?.click();
      },
      getState,
    };
  }, [getState]);

  return (
    <StrictMode>
      <ScheduleGridSlide
        isOpen
        onClose={() => undefined}
        onSave={(next) => setSaved(next)}
        occupiedSlots={occupied}
        occupiedError={availabilityError}
        onRetryOccupied={() => {
          setAvailabilityError(null);
          setRetryCount((count) => count + 1);
        }}
        selectedTeachers={selectedTeachers}
        selectedAssistants={selectedAssistants}
      />
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
