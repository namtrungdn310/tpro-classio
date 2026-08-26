"use client";

import {
  RiArrowLeftSLine,
  RiCheckLine,
  RiCloseLine as X,
} from "react-icons/ri";
import type { TeacherOptionResponse } from "@/lib/types";
import type { ScheduleSlot } from "@/components/layout/weekly-schedule-board";
import {
  getSlotEffectiveAssistantIds,
  getSlotEffectiveTeacherIds,
} from "@/lib/classes/presentation";
import {
  getTeacherBusyClassNamesAcrossInterval,
  hasLegacyConflictAcrossInterval,
  LEGACY_CONFLICT_MESSAGE,
  timeToMinutes,
  type ScheduleConflictBlock,
} from "@/lib/classes/schedule-availability";

export const getScheduleSessionKey = (slot: { day: string; start: string; end: string }) =>
  `${slot.day}|${slot.start}|${slot.end}`;

interface ScheduleSessionPanelProps {
  /** Committed + preview slots rendered on the grid. */
  slots: ScheduleSlot[];
  /** Committed slots only — preview rows are not editable. */
  committedSlots: ScheduleSlot[];
  panelMode: "list" | "detail";
  activeSessionKey: string | null;
  selectedTeachers: TeacherOptionResponse[];
  selectedTeacherById: Map<string, TeacherOptionResponse>;
  selectedAssistantById: Map<string, TeacherOptionResponse>;
  /** Pool teacher ids the class may assign (fallback for legacy slots). */
  defaultTeacherIds: string[];
  conflictBlocks: ScheduleConflictBlock[];
  getSlotConflict: (
    slot: ScheduleSlot,
  ) => { busyTeachers: string[]; busyAssistants: string[] } | null;
  onOpenSession: (key: string) => void;
  onBackToList: () => void;
  onDeleteSlot: (day: ScheduleSlot["day"], start: string, end: string) => void;
  onToggleTeacherAssignment: (
    day: ScheduleSlot["day"],
    start: string,
    end: string,
    teacherId: string,
    add: boolean,
  ) => void;
  onToggleAssistantAssignment?: (
    day: ScheduleSlot["day"],
    start: string,
    end: string,
    assistantId: string,
    add: boolean,
  ) => void;
  /** Keep the original compact right-hand list for class add/edit. */
  legacyList?: boolean;
  /** Tên lớp đang tạo/chỉnh để hiển thị nhận diện. */
  classLabel?: string;
  /** Danh sách buổi ban đầu khi mở dialog để nhận diện buổi mới thêm. */
  initialSlots?: ScheduleSlot[];
}

function formatTeacherNames(ids: string[], byId: Map<string, TeacherOptionResponse>) {
  const names = ids
    .map((id) => byId.get(id)?.full_name ?? "Giáo viên đã chọn")
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length <= 2) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
}

export function ScheduleSessionPanel({
  slots,
  committedSlots,
  panelMode,
  activeSessionKey,
  selectedTeachers,
  selectedTeacherById,
  selectedAssistantById,
  defaultTeacherIds,
  conflictBlocks,
  getSlotConflict,
  onOpenSession,
  onBackToList,
  onDeleteSlot,
  onToggleTeacherAssignment,
  onToggleAssistantAssignment,
  legacyList = false,
  classLabel,
  initialSlots = [],
}: ScheduleSessionPanelProps) {
  const isSlotNew = (candidateSlot: ScheduleSlot) => {
    if (!initialSlots || initialSlots.length === 0) return false;
    return !initialSlots.some(
      (init) =>
        init.day === candidateSlot.day &&
        init.start === candidateSlot.start &&
        init.end === candidateSlot.end,
    );
  };
  const activeSlot =
    activeSessionKey !== null
      ? slots.find((slot) => getScheduleSessionKey(slot) === activeSessionKey)
      : undefined;
  const activeCommitted =
    activeSessionKey !== null
      ? committedSlots.find(
          (slot) => getScheduleSessionKey(slot) === activeSessionKey,
        )
      : undefined;
  const showDetail =
    panelMode === "detail" && activeSlot !== undefined && activeCommitted !== undefined;

  const assignedTeacherIds = activeCommitted
    ? getSlotEffectiveTeacherIds(activeCommitted, defaultTeacherIds).filter((id) =>
        selectedTeacherById.has(id),
      )
    : [];
  const assignedAssistantIds = activeCommitted
    ? getSlotEffectiveAssistantIds(activeCommitted)
    : [];
  const allAssistants = Array.from(selectedAssistantById.values());
  const slotStartMinutes = activeSlot ? timeToMinutes(activeSlot.start) : 0;
  const slotEndMinutes = activeSlot ? timeToMinutes(activeSlot.end) : 0;
  const legacyAcross = showDetail
    ? hasLegacyConflictAcrossInterval(
        conflictBlocks,
        activeSlot.day,
        slotStartMinutes,
        slotEndMinutes,
      )
    : false;
  const conflict = showDetail && activeCommitted ? getSlotConflict(activeCommitted) : null;
  const busyTeacherNames = conflict?.busyTeachers.map(
    (id) => selectedTeacherById.get(id)?.full_name ?? "đã chọn",
  );
  const busyAssistantNames = conflict?.busyAssistants.map(
    (id) => selectedAssistantById.get(id)?.full_name ?? "đã chọn",
  );

  if (legacyList) {
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-schedule-panel-mode="list"
        data-schedule-session-list="true"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2.5">
          <h4 className="section-title-text text-gray-900">
            Danh sách chi tiết
          </h4>
          <span className="inline-flex items-center rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
            {classLabel || "Lớp mới"}
          </span>
        </div>
        {slots.length === 0 ? (
          <p className="helper-text px-3 py-3 italic text-gray-400">
            Chưa chọn khung giờ nào.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-stretch gap-2 overflow-y-auto px-3 py-3">
            {slots.map((slot, index) => {
              const key = getScheduleSessionKey(slot);
              const committed = committedSlots.find(
                (candidate) => getScheduleSessionKey(candidate) === key,
              );
              const effectiveTeacherIds = getSlotEffectiveTeacherIds(
                committed ?? slot,
                defaultTeacherIds,
              );
              const assignedTeacherIds = effectiveTeacherIds.filter((id) =>
                selectedTeacherById.has(id),
              );
              // A slot with no explicit assistant_ids (legacy class-level
              // storage) falls back to the class's selected assistants so the
              // edit list always surfaces the expected trợ giảng.  An explicit
              // empty array stays empty.
              const slotForAssistant = committed ?? slot;
              const slotHasExplicitAssistant =
                slotForAssistant.assistant_ids !== undefined;
              const assignedAssistantIds = (
                slotHasExplicitAssistant
                  ? getSlotEffectiveAssistantIds(slotForAssistant)
                  : [...selectedAssistantById.keys()]
              ).filter((id) => selectedAssistantById.has(id));
              const startMinutes = timeToMinutes(slot.start);
              const endMinutes = timeToMinutes(slot.end);
              const legacyConflict = hasLegacyConflictAcrossInterval(
                conflictBlocks,
                slot.day,
                startMinutes,
                endMinutes,
              );
              const slotConflict = committed ? getSlotConflict(committed) : null;

              return (
                <div
                  key={`${key}-${index}`}
                  className={`flex flex-col gap-1 rounded-lg border bg-white px-2 py-1.5 ${
                    slotConflict
                      ? "border-amber-300 bg-amber-50/60"
                      : "border-gray-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-body-ui flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap text-[13px] font-semibold leading-4 text-gray-800">
                      <span>{slot.day} ({slot.start}-{slot.end})</span>
                      {isSlotNew(slot) ? (
                        <span
                          aria-label="Buổi mới thêm"
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                        />
                      ) : null}
                    </span>
                    {committed ? (
                      <button
                        type="button"
                        aria-label={`Xoá buổi ${slot.day} ${slot.start}-${slot.end}`}
                        onClick={() =>
                          onDeleteSlot(slot.day, slot.start, slot.end)
                        }
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  {committed ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-start gap-1.5">
                        <span className="w-6 shrink-0 pt-0.5 text-[11px] font-semibold text-gray-500">
                          GV:
                        </span>
                        <div className="flex flex-1 flex-wrap items-center gap-1.5">
                          {selectedTeachers.length === 0 ? (
                            <p className="text-[12px] font-medium leading-4 text-destructive">
                              Lớp chưa chọn giáo viên.
                            </p>
                          ) : (
                            selectedTeachers.map((teacher) => {
                              const assigned = assignedTeacherIds.includes(teacher.id);
                              const busyNames = legacyConflict
                                ? []
                                : getTeacherBusyClassNamesAcrossInterval(
                                    conflictBlocks,
                                    slot.day,
                                    startMinutes,
                                    endMinutes,
                                    teacher.id,
                                  );
                              const busy = legacyConflict || busyNames.length > 0;
                              const isLastTeacher =
                                assigned && assignedTeacherIds.length === 1;
                              const canToggle = assigned
                                ? !isLastTeacher
                                : !busy;
                              return (
                                <button
                                  key={teacher.id}
                                  type="button"
                                  data-schedule-panel-teacher={teacher.id}
                                  aria-pressed={assigned}
                                  aria-disabled={assigned && !canToggle || undefined}
                                  disabled={assigned ? isLastTeacher : !canToggle}
                                  title={
                                    isLastTeacher
                                      ? "Giáo viên bắt buộc — mỗi buổi phải còn ít nhất một giáo viên"
                                      : busy
                                        ? "Giáo viên đang bận ở khung giờ này"
                                        : assigned
                                          ? "Bỏ phân công giáo viên này"
                                          : "Thêm giáo viên đồng giảng"
                                  }
                                  onClick={() =>
                                    onToggleTeacherAssignment(
                                      slot.day,
                                      slot.start,
                                      slot.end,
                                      teacher.id,
                                      !assigned,
                                    )
                                  }
                                  className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed ${
                                    assigned
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : busy
                                        ? "border-gray-200 bg-white text-gray-400"
                                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                  }`}
                                >
                                  {assigned && isLastTeacher ? (
                                    <span aria-hidden="true" className="text-[10px] leading-none">
                                      ✦
                                    </span>
                                  ) : null}
                                  {teacher.full_name}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {allAssistants.length > 0 ? (
                        <div className="flex items-start gap-1.5">
                          <span className="w-6 shrink-0 pt-0.5 text-[11px] font-semibold text-gray-500">
                            TG:
                          </span>
                          <div className="flex flex-1 flex-wrap items-center gap-1.5">
                            {allAssistants.map((assistant) => {
                              const assigned = assignedAssistantIds.includes(assistant.id);
                              const busyNames = legacyConflict
                                ? []
                                : getTeacherBusyClassNamesAcrossInterval(
                                    conflictBlocks,
                                    slot.day,
                                    startMinutes,
                                    endMinutes,
                                    assistant.id,
                                  );
                              const busy = legacyConflict || busyNames.length > 0;
                              const canToggle = !busy;
                              return (
                                <button
                                  key={assistant.id}
                                  type="button"
                                  data-schedule-panel-assistant={assistant.id}
                                  aria-pressed={assigned}
                                  disabled={!canToggle}
                                  title={
                                    busy
                                      ? "Trợ giảng đang bận ở khung giờ này"
                                      : assigned
                                        ? "Bỏ phân công trợ giảng này khỏi buổi"
                                        : "Phân công trợ giảng vào buổi này"
                                  }
                                  onClick={() =>
                                    onToggleAssistantAssignment?.(
                                      slot.day,
                                      slot.start,
                                      slot.end,
                                      assistant.id,
                                      !assigned,
                                    )
                                  }
                                  className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed ${
                                    assigned
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : busy
                                        ? "border-gray-200 bg-white text-gray-400"
                                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                  }`}
                                >
                                  {assistant.full_name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {assignedTeacherIds.length === 0 ? (
                        <p role="alert" className="text-[12px] font-medium leading-4 text-destructive">
                          Buổi này chưa có giáo viên. Chọn ít nhất một giáo viên hoặc xóa buổi.
                        </p>
                      ) : null}
                      {slotConflict ? (
                        <p role="alert" className="text-[12px] font-medium leading-4 text-amber-800">
                          Nhân sự đã bận ở khung giờ này. Vui lòng chọn lại giáo viên hoặc đổi giờ.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-schedule-panel-mode={panelMode}
    >
      <div
        className={`flex min-h-0 flex-1 flex-col ${showDetail ? "invisible" : ""}`}
        aria-hidden={showDetail || undefined}
        data-schedule-session-list="true"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-3 py-2.5">
          <h4 className="section-title-text text-gray-900">
            Buổi học
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-soft px-1.5 text-[12px] font-semibold leading-none text-primary">
              {slots.length}/4
            </span>
          </h4>
          <span className="inline-flex items-center rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
            {classLabel || "Lớp mới"}
          </span>
        </div>

        {slots.length === 0 ? (
          <p className="helper-text px-3 py-3 italic text-gray-400">
            Chưa chọn khung giờ nào.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {slots.map((slot, index) => {
              const key = getScheduleSessionKey(slot);
              const committed = committedSlots.find(
                (candidate) => getScheduleSessionKey(candidate) === key,
              );
              const assignedTeacherIds = committed
                ? getSlotEffectiveTeacherIds(committed, defaultTeacherIds).filter(
                    (id) => selectedTeacherById.has(id),
                  )
                : [];
              const names = formatTeacherNames(assignedTeacherIds, selectedTeacherById);
              const slotConflict = committed ? getSlotConflict(committed) : null;
              return (
                <div
                  key={`${key}-${index}`}
                  className={`border-b border-gray-100 last:border-b-0 ${
                    slotConflict ? "bg-amber-50/50" : ""
                  }`}
                >
                  <button
                    type="button"
                    disabled={!committed}
                    data-schedule-session-key={key}
                    aria-label={
                      committed
                        ? `Mở phân công buổi ${slot.day} ${slot.start}-${slot.end}`
                        : undefined
                    }
                    onClick={() => onOpenSession(key)}
                    className={`flex min-h-[56px] w-full min-w-0 items-center gap-2 border-l-2 px-3 py-2 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 disabled:hover:bg-transparent ${
                      activeSessionKey === key ? "border-primary bg-primary-soft/45" : "border-transparent"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-body-ui flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold leading-5 text-gray-800">
                        <span className="shrink-0">{slot.day}</span>
                        <span className="tabular-nums">
                          {slot.start}–{slot.end}
                        </span>
                        {isSlotNew(slot) ? (
                          <span
                            aria-label="Buổi mới thêm"
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                          />
                        ) : null}
                      </span>
                      {slotConflict ? (
                        <span className="mt-0.5 block text-[12px] font-medium leading-4 text-amber-800">
                          Xung đột lịch nhân sự
                        </span>
                      ) : names ? (
                        <span className="mt-0.5 block truncate text-[12px] leading-4 text-gray-500">
                          {names}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[12px] leading-4 text-gray-400">
                          Đang chọn khung giờ…
                        </span>
                      )}
                    </span>
                    <span aria-hidden="true" className={`text-lg leading-none text-gray-400 ${committed ? "" : "invisible"}`}>
                      ›
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showDetail && activeSlot && activeCommitted ? (
        <div
          className="schedule-panel-enter motion-reduce:animate-none absolute inset-0 flex min-h-0 flex-col bg-white"
          data-schedule-session-detail={getScheduleSessionKey(activeSlot)}
        >
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-2">
            <button
              type="button"
              onClick={onBackToList}
              aria-label="Quay lại danh sách buổi"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-600 transition hover:bg-slate-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <RiArrowLeftSLine aria-hidden="true" className="h-5 w-5" />
            </button>
            <h4 className="section-title-text min-w-0 flex-1 truncate text-gray-900">
              Phân công buổi
            </h4>
          </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
            <div className="border-b border-gray-100 pb-3">
              <p className="font-body-ui text-[16px] font-semibold leading-6 text-gray-900">
                {activeSlot.day} · <span className="tabular-nums">{activeSlot.start}–{activeSlot.end}</span>
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <p className="helper-text font-semibold text-slate-500">Giáo viên</p>
              {selectedTeachers.length === 0 ? (
                <p className="text-[13px] font-medium leading-4 text-destructive">
                  Lớp chưa chọn giáo viên nào.
                </p>
              ) : (
                selectedTeachers.map((teacher) => {
                  const assigned = assignedTeacherIds.includes(teacher.id);
                  const busyClassNames = legacyAcross
                    ? []
                    : getTeacherBusyClassNamesAcrossInterval(
                        conflictBlocks,
                        activeSlot.day,
                        slotStartMinutes,
                        slotEndMinutes,
                        teacher.id,
                      );
                  const busy = legacyAcross || busyClassNames.length > 0;
                  const canToggle = assigned
                    ? assignedTeacherIds.length > 1
                    : !busy;
                  const stateText = assigned
                    ? busy
                      ? `Đã chọn · đang bận ${busyClassNames.slice(0, 2).join(", ")}`
                      : "Đã chọn"
                    : legacyAcross
                      ? LEGACY_CONFLICT_MESSAGE
                      : busy
                        ? `Bận · ${busyClassNames.slice(0, 2).join(", ")}`
                        : "Rảnh";
                  return (
                    <button
                      key={teacher.id}
                      type="button"
                      data-schedule-panel-teacher={teacher.id}
                      aria-pressed={assigned}
                      disabled={!canToggle}
                      title={
                        assigned
                          ? canToggle
                            ? "Bỏ phân công giáo viên này khỏi buổi"
                            : "Mỗi buổi phải còn ít nhất một giáo viên"
                          : busy
                            ? "Giáo viên đang bận ở buổi này"
                            : "Thêm giáo viên đồng giảng"
                      }
                      onClick={() =>
                        onToggleTeacherAssignment(
                          activeSlot.day,
                          activeSlot.start,
                          activeSlot.end,
                          teacher.id,
                          !assigned,
                        )
                      }
                      className={`flex min-h-10 min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                        assigned
                          ? "border-primary bg-primary text-primary-foreground"
                          : busy
                            ? "border-gray-200 bg-gray-50 text-gray-400"
                            : "border-gray-200 bg-white hover:border-primary/30 hover:bg-primary-soft/40"
                      } ${canToggle || !assigned ? "cursor-pointer" : "cursor-not-allowed"}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold leading-none ${
                          assigned
                            ? "border-primary-foreground/50 bg-white text-primary"
                            : "border-gray-300 text-gray-400"
                        }`}
                      >
                        {assigned ? (
                          <RiCheckLine className="h-3 w-3" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        )}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] font-medium leading-4 ${
                          assigned ? "text-primary-foreground" : "text-gray-800"
                        }`}
                      >
                        {teacher.full_name}
                      </span>
                      <span
                        className={`shrink-0 text-[12px] font-medium leading-4 ${
                          assigned
                            ? "text-primary-foreground"
                            : busy
                              ? "text-gray-500"
                              : "text-emerald-700"
                        }`}
                      >
                        {stateText}
                      </span>
                    </button>
                  );
                })
              )}
              {assignedTeacherIds.length === 0 ? (
                <p role="alert" className="text-[12px] font-medium leading-4 text-destructive">
                  Buổi này chưa có giáo viên. Chọn ít nhất một giáo viên hoặc xóa buổi.
                </p>
              ) : null}
            </div>

            {allAssistants.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="helper-text font-semibold text-slate-500">Trợ giảng (tùy chọn)</p>
                {allAssistants.map((assistant) => {
                  const assigned = assignedAssistantIds.includes(assistant.id);
                  const busyClassNames = legacyAcross
                    ? []
                    : getTeacherBusyClassNamesAcrossInterval(
                        conflictBlocks,
                        activeSlot.day,
                        slotStartMinutes,
                        slotEndMinutes,
                        assistant.id,
                      );
                  const busy = legacyAcross || busyClassNames.length > 0;
                  const canToggle = !busy;
                  const stateText = assigned
                    ? busy
                      ? `Đã chọn · đang bận ${busyClassNames.slice(0, 2).join(", ")}`
                      : "Đã chọn"
                    : legacyAcross
                      ? LEGACY_CONFLICT_MESSAGE
                      : busy
                        ? `Bận · ${busyClassNames.slice(0, 2).join(", ")}`
                        : "Rảnh";
                  return (
                    <button
                      key={assistant.id}
                      type="button"
                      data-schedule-panel-assistant={assistant.id}
                      aria-pressed={assigned}
                      disabled={!canToggle}
                      title={
                        assigned
                          ? "Bỏ phân công trợ giảng này khỏi buổi"
                          : busy
                            ? "Trợ giảng đang bận ở buổi này"
                            : "Phân công trợ giảng vào buổi này"
                      }
                      onClick={() =>
                        onToggleAssistantAssignment?.(
                          activeSlot.day,
                          activeSlot.start,
                          activeSlot.end,
                          assistant.id,
                          !assigned,
                        )
                      }
                      className={`flex min-h-10 min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                        assigned
                          ? "border-primary bg-primary text-primary-foreground"
                          : busy
                            ? "border-gray-200 bg-gray-50 text-gray-400"
                            : "border-gray-200 bg-white hover:border-primary/30 hover:bg-primary-soft/40"
                      } ${canToggle ? "cursor-pointer" : "cursor-not-allowed"}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold leading-none ${
                          assigned
                            ? "border-primary-foreground/50 bg-white text-primary"
                            : "border-gray-300 text-gray-400"
                        }`}
                      >
                        {assigned ? (
                          <RiCheckLine className="h-3 w-3" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        )}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] font-medium leading-4 ${
                          assigned ? "text-primary-foreground" : "text-gray-800"
                        }`}
                      >
                        {assistant.full_name}
                      </span>
                      <span
                        className={`shrink-0 text-[12px] font-medium leading-4 ${
                          assigned
                            ? "text-primary-foreground"
                            : busy
                              ? "text-gray-500"
                              : "text-emerald-700"
                        }`}
                      >
                        {stateText}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {busyAssistantNames && busyAssistantNames.length > 0 ? (
              <p role="alert" className="text-[12px] font-medium leading-4 text-amber-800">
                Trợ giảng {busyAssistantNames.join(", ")} hiện đã bận khung giờ này.
              </p>
            ) : null}
            {busyTeacherNames && busyTeacherNames.length > 0 ? (
              <p role="alert" className="text-[12px] font-medium leading-4 text-amber-800">
                Giáo viên {busyTeacherNames.join(", ")} hiện đã bận khung giờ này.
              </p>
            ) : null}

            <div className="mt-auto border-t border-gray-200 pt-3">
              <button
                type="button"
                onClick={() =>
                  onDeleteSlot(activeSlot.day, activeSlot.start, activeSlot.end)
                }
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-destructive/40 bg-white text-[13px] font-semibold text-destructive transition hover:bg-destructive-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
              >
                <X aria-hidden="true" className="h-4 w-4" />
                Xóa buổi khỏi lịch
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
