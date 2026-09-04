"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  RiAlertLine as AlertCircle,
  RiCloseLine as X,
  RiLoader4Line as LoaderCircle,
  RiRefreshLine as RefreshCw,
} from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { InlineFormError } from "@/components/ui/inline-form-error";
import {
  applyScheduleCellClick,
  applyScheduleDragPreview,
  buildScheduleGridGeometry,
  createScheduleDragPreview,
  MIN_SCHEDULE_SESSION_BLOCKS,
  resolveScheduleBoundary,
  scheduleBoundaryToMinutes,
  updateScheduleDragSession,
  type ScheduleDragPreview,
  type ScheduleDragSession,
  type ScheduleGridGeometry,
  type ScheduleClickAnchor,
  type ScheduleClickReason,
} from "@/lib/classes/schedule-drag";
import {
  getTeacherBlockAvailability,
  isClassScheduleCellBlocked,
  isTeacherFreeAcrossInterval,
  isLegacyConflictBlock,
  LEGACY_CONFLICT_MESSAGE,
  minutesToTime,
  timeToMinutes,
  type ScheduleConflictBlock,
} from "@/lib/classes/schedule-availability";
import { abbreviateClassName } from "@/lib/utils/class-groups";
import {
  getClassGroupInfoForRecord,
  getSlotEffectiveAssistantIds,
  getSlotEffectiveTeacherIds,
} from "@/lib/classes/presentation";
import type { ClassCategory, ClassResponse, TeacherOptionResponse } from "@/lib/types";
import {
  DAYS_OF_WEEK,
  TIME_BLOCKS,
  type ScheduleSlot,
} from "@/components/layout/weekly-schedule-board";
import { ScheduleTeacherScope } from "@/components/layout/schedule-teacher-scope";
import {
  getScheduleSessionKey,
  ScheduleSessionPanel,
} from "@/components/layout/schedule-session-panel";
import {
  ScheduleWeekGrid,
  type ScheduleCellDescriptor,
} from "@/components/layout/schedule-week-grid";
import {
  canRevealSlidePanel,
  getSlideBackdropStyle,
  getSlidePanelUnmountDelay,
  getSlidePanelStyle,
  useSlidePanelMotion,
} from "@/lib/ui/slide-panel-motion";

interface OccupiedScheduleSlot extends ScheduleSlot {
  classId?: string;
  className: string;
  classCategory?: ClassCategory | null;
  gradeLevel?: number | null;
  busyTeacherIds?: string[];
  busyAssistantIds?: string[];
}

const MAX_OCCUPIED_LANES = 2;
const MAX_WEEKLY_CLASS_SLOTS = 4;

const unpackSlotsToBlocks = (currentSlots: ScheduleSlot[]): string[] => {
  const blocks: string[] = [];
  currentSlots.forEach((slot) => {
    const startMinutes = timeToMinutes(slot.start);
    const endMinutes = timeToMinutes(slot.end);
    TIME_BLOCKS.forEach((block) => {
      const blockStart = timeToMinutes(block);
      if (startMinutes < blockStart + 30 && blockStart < endMinutes) {
        blocks.push(`${slot.day}-${block}`);
      }
    });
  });
  return blocks;
};

const getMergedSlots = (blocks: string[]): ScheduleSlot[] => {
  const merged: ScheduleSlot[] = [];
  DAYS_OF_WEEK.forEach((day) => {
    const dayBlocks = blocks
      .filter((block) => block.startsWith(`${day}-`))
      .map((block) => block.split("-")[1])
      .sort((left, right) => timeToMinutes(left) - timeToMinutes(right));

    let currentStart: string | null = null;
    let currentEndMinutes: number | null = null;
    dayBlocks.forEach((blockTime) => {
      const blockStartMinutes = timeToMinutes(blockTime);
      if (currentStart === null || currentEndMinutes === null) {
        currentStart = blockTime;
        currentEndMinutes = blockStartMinutes + 30;
      } else if (blockStartMinutes === currentEndMinutes) {
        currentEndMinutes = blockStartMinutes + 30;
      } else {
        merged.push({
          day,
          start: currentStart,
          end: minutesToTime(currentEndMinutes),
        });
        currentStart = blockTime;
        currentEndMinutes = blockStartMinutes + 30;
      }
    });

    if (currentStart !== null && currentEndMinutes !== null) {
      merged.push({
        day,
        start: currentStart,
        end: minutesToTime(currentEndMinutes),
      });
    }
  });

  return merged.sort((left, right) => {
    if (left.day !== right.day) {
      return DAYS_OF_WEEK.indexOf(left.day) - DAYS_OF_WEEK.indexOf(right.day);
    }
    return timeToMinutes(left.start) - timeToMinutes(right.start);
  });
};

const getScheduleBlockKey = (dayIndex: number, blockIndex: number) =>
  `${DAYS_OF_WEEK[dayIndex]}-${TIME_BLOCKS[blockIndex]}`;

const getScheduleDraftSnapshot = (slots: ScheduleSlot[]) =>
  JSON.stringify(
    slots
      .map((slot) => ({
        day: slot.day,
        start: slot.start,
        end: slot.end,
        teacher_ids: [...(slot.teacher_ids ?? [])].sort(),
        assistant_ids: [...(slot.assistant_ids ?? [])].sort(),
      }))
      .sort((left, right) =>
        `${left.day}|${left.start}|${left.end}`.localeCompare(
          `${right.day}|${right.start}|${right.end}`,
        ),
      ),
  );

/**
 * Tìm slot đã commit cùng ngày giao khoảng với slot mới, ưu tiên slot có
 * diện tích trùng lớn nhất — giữ nguyên phân công nhân sự khi kéo đổi biên
 * giờ (không phụ thuộc exact day/start/end).
 */
const findOverlappingCommittedSlot = (
  committedSlots: ScheduleSlot[],
  nextSlot: ScheduleSlot,
): ScheduleSlot | undefined => {
  const nextStart = timeToMinutes(nextSlot.start);
  const nextEnd = timeToMinutes(nextSlot.end);
  let best: ScheduleSlot | undefined;
  let bestOverlap = 0;
  for (const candidate of committedSlots) {
    if (candidate.day !== nextSlot.day) continue;
    const candidateStart = timeToMinutes(candidate.start);
    const candidateEnd = timeToMinutes(candidate.end);
    const overlap =
      Math.min(nextEnd, candidateEnd) - Math.max(nextStart, candidateStart);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = candidate;
    }
  }
  return best;
};

type ErasedSessionLineage = {
  day: string;
  start: string;
  end: string;
  teacher_ids: string[];
  assistant_ids: string[];
  /** Chỉ áp dụng lineage lại khi tô trong cùng phạm vi giáo viên này. */
  scopeTeacherId: string | null;
};

/**
 * Tìm session đã xóa cùng ngày giao khoảng lớn nhất với slot mới — lineage
 * theo ĐÚNG session/interval, không lấy nhầm phân công của buổi khác cùng
 * ngày. Chỉ áp dụng khi người dùng vẫn đang tô cho cùng một giáo viên.
 */
const findLineageSession = (
  lineage: ReadonlyArray<ErasedSessionLineage>,
  nextSlot: ScheduleSlot,
  scopeTeacherId: string | null,
):
  | { teacher_ids: string[]; assistant_ids: string[] }
  | undefined => {
  const nextStart = timeToMinutes(nextSlot.start);
  const nextEnd = timeToMinutes(nextSlot.end);
  let best: { teacher_ids: string[]; assistant_ids: string[] } | undefined;
  let bestOverlap = 0;
  for (const candidate of lineage) {
    if (candidate.day !== nextSlot.day) continue;
    if (candidate.scopeTeacherId !== scopeTeacherId) continue;
    const candidateStart = timeToMinutes(candidate.start);
    const candidateEnd = timeToMinutes(candidate.end);
    const overlap =
      Math.min(nextEnd, candidateEnd) - Math.max(nextStart, candidateStart);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = {
        teacher_ids: candidate.teacher_ids,
        assistant_ids: candidate.assistant_ids,
      };
    }
  }
  return best;
};

const getBlockedClassColor = (slot: OccupiedScheduleSlot) => {
  return getClassGroupInfoForRecord({
    name: slot.className,
    class_category: slot.classCategory ?? null,
    grade_level: slot.gradeLevel ?? null,
  } as ClassResponse).color;
};

const TIME_COL_WIDTH = 64;

const getOccupiedSlotStyle = (
  slot: { day: string; start: string; end: string },
  laneCount: number,
  laneIndex: number,
  extendToEndpoint: boolean = false,
) => {
  const gridStart = timeToMinutes(TIME_BLOCKS[0]);
  const gridEnd = timeToMinutes(TIME_BLOCKS[TIME_BLOCKS.length - 1]) + 30;
  const gridDuration = gridEnd - gridStart;
  const slotStart = Math.max(gridStart, timeToMinutes(slot.start));
  const rawEnd =
    timeToMinutes(slot.end) +
    (extendToEndpoint && TIME_BLOCKS.includes(slot.end) ? 30 : 0);
  const slotEnd = Math.min(gridEnd, rawEnd);
  const dayIndex = DAYS_OF_WEEK.findIndex((day) => day === slot.day);
  const normalizedLaneIndex = Math.min(Math.max(0, laneIndex), laneCount - 1);

  return {
    style: {
      left: `calc(${TIME_COL_WIDTH}px + ((100% - ${TIME_COL_WIDTH}px) / 7) * ${dayIndex} + 4px + (((100% - ${TIME_COL_WIDTH}px) / 7 - 8px) / ${laneCount}) * ${normalizedLaneIndex})`,
      top: `calc(${((slotStart - gridStart) / gridDuration) * 100}% + 2px)`,
      width: `calc(((100% - ${TIME_COL_WIDTH}px) / 7 - 8px) / ${laneCount} - 2px)`,
      height: `calc(${((slotEnd - slotStart) / gridDuration) * 100}% - 4px)`,
    },
  };
};

interface ScheduleGridSlideProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (schedule: { text: string; slots: ScheduleSlot[] } | null) => void;
  currentValue?: { text: string; slots: ScheduleSlot[] } | null;
  occupiedSlots?: OccupiedScheduleSlot[];
  /** Đang tải lịch bận từ backend (availability). */
  occupiedLoading?: boolean;
  /** Lỗi tải lịch bận — chặn xác nhận tới khi retry thành công. */
  occupiedError?: string | null;
  onRetryOccupied?: () => void;
  /** Pool giáo viên ĐÃ CHỌN cho lớp, dùng để gán theo từng buổi. */
  selectedTeachers?: TeacherOptionResponse[];
  /** Pool trợ giảng ĐÃ CHỌN cho lớp (có thể rỗng). */
  selectedAssistants?: TeacherOptionResponse[];
  /** Tên lớp đang tạo/chỉnh, dùng để nhận diện block của lớp hiện tại. */
  classLabel?: string;
  /**
   * Class forms use a class-centric grid. The legacy teacher-availability
   * presentation remains opt-in for focused availability tooling and tests.
   */
  scheduleMode?: "class-schedule" | "teacher-availability";
}

export function ScheduleGridSlide({
  isOpen,
  onClose,
  onSave,
  currentValue,
  occupiedSlots = [],
  occupiedLoading = false,
  occupiedError = null,
  onRetryOccupied,
  selectedTeachers = [],
  selectedAssistants = [],
  classLabel = "Lớp này",
  scheduleMode = "teacher-availability",
}: ScheduleGridSlideProps) {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [dragPreview, setDragPreview] = useState<ScheduleDragPreview | null>(null);
  const [clickAnchor, setClickAnchor] = useState<ScheduleClickAnchor | null>(null);
  const [clickMessage, setClickMessage] = useState<string | null>(null);
  const [isScheduleDragging, setIsScheduleDragging] = useState(false);
  const [slotLimitMessage, setSlotLimitMessage] = useState(false);
  const [focusedCell, setFocusedCell] = useState({ dayIndex: 0, timeIndex: 0 });
  const [activeTeacherId, setActiveTeacherId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"list" | "detail">("list");
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scheduleGridRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [initialScheduleSnapshot, setInitialScheduleSnapshot] = useState("[]");
  const [initialSlots, setInitialSlots] = useState<ScheduleSlot[]>([]);
  const requestCloseRef = useRef<() => void>(() => undefined);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const dragSessionRef = useRef<ScheduleDragSession | null>(null);
  const dragGridGeometryRef = useRef<ScheduleGridGeometry | null>(null);
  const dragGridGeometryDirtyRef = useRef(true);
  const dragGridGeometryVersionRef = useRef(0);
  const pointerStartRef = useRef<{
    pointerId: number;
    dayIndex: number;
    timeIndex: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const pointerMovedRef = useRef(false);
  const backdropPointerDownRef = useRef(false);
  const pointerGestureRef = useRef(false);
  const sessionLineageRef = useRef<ErasedSessionLineage[]>([]);
  const titleId = useId();
  const { durationMs: transitionDuration, isReady: isMotionReady } =
    useSlidePanelMotion(dialogRef, shouldRender);

  useEffect(() => {
    let unmountTimer: ReturnType<typeof setTimeout> | undefined;

    if (isOpen) {
      setShouldRender(true);
    } else {
      setIsVisible(false);
      if (!shouldRender) return;

      const closeTransitionDuration = getSlidePanelUnmountDelay(
        transitionDuration,
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
      unmountTimer = setTimeout(() => {
        setShouldRender(false);
      }, closeTransitionDuration);
    }

    return () => {
      if (unmountTimer) clearTimeout(unmountTimer);
    };
  }, [isOpen, shouldRender, transitionDuration]);

  useEffect(() => {
    if (
      !canRevealSlidePanel({
        isOpen,
        isRendered: shouldRender,
        isReady: isMotionReady,
      })
    ) {
      return;
    }

    let revealFrame = 0;
    const mountFrame = window.requestAnimationFrame(() => {
      revealFrame = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(mountFrame);
      window.cancelAnimationFrame(revealFrame);
    };
  }, [isMotionReady, isOpen, shouldRender]);

  // Load current values
  useEffect(() => {
    if (isOpen) {
      const init = currentValue && Array.isArray(currentValue.slots) ? currentValue.slots : [];
      setSlots(init);
      setInitialSlots(init);
      setSlotLimitMessage(false);
      setClickAnchor(null);
      setClickMessage(null);
      setPanelMode("list");
      setActiveSessionKey(null);
      setDiscardPrompt(false);
      setInitialScheduleSnapshot(getScheduleDraftSnapshot(init));
      sessionLineageRef.current = [];
      setFocusedCell({ dayIndex: 0, timeIndex: 0 });
      setActiveTeacherId(null);
    }
  }, [currentValue, isOpen]);

  const scopeKey =
    activeTeacherId !== null ? `teacher-${activeTeacherId}` : "overview";

  // Geometry is deliberately invalidated by layout signals instead of being
  // rebuilt for every raw pointer event. The scope key re-attaches the
  // observers after a teacher switch remounts the grid subtree.
  useEffect(() => {
    if (!isOpen) return;
    const grid = scheduleGridRef.current;
    if (!grid) return;

    const invalidateGeometry = () => {
      dragGridGeometryDirtyRef.current = true;
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(invalidateGeometry);

    resizeObserver?.observe(grid);
    grid
      .querySelectorAll<HTMLElement>(
        '[data-day-index="0"][data-time-index], [data-time-index="0"][data-day-index]',
      )
      .forEach((element) => resizeObserver?.observe(element));

    window.addEventListener("resize", invalidateGeometry, { passive: true });
    window.visualViewport?.addEventListener("resize", invalidateGeometry, {
      passive: true,
    });
    window.visualViewport?.addEventListener("scroll", invalidateGeometry, {
      passive: true,
    });
    document.fonts?.addEventListener("loadingdone", invalidateGeometry);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", invalidateGeometry);
      window.visualViewport?.removeEventListener("resize", invalidateGeometry);
      window.visualViewport?.removeEventListener("scroll", invalidateGeometry);
      document.fonts?.removeEventListener("loadingdone", invalidateGeometry);
      dragGridGeometryDirtyRef.current = true;
    };
  }, [isOpen, scopeKey]);

  const releasePointerCapture = useCallback((pointerId: number) => {
    const grid = scheduleGridRef.current;
    if (!grid) return;
    if (grid.hasPointerCapture(pointerId)) {
      grid.releasePointerCapture(pointerId);
    }
  }, []);

  const clearDragSession = useCallback(
    (pointerId: number) => {
      if (activePointerIdRef.current !== pointerId) return;
      activePointerIdRef.current = null;
      dragSessionRef.current = null;
      dragGridGeometryRef.current = null;
      dragGridGeometryDirtyRef.current = true;
      pointerStartRef.current = null;
      pointerMovedRef.current = false;
      setDragPreview(null);
      setIsScheduleDragging(false);
      releasePointerCapture(pointerId);
    },
    [releasePointerCapture],
  );

  const requestClose = useCallback(() => {
    // The class form historically treats the schedule slide as a reversible
    // picker: clicking the backdrop (or X) closes it immediately.  The
    // teacher-availability tool is the only mode that owns an independent
    // draft and therefore needs the discard confirmation.
    if (scheduleMode === "class-schedule") {
      onClose();
      return;
    }
    const isDraftDirty =
      getScheduleDraftSnapshot(slots) !== initialScheduleSnapshot;
    if (isDraftDirty) {
      setDiscardPrompt(true);
      return;
    }
    onClose();
  }, [initialScheduleSnapshot, onClose, scheduleMode, slots]);

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  // Keep the slide modal keyboard-contained and restore the caller's focus on close.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        // Đang kéo thì Escape chỉ hủy preview, không đóng panel.
        if (activePointerIdRef.current !== null) {
          clearDragSession(activePointerIdRef.current);
          return;
        }
        if (clickAnchor) {
          setClickAnchor(null);
          setClickMessage(null);
          return;
        }
        if (panelMode === "detail") {
          setPanelMode("list");
          setActiveSessionKey(null);
          return;
        }
        requestCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("aria-hidden"));

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocusedRef.current?.focus({ preventScroll: true });
      previouslyFocusedRef.current = null;
    };
  }, [clearDragSession, clickAnchor, isOpen, panelMode]);

  const defaultTeacherIds = useMemo(
    () => selectedTeachers.map((teacher) => teacher.id),
    [selectedTeachers],
  );
  const defaultAssistantIds = useMemo(
    () => selectedAssistants.map((assistant) => assistant.id),
    [selectedAssistants],
  );
  const selectedTeacherById = useMemo(
    () => new Map(selectedTeachers.map((teacher) => [teacher.id, teacher])),
    [selectedTeachers],
  );
  const selectedAssistantById = useMemo(
    () => new Map(selectedAssistants.map((assistant) => [assistant.id, assistant])),
    [selectedAssistants],
  );

  const totalStaffCount = selectedTeachers.length + selectedAssistants.length;
  const viewMode: "overview" | "teacher" =
    scheduleMode === "class-schedule"
      ? "overview"
      : totalStaffCount === 1 || activeTeacherId !== null
        ? "teacher"
        : "overview";
  const effectiveTeacherId =
    scheduleMode === "class-schedule"
      ? null
      : activeTeacherId !== null &&
          (selectedTeacherById.has(activeTeacherId) ||
            selectedAssistantById.has(activeTeacherId))
        ? activeTeacherId
        : viewMode === "teacher" &&
            selectedTeachers.length === 1 &&
            selectedAssistants.length === 0
          ? selectedTeachers[0].id
          : viewMode === "teacher" &&
              selectedTeachers.length === 0 &&
              selectedAssistants.length === 1
            ? selectedAssistants[0].id
            : null;
  const activeStaff = effectiveTeacherId
    ? selectedTeacherById.get(effectiveTeacherId) ??
      selectedAssistantById.get(effectiveTeacherId)
    : null;
  const activeStaffRole: "TEACHER" | "ASSISTANT" | null = effectiveTeacherId
    ? selectedTeacherById.has(effectiveTeacherId)
      ? "TEACHER"
      : selectedAssistantById.has(effectiveTeacherId)
        ? "ASSISTANT"
        : null
    : null;
  const activeTeacherName = activeStaff?.full_name;

  // Danh sách block trực quan đã normalize: dedupe bằng classId + ngày + giờ,
  // sort theo day/start/end/className để thứ tự vẽ ổn định.
  const normalizedOccupiedBlocks = useMemo(() => {
    const seen = new Set<string>();
    const blocks: OccupiedScheduleSlot[] = [];
    for (const slot of [...occupiedSlots].sort((left, right) => {
      const dayOrder =
        DAYS_OF_WEEK.indexOf(left.day) - DAYS_OF_WEEK.indexOf(right.day);
      if (dayOrder !== 0) return dayOrder;
      const startOrder = timeToMinutes(left.start) - timeToMinutes(right.start);
      if (startOrder !== 0) return startOrder;
      const endOrder = timeToMinutes(left.end) - timeToMinutes(right.end);
      if (endOrder !== 0) return endOrder;
      return (left.classId ?? left.className).localeCompare(
        right.classId ?? right.className,
      );
    })) {
      const key = `${slot.classId ?? slot.className}-${slot.day}-${slot.start}-${slot.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push(slot);
    }
    return blocks;
  }, [occupiedSlots]);

  const conflictBlocks: ScheduleConflictBlock[] = normalizedOccupiedBlocks;

  /**
   * Lưới chỉ khóa các block đã thuộc lớp khác. Không suy luận trạng thái từ
   * teacher pool: phân công giáo viên là bước riêng ở panel bên phải.
   */
  const isCellBlocked = useCallback(
    (day: string, timeBlock: string) => {
      if (scheduleMode === "teacher-availability") {
        if (effectiveTeacherId === null) return false;
        return getTeacherBlockAvailability(
          conflictBlocks,
          day,
          timeBlock,
          effectiveTeacherId,
        ).busy;
      }
      return isClassScheduleCellBlocked(
        conflictBlocks,
        day,
        timeBlock,
        defaultTeacherIds,
      );
    },
    [conflictBlocks, defaultTeacherIds, effectiveTeacherId, scheduleMode],
  );

  // Nhân sự rảnh xuyên suốt TOÀN BỘ interval (mọi block 30 phút trong đó).
  const getAvailableStaffForInterval = useCallback(
    (
      day: string,
      startMinutes: number,
      endMinutes: number,
      role: "TEACHER" | "ASSISTANT",
    ): string[] => {
      const pool = role === "TEACHER" ? defaultTeacherIds : defaultAssistantIds;
      const busy = new Set<string>();
      for (let minutes = startMinutes; minutes < endMinutes; minutes += 30) {
        for (const slot of conflictBlocks) {
          if (slot.day !== day) continue;
          const slotStart = timeToMinutes(slot.start);
          const slotEnd = timeToMinutes(slot.end);
          if (!(slotStart < minutes + 30 && minutes < slotEnd)) continue;
          if (isLegacyConflictBlock(slot)) {
            for (const id of pool) busy.add(id);
            continue;
          }
          const ids = role === "TEACHER" ? slot.busyTeacherIds : slot.busyAssistantIds;
          for (const id of ids ?? []) busy.add(id);
        }
      }
      return pool.filter((staffId) => !busy.has(staffId));
    },
    [conflictBlocks, defaultAssistantIds, defaultTeacherIds],
  );

  // Committed data stays untouched while a gesture is running; the preview
  // interval is merged in only for rendering, then committed exactly once on
  // pointerup.
  const renderedBlocks = (() => {
    const baseBlocks = new Set(unpackSlotsToBlocks(slots));
    if (!dragPreview) return baseBlocks;
    return applyScheduleDragPreview(
      baseBlocks,
      dragPreview,
      getScheduleBlockKey,
      (blockIndex) =>
        isCellBlocked(DAYS_OF_WEEK[dragPreview.dayIndex], TIME_BLOCKS[blockIndex]),
    );
  })();

  const renderedSlots = getMergedSlots([...renderedBlocks]);
  const committedEndpointCells = new Set(
    slots
      .filter((slot) => TIME_BLOCKS.includes(slot.end))
      .map((slot) => `${slot.day}-${slot.end}`),
  );

  const rememberErasedSession = useCallback(
    (slot: ScheduleSlot) => {
      sessionLineageRef.current.push({
        day: slot.day,
        start: slot.start,
        end: slot.end,
        teacher_ids: getSlotEffectiveTeacherIds(slot, defaultTeacherIds),
        assistant_ids: getSlotEffectiveAssistantIds(slot),
        scopeTeacherId: effectiveTeacherId,
      });
      if (sessionLineageRef.current.length > 8) {
        sessionLineageRef.current.shift();
      }
    },
    [defaultTeacherIds, effectiveTeacherId],
  );

  // Áp dụng phân công cho slot vừa commit:
  // - slot trùng buổi cũ (theo khoảng giao ngày) giữ nguyên phân công trước đó;
  // - slot vừa bị xóa rồi vẽ lại trong CÙNG phạm vi giáo viên dùng lineage;
  // - slot hoàn toàn mới gán ĐÚNG giáo viên đang chọn (không tự chọn người rảnh).
  const enrichSlotsWithAssignment = useCallback(
    (nextSlots: ScheduleSlot[]): ScheduleSlot[] =>
      nextSlots.map((slot) => {
        const existing = findOverlappingCommittedSlot(slots, slot);
        if (existing) {
          return {
            ...slot,
            teacher_ids: existing.teacher_ids ?? defaultTeacherIds,
            assistant_ids: existing.assistant_ids ?? defaultAssistantIds,
          };
        }
        const remembered = findLineageSession(
          sessionLineageRef.current,
          slot,
          effectiveTeacherId,
        );
        if (remembered) {
          return {
            ...slot,
            teacher_ids: remembered.teacher_ids,
            assistant_ids: remembered.assistant_ids,
          };
        }
        const startMinutes = timeToMinutes(slot.start);
        const endMinutes = timeToMinutes(slot.end);
        const freeTeachers = getAvailableStaffForInterval(
          slot.day,
          startMinutes,
          endMinutes,
          "TEACHER",
        );
        const freeAssistants = getAvailableStaffForInterval(
          slot.day,
          startMinutes,
          endMinutes,
          "ASSISTANT",
        );
        const isAssistantActive = activeStaffRole === "ASSISTANT";
        const initialTeachers = isAssistantActive
          ? freeTeachers.length > 0
            ? [freeTeachers[0]]
            : defaultTeacherIds
          : effectiveTeacherId !== null
            ? [effectiveTeacherId]
            : freeTeachers.length > 0
              ? freeTeachers
              : defaultTeacherIds;
        const initialAssistants = isAssistantActive && effectiveTeacherId !== null
          ? [effectiveTeacherId]
          : freeAssistants;
        return {
          ...slot,
          teacher_ids: initialTeachers,
          assistant_ids: initialAssistants,
        };
      }),
    [
      activeStaffRole,
      defaultAssistantIds,
      defaultTeacherIds,
      effectiveTeacherId,
      getAvailableStaffForInterval,
      slots,
    ],
  );

  const updateSlotAssignment = useCallback(
    (
      day: ScheduleSlot["day"],
      start: string,
      end: string,
      field: "teacher_ids" | "assistant_ids",
      id: string,
      add: boolean,
    ) => {
      setSlots((current) =>
        current.map((slot) => {
          if (slot.day !== day || slot.start !== start || slot.end !== end) {
            return slot;
          }
          const list = slot[field] ?? [];
          // Every committed session must retain at least one teacher.  The
          // UI also hides/disables the last-teacher toggle, but enforce the
          // invariant here so keyboard/programmatic events cannot remove it.
          if (field === "teacher_ids" && !add && list.length <= 1) {
            return slot;
          }
          const next = add
            ? [...list, id]
            : list.filter((candidate) => candidate !== id);
          return { ...slot, [field]: next };
        }),
      );
    },
    [],
  );

  // Mọi buổi đã commit phải còn ít nhất một giáo viên thuộc tập đã chọn (ngoại trừ chế độ class-schedule hoặc khi chưa chọn giáo viên).
  const hasAssignmentError = useMemo(
    () =>
      scheduleMode === "class-schedule" || selectedTeachers.length === 0
        ? false
        : slots.some((slot) => {
            const effective = getSlotEffectiveTeacherIds(slot, defaultTeacherIds);
            return effective.filter((id) => selectedTeacherById.has(id)).length === 0;
          }),
    [defaultTeacherIds, scheduleMode, selectedTeacherById, selectedTeachers.length, slots],
  );

  const getSlotAssignmentConflict = useCallback(
    (slot: ScheduleSlot): { busyTeachers: string[]; busyAssistants: string[] } | null => {
      const assignedTeachers = getSlotEffectiveTeacherIds(
        slot,
        defaultTeacherIds,
      ).filter((id) => selectedTeacherById.has(id));
      const assignedAssistants = getSlotEffectiveAssistantIds(slot);
      const freeTeachers = getAvailableStaffForInterval(
        slot.day,
        timeToMinutes(slot.start),
        timeToMinutes(slot.end),
        "TEACHER",
      );
      const freeAssistants = getAvailableStaffForInterval(
        slot.day,
        timeToMinutes(slot.start),
        timeToMinutes(slot.end),
        "ASSISTANT",
      );
      const busyTeachers = assignedTeachers.filter(
        (id) => !freeTeachers.includes(id),
      );
      const busyAssistants = assignedAssistants.filter(
        (id) => !freeAssistants.includes(id),
      );
      if (busyTeachers.length === 0 && busyAssistants.length === 0) {
        return null;
      }
      return { busyTeachers, busyAssistants };
    },
    [defaultTeacherIds, getAvailableStaffForInterval, selectedTeacherById],
  );
  const hasAssignmentConflict = useMemo(
    () =>
      scheduleMode === "class-schedule" || selectedTeachers.length === 0
        ? false
        : slots.some((slot) => getSlotAssignmentConflict(slot) !== null),
    [getSlotAssignmentConflict, scheduleMode, selectedTeachers.length, slots],
  );

  // Lane theo interval partitioning — chỉ dùng ở chế độ Tổng quan (view-only).
  const dayLaneLayouts = useMemo(() => {
    const byDay = new Map<string, OccupiedScheduleSlot[]>();
    for (const block of normalizedOccupiedBlocks) {
      const dayBlocks = byDay.get(block.day) ?? [];
      dayBlocks.push(block);
      byDay.set(block.day, dayBlocks);
    }
    const layouts = new Map<
      string,
      {
        blocks: OccupiedScheduleSlot[];
        lanes: OccupiedScheduleSlot[][];
        overflowSegments: { start: number; end: number; count: number }[];
      }
    >();
    for (const [day, dayBlocks] of byDay) {
      const sorted = [...dayBlocks].sort((left, right) => {
        const startOrder = timeToMinutes(left.start) - timeToMinutes(right.start);
        if (startOrder !== 0) return startOrder;
        const endOrder = timeToMinutes(left.end) - timeToMinutes(right.end);
        if (endOrder !== 0) return endOrder;
        return (left.classId ?? left.className).localeCompare(
          right.classId ?? right.className,
        );
      });
      const lanes: OccupiedScheduleSlot[][] = [];
      const overflow: OccupiedScheduleSlot[] = [];
      for (const block of sorted) {
        const start = timeToMinutes(block.start);
        let placed = false;
        for (const lane of lanes) {
          const last = lane[lane.length - 1];
          if (timeToMinutes(last.end) <= start) {
            lane.push(block);
            placed = true;
            break;
          }
        }
        if (!placed) {
          if (lanes.length < MAX_OCCUPIED_LANES) {
            lanes.push([block]);
          } else {
            overflow.push(block);
          }
        }
      }
      const overflowSegments: {
        start: number;
        end: number;
        count: number;
      }[] = [];
      if (dayBlocks.length > MAX_OCCUPIED_LANES) {
        const boundarySet = new Set<number>();
        for (const block of dayBlocks) {
          boundarySet.add(timeToMinutes(block.start));
          boundarySet.add(timeToMinutes(block.end));
        }
        const boundaries = [...boundarySet].sort((a, b) => a - b);
        let segmentStart = boundaries[0];
        let segmentCount = 0;
        const flushSegment = (segmentEnd: number) => {
          if (segmentCount > 0 && segmentEnd > segmentStart) {
            overflowSegments.push({
              start: segmentStart,
              end: segmentEnd,
              count: segmentCount,
            });
          }
        };
        for (let i = 0; i < boundaries.length - 1; i += 1) {
          const segStart = boundaries[i];
          const segEnd = boundaries[i + 1];
          const active = dayBlocks.filter(
            (block) =>
              timeToMinutes(block.start) <= segStart &&
              segEnd <= timeToMinutes(block.end),
          ).length;
          const count = Math.max(0, active - MAX_OCCUPIED_LANES);
          if (count !== segmentCount) {
            flushSegment(segStart);
            segmentCount = count;
            segmentStart = segStart;
          }
        }
        flushSegment(boundaries[boundaries.length - 1]);
      }
      layouts.set(day, { blocks: dayBlocks, lanes, overflowSegments });
    }
    return layouts;
  }, [normalizedOccupiedBlocks]);

  const getClickFeedback = (
    reason: ScheduleClickReason,
    day: string,
    timeBlock: string,
  ): string | null => {
    switch (reason) {
      case "pending":
      case "pending-moved":
        return `${day} ${timeBlock}: chọn thêm một ô liền kề để đủ 60 phút.`;
      case "minimum-duration":
        return "Buổi học phải còn ít nhất 60 phút.";
      case "interior-cell":
        return "Chỉ có thể thu ngắn buổi học từ ô đầu hoặc ô cuối.";
      case "bridge-rejected":
        return "Không thể nối hai buổi riêng bằng một ô.";
      case "blocked":
        return "Khung giờ này đã có lớp khác.";
      case "outside-range":
        return "Khung giờ này nằm ngoài phạm vi có thể thiết lập.";
      default:
        return null;
    }
  };

  const openSessionDetail = useCallback((key: string) => {
    setActiveSessionKey(key);
    setPanelMode("detail");
  }, []);

  const handleCellActivation = (
    day: string,
    timeBlock: string,
    dayIndex: number,
    timeIndex: number,
  ) => {
    if (scheduleMode === "teacher-availability" && viewMode === "overview") {
      setClickAnchor(null);
      setClickMessage("Đang xem tổng quan. Chọn một giáo viên để bắt đầu tô lịch.");
      return;
    }
    const currentBlocks = new Set(unpackSlotsToBlocks(slots));
    const selected = currentBlocks.has(getScheduleBlockKey(dayIndex, timeIndex));
    const isCommittedEndpoint = committedEndpointCells.has(`${day}-${timeBlock}`);
    if (
      !selected &&
      !isCommittedEndpoint &&
      (occupiedLoading || Boolean(occupiedError))
    ) {
      return;
    }

    const result = applyScheduleCellClick({
      baseBlocks: currentBlocks,
      pendingAnchor: clickAnchor,
      dayIndex,
      blockIndex: timeIndex,
      getBlockKey: getScheduleBlockKey,
      isBlocked: (candidateDayIndex, blockIndex) =>
        isCellBlocked(
          DAYS_OF_WEEK[candidateDayIndex],
          TIME_BLOCKS[blockIndex],
        ),
    });

    if (!result.changed) {
      setClickAnchor(result.pendingAnchor);
      setClickMessage(getClickFeedback(result.reason, day, timeBlock));
      setSlotLimitMessage(false);
      return;
    }

    const nextSlots = getMergedSlots([...result.blocks]);
    if (nextSlots.length > MAX_WEEKLY_CLASS_SLOTS) {
      setClickAnchor(null);
      setClickMessage(null);
      setSlotLimitMessage(true);
      return;
    }

    if (
      scheduleMode === "teacher-availability" &&
      (result.reason === "created" || result.reason === "extended")
    ) {
      const clickedMinutes = timeToMinutes(timeBlock);
      const affectedSlot = nextSlots.find(
        (slot) =>
          slot.day === day &&
          timeToMinutes(slot.start) <= clickedMinutes &&
          clickedMinutes < timeToMinutes(slot.end),
      );
      if (affectedSlot && effectiveTeacherId !== null) {
        const free = isTeacherFreeAcrossInterval(
          conflictBlocks,
          day,
          timeToMinutes(affectedSlot.start),
          timeToMinutes(affectedSlot.end),
          effectiveTeacherId,
        );
        if (!free) {
          setClickAnchor(null);
          setClickMessage(
            `${activeTeacherName ?? "Giáo viên đang chọn"} đã bận xuyên suốt khung giờ này.`,
          );
          setSlotLimitMessage(false);
          return;
        }
      }
    }

    if (result.reason === "shrunk") {
      const clickedMinutes = timeToMinutes(timeBlock);
      const containingSlot = slots.find(
        (slot) =>
          slot.day === day &&
          timeToMinutes(slot.start) <= clickedMinutes &&
          clickedMinutes <= timeToMinutes(slot.end),
      );
      if (containingSlot) rememberErasedSession(containingSlot);
    }

    setSlots(enrichSlotsWithAssignment(nextSlots));
    setClickAnchor(null);
    setClickMessage(null);
    setSlotLimitMessage(false);
  };

  const capturePointer = (pointerId: number) => {
    const grid = scheduleGridRef.current;
    if (!grid) return;
    try {
      grid.setPointerCapture(pointerId);
    } catch {
      // Pointer capture can fail only if the browser already cancelled the
      // gesture; in-grid pointer events still remain functional.
    }
  };

  const handleCellPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    day: string,
    timeBlock: string,
    dayIndex: number,
    timeIndex: number,
  ) => {
    if (!event.isPrimary || event.button !== 0) return;

    // A busy cell belongs to another class.  Do not focus it or start a
    // pointer gesture: aria-disabled alone does not suppress native button
    // focus in every browser.
    if (isCellBlocked(day, timeBlock)) {
      event.preventDefault();
      pointerGestureRef.current = false;
      return;
    }

    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    pointerGestureRef.current = true;
    if (scheduleMode === "teacher-availability" && viewMode === "overview") {
      setClickAnchor(null);
      setClickMessage("Đang xem tổng quan. Chọn một giáo viên để bắt đầu tô lịch.");
      return;
    }
    const isCommittedEndpoint = committedEndpointCells.has(`${day}-${timeBlock}`);
    setSlotLimitMessage(false);

    const baseBlocks = new Set(unpackSlotsToBlocks(slots));
    const clickedKey = getScheduleBlockKey(dayIndex, timeIndex);
    const mode =
      baseBlocks.has(clickedKey) || isCommittedEndpoint
        ? "erasing"
        : "painting";
    if (mode === "painting" && (occupiedLoading || Boolean(occupiedError))) {
      return;
    }
    const anchorBoundary = timeIndex;
    const session: ScheduleDragSession = {
      pointerId: event.pointerId,
      mode,
      startedFromEndpoint: isCommittedEndpoint,
      dayIndex,
      anchorBoundary,
      currentBoundary: anchorBoundary,
      baseBlocks,
    };
    activePointerIdRef.current = event.pointerId;
    pointerStartRef.current = {
      pointerId: event.pointerId,
      dayIndex,
      timeIndex,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    pointerMovedRef.current = false;
    dragSessionRef.current = session;
    setIsScheduleDragging(true);
    const geometry = measureScheduleGridGeometry(
      scheduleGridRef.current,
      ++dragGridGeometryVersionRef.current,
    );
    dragGridGeometryRef.current = geometry;
    dragGridGeometryDirtyRef.current = geometry === null;
    setDragPreview(createScheduleDragPreview(session));
    capturePointer(event.pointerId);
  };

  const applyPointerPosition = (clientY: number) => {
    const session = dragSessionRef.current;
    if (!session) return;
    let geometry = dragGridGeometryRef.current;
    let geometryWasRefreshed = false;

    if (!dragGridGeometryDirtyRef.current && geometry && scheduleGridRef.current) {
      const currentGridRect = scheduleGridRef.current.getBoundingClientRect();
      if (
        Math.abs(currentGridRect.height - (geometry.gridBottom - geometry.gridTop)) > 1 ||
        Math.abs(currentGridRect.top - geometry.gridTop) > 1 ||
        Math.abs(currentGridRect.left - geometry.gridLeft) > 1 ||
        Math.abs(currentGridRect.width - geometry.gridWidth) > 1
      ) {
        dragGridGeometryDirtyRef.current = true;
      }
    }
    if (!geometry || dragGridGeometryDirtyRef.current) {
      geometry = measureScheduleGridGeometry(
        scheduleGridRef.current,
        ++dragGridGeometryVersionRef.current,
      );
      if (!geometry) return;
      dragGridGeometryRef.current = geometry;
      dragGridGeometryDirtyRef.current = false;
      geometryWasRefreshed = true;
    }

    const boundary = resolveScheduleBoundary(clientY, geometry);
    if (boundary === session.currentBoundary && !geometryWasRefreshed) return;

    const nextSession =
      boundary === session.currentBoundary
        ? session
        : updateScheduleDragSession(session, boundary);
    dragSessionRef.current = nextSession;
    const preview = createScheduleDragPreview(nextSession);

    if (
      nextSession.mode === "painting" &&
      (occupiedLoading || Boolean(occupiedError))
    ) {
      setDragPreview(null);
      return;
    }

    if (!preview) {
      setDragPreview(null);
      setSlotLimitMessage(false);
      return;
    }

    const nextBlocks = applyScheduleDragPreview(
      nextSession.baseBlocks,
      preview,
      getScheduleBlockKey,
      (blockIndex) =>
        isCellBlocked(
          DAYS_OF_WEEK[nextSession.dayIndex],
          TIME_BLOCKS[blockIndex],
        ),
    );
    if (getMergedSlots([...nextBlocks]).length > MAX_WEEKLY_CLASS_SLOTS) {
      setSlotLimitMessage(true);
      return;
    }
    setDragPreview(preview);
    setSlotLimitMessage(false);
  };

  const handleGridPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    const pointerStart = pointerStartRef.current;
    if (
      pointerStart &&
      !pointerMovedRef.current &&
      Math.hypot(
        event.clientX - pointerStart.clientX,
        event.clientY - pointerStart.clientY,
      ) >= 4
    ) {
      pointerMovedRef.current = true;
      setClickAnchor(null);
      setClickMessage(null);
    }
    applyPointerPosition(event.clientY);
  };

  const handleGridPointerUp = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    const pointerStart = pointerStartRef.current;
    const isTap =
      pointerStart?.pointerId === event.pointerId &&
      !pointerMovedRef.current &&
      Math.hypot(
        event.clientX - pointerStart.clientX,
        event.clientY - pointerStart.clientY,
      ) < 4;
    if (isTap && pointerStart) {
      const { dayIndex, timeIndex } = pointerStart;
      const day = DAYS_OF_WEEK[dayIndex];
      const timeBlock = TIME_BLOCKS[timeIndex];
      clearDragSession(event.pointerId);
      handleCellActivation(day, timeBlock, dayIndex, timeIndex);
      return;
    }
    const sessionAtLastMove = dragSessionRef.current;
    if (sessionAtLastMove) {
      applyPointerPosition(event.clientY);
      const session = dragSessionRef.current ?? sessionAtLastMove;
      const geometry = dragGridGeometryRef.current;
      const boundary = geometry ? resolveScheduleBoundary(event.clientY, geometry) : session.currentBoundary;
      const candidateSession: ScheduleDragSession = {
        ...session,
        currentBoundary: boundary,
      };
      const finalSession =
        !createScheduleDragPreview(candidateSession) &&
        sessionAtLastMove.currentBoundary !== sessionAtLastMove.anchorBoundary
          ? sessionAtLastMove
          : candidateSession;
      const finalPreview = createScheduleDragPreview(finalSession);
      if (finalPreview?.interval) {
        if (
          finalPreview.mode === "painting" &&
          (occupiedLoading || Boolean(occupiedError))
        ) {
          setSlotLimitMessage(false);
          clearDragSession(event.pointerId);
          return;
        }
        if (
          finalPreview.mode === "painting" &&
          !finalSession.startedFromEndpoint &&
          finalPreview.interval.endBoundary - finalPreview.interval.startBoundary <
            MIN_SCHEDULE_SESSION_BLOCKS
        ) {
          setSlotLimitMessage(false);
          clearDragSession(event.pointerId);
          return;
        }
        const nextBlocks = applyScheduleDragPreview(
          finalSession.baseBlocks,
          finalPreview,
          getScheduleBlockKey,
          (blockIndex) =>
            isCellBlocked(
              DAYS_OF_WEEK[finalSession.dayIndex],
              TIME_BLOCKS[blockIndex],
            ),
        );
        const nextSlots = getMergedSlots([...nextBlocks]);
        const cleanedSlots =
          finalPreview.mode === "erasing"
            ? nextSlots.filter(
                (slot) =>
                  timeToMinutes(slot.end) - timeToMinutes(slot.start) >=
                  MIN_SCHEDULE_SESSION_BLOCKS * 30,
              )
            : nextSlots;
        if (cleanedSlots.length > MAX_WEEKLY_CLASS_SLOTS) {
          setSlotLimitMessage(true);
        } else {
          setSlotLimitMessage(false);
          if (finalPreview.mode === "erasing" && finalPreview.interval) {
            const erasedDay = DAYS_OF_WEEK[finalSession.dayIndex];
            const eraseStart = scheduleBoundaryToMinutes(
              finalPreview.interval.startBoundary,
            );
            const eraseEnd = scheduleBoundaryToMinutes(
              finalPreview.interval.endBoundary,
            );
            for (const candidate of slots) {
              if (candidate.day !== erasedDay) continue;
              const candidateStart = timeToMinutes(candidate.start);
              const candidateEnd = timeToMinutes(candidate.end);
              if (candidateStart < eraseEnd && eraseStart < candidateEnd) {
                rememberErasedSession(candidate);
              }
            }
          }
          setSlots(enrichSlotsWithAssignment(cleanedSlots));
        }
      } else {
        setSlotLimitMessage(false);
      }
    }
    clearDragSession(event.pointerId);
  };

  const handleGridPointerCancel = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    setSlotLimitMessage(false);
    clearDragSession(event.pointerId);
  };

  useEffect(() => {
    if (isOpen) return;
    const pointerId = activePointerIdRef.current;
    if (pointerId !== null) {
      clearDragSession(pointerId);
    }
    setSlotLimitMessage(false);
  }, [clearDragSession, isOpen]);

  const focusCell = (
    dayIndex: number,
    timeIndex: number,
    dayDirection = Math.sign(dayIndex - focusedCell.dayIndex),
    timeDirection = Math.sign(timeIndex - focusedCell.timeIndex),
  ) => {
    let nextDayIndex = dayIndex;
    let nextTimeIndex = timeIndex;

    while (
      nextDayIndex >= 0 &&
      nextDayIndex < DAYS_OF_WEEK.length &&
      nextTimeIndex >= 0 &&
      nextTimeIndex < TIME_BLOCKS.length &&
      isCellBlocked(DAYS_OF_WEEK[nextDayIndex], TIME_BLOCKS[nextTimeIndex])
    ) {
      if (dayDirection === 0 && timeDirection === 0) return;
      nextDayIndex += dayDirection;
      nextTimeIndex += timeDirection;
    }

    if (
      nextDayIndex < 0 ||
      nextDayIndex >= DAYS_OF_WEEK.length ||
      nextTimeIndex < 0 ||
      nextTimeIndex >= TIME_BLOCKS.length
    ) {
      return;
    }

    setFocusedCell({ dayIndex: nextDayIndex, timeIndex: nextTimeIndex });
    window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-day-index="${nextDayIndex}"][data-time-index="${nextTimeIndex}"]`,
        )
        ?.focus({ preventScroll: true });
    });
  };

  const handleCellKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    dayIndex: number,
    timeIndex: number,
  ) => {
    const day = DAYS_OF_WEEK[dayIndex];
    const timeBlock = TIME_BLOCKS[timeIndex];

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isCellBlocked(day, timeBlock)) {
        handleCellActivation(day, timeBlock, dayIndex, timeIndex);
      }
      return;
    }

    const nextCellByKey: Partial<
      Record<
        string,
        { dayIndex: number; timeIndex: number; dayDirection?: number; timeDirection?: number }
      >
    > = {
      ArrowLeft: { dayIndex: dayIndex - 1, timeIndex, dayDirection: -1 },
      ArrowRight: { dayIndex: dayIndex + 1, timeIndex, dayDirection: 1 },
      ArrowUp: { dayIndex, timeIndex: timeIndex - 1, timeDirection: -1 },
      ArrowDown: { dayIndex, timeIndex: timeIndex + 1, timeDirection: 1 },
      Home: { dayIndex: 0, timeIndex, dayDirection: 1 },
      End: { dayIndex: DAYS_OF_WEEK.length - 1, timeIndex, dayDirection: -1 },
    };
    const nextCell = nextCellByKey[event.key];
    if (nextCell) {
      event.preventDefault();
      focusCell(
        nextCell.dayIndex,
        nextCell.timeIndex,
        nextCell.dayDirection,
        nextCell.timeDirection,
      );
    }
  };

  const handleCellClick = (
    event: ReactMouseEvent<HTMLButtonElement>,
    day: string,
    timeBlock: string,
    dayIndex: number,
    timeIndex: number,
  ) => {
    // Assistive technologies may dispatch click without a preceding key event.
    // Pointer/touch taps are already handled once on pointerup, so their
    // synthetic click must be consumed rather than applied twice.
    const fromPointer = pointerGestureRef.current;
    pointerGestureRef.current = false;
    const blocked = isCellBlocked(day, timeBlock);
    if (event.detail === 0 && !blocked && !fromPointer) {
      handleCellActivation(day, timeBlock, dayIndex, timeIndex);
    }
  };

  // Ô lưới: trạng thái theo phạm vi đang chọn (Tổng quan / giáo viên).
  const cellDescriptors = useMemo<ScheduleCellDescriptor[][]>(
    () => {
      const endpointCells = new Set(
        renderedSlots
          .filter((slot) => TIME_BLOCKS.includes(slot.end))
          .map((slot) => `${slot.day}-${slot.end}`),
      );
      return TIME_BLOCKS.map((timeBlock, timeIndex) =>
        DAYS_OF_WEEK.map((day, dayIndex) => {
          const selected = renderedBlocks.has(`${day}-${timeBlock}`);
          const isClickAnchor =
            clickAnchor?.dayIndex === dayIndex &&
            clickAnchor.blockIndex === timeIndex;
          const slotForCell = slots.find(
            (candidate) =>
              candidate.day === day &&
              timeToMinutes(candidate.start) <= timeToMinutes(timeBlock) &&
              timeToMinutes(timeBlock) < timeToMinutes(candidate.end),
          );
          const isSlotAssignedToActiveTeacher =
            !slotForCell ||
            effectiveTeacherId === null ||
            (activeStaffRole === "ASSISTANT"
              ? getSlotEffectiveAssistantIds(slotForCell).includes(
                  effectiveTeacherId,
                )
              : getSlotEffectiveTeacherIds(slotForCell, defaultTeacherIds).includes(
                  effectiveTeacherId,
                ));
          const isVisuallySelected =
            selected &&
            (viewMode === "overview" || isSlotAssignedToActiveTeacher);
          const isEndpointCell =
            endpointCells.has(`${day}-${timeBlock}`) &&
            (viewMode !== "teacher" || isSlotAssignedToActiveTeacher);
          const blocked = isCellBlocked(day, timeBlock);
          const state: ScheduleCellDescriptor["state"] =
            scheduleMode === "class-schedule"
              ? blocked
                ? "busy"
                : selected
                  ? "selected"
                  : "free"
              : viewMode === "overview"
                ? "overview"
                : blocked
                  ? "busy"
                  : isVisuallySelected
                    ? "selected"
                    : "free";
          const isDragAnchor =
            dragPreview !== null &&
            dragPreview.anchorBoundary === timeIndex &&
            dragPreview.dayIndex === dayIndex &&
            selected;
          const busyAvailability =
            scheduleMode === "teacher-availability" && effectiveTeacherId !== null
              ? getTeacherBlockAvailability(
                  conflictBlocks,
                  day,
                  timeBlock,
                  effectiveTeacherId,
                )
              : null;
          const timeRange = `${timeBlock} đến ${minutesToTime(timeToMinutes(timeBlock) + 30)}`;
          const staffRoleLabel = activeStaffRole === "ASSISTANT" ? "trợ giảng" : "giáo viên";
          const scopeText =
            scheduleMode === "class-schedule"
              ? "đang xếp lịch cho lớp này"
              : viewMode === "overview"
                ? "đang xem tổng quan"
                : `đang xếp cho ${activeTeacherName ?? `${staffRoleLabel} đang chọn`}`;
          let stateText: string;
          if (blocked && busyAvailability) {
            stateText = `${activeTeacherName ?? `${staffRoleLabel} đang chọn`} đã bận lớp ${busyAvailability.classNames.join(", ")}${busyAvailability.legacy ? `, ${LEGACY_CONFLICT_MESSAGE}` : ""}`;
          } else if (blocked) {
            stateText = "khung giờ đã có lớp khác";
          } else if (selected) {
            stateText = "đã chọn";
          } else if (isClickAnchor) {
            stateText = "đang chờ chọn ô liền kề";
          } else if (isEndpointCell) {
            stateText = "mốc kết thúc";
          } else {
            stateText = "còn rảnh";
          }
          const title =
            blocked && busyAvailability
              ? `${activeTeacherName ?? `${staffRoleLabel} đang chọn`} đã bận lớp ${busyAvailability.classNames.join(", ")}${busyAvailability.legacy ? `; ${LEGACY_CONFLICT_MESSAGE}` : ""}`
              : blocked
                ? "Khung giờ này đã có lớp khác"
                : undefined;
          return {
            dayIndex,
            timeIndex,
            day,
            timeBlock,
            state,
            isClickAnchor,
            isEndpointCell,
            isDragAnchor,
            ariaLabel: `${day}, ${timeRange}, ${scopeText}, ${stateText}`,
            title,
            ariaPressed: selected,
            ariaDisabled: blocked,
            tabIndex:
              !blocked &&
              focusedCell.dayIndex === dayIndex &&
              focusedCell.timeIndex === timeIndex
                ? 0
                : -1,
          };
        }),
      );
    },
    [
      activeStaffRole,
      activeTeacherName,
      clickAnchor,
      conflictBlocks,
      defaultTeacherIds,
      dragPreview,
      effectiveTeacherId,
      focusedCell,
      isCellBlocked,
      renderedBlocks,
      renderedSlots,
      scheduleMode,
      slots,
      viewMode,
    ],
  );

  const formatAssignedNames = useCallback(
    (ids: string[]) => {
      const names = ids
        .map((id) => selectedTeacherById.get(id)?.full_name ?? "Giáo viên đã chọn")
        .filter(Boolean);
      if (names.length === 0) return "";
      if (names.length <= 2) return names.join(" · ");
      return `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
    },
    [selectedTeacherById],
  );

  // Buổi của lớp hiện tại luôn được hiển thị ở mọi scope. Overlay là một
  // block liền mạch; các ô 30 phút bên dưới chỉ đảm nhiệm hit-test thời gian.
  // Phân công/xóa buổi được thực hiện rõ ràng trong panel bên phải.
  const ownSessionOverlays = useMemo(() => {
    return renderedSlots.flatMap((slot) => {
      const committed = slots.find(
        (candidate) =>
          candidate.day === slot.day &&
          candidate.start === slot.start &&
          candidate.end === slot.end,
      );
      if (!committed) return [];
      const assignedTeacherIds = getSlotEffectiveTeacherIds(
        committed,
        defaultTeacherIds,
      ).filter((id) => selectedTeacherById.has(id));
      const assignedAssistantIds = getSlotEffectiveAssistantIds(committed).filter(
        (id) => selectedAssistantById.has(id),
      );
      const activeAssigned =
        viewMode === "teacher" &&
        effectiveTeacherId !== null &&
        (activeStaffRole === "ASSISTANT"
          ? assignedAssistantIds.includes(effectiveTeacherId)
          : assignedTeacherIds.includes(effectiveTeacherId));
      const nameText = formatAssignedNames(assignedTeacherIds);
      const { style } = getOccupiedSlotStyle(slot, 1, 0, true);
      const key = getScheduleSessionKey(slot);
      const durationMinutes = timeToMinutes(slot.end) - timeToMinutes(slot.start);
      const isDisplayableSession = durationMinutes >= 60;

      const assignedTeachers = assignedTeacherIds
        .map((id) => selectedTeacherById.get(id))
        .filter((teacher): teacher is TeacherOptionResponse => Boolean(teacher));
      const assignedAssistants = assignedAssistantIds
        .map((id) => selectedAssistantById.get(id))
        .filter((assistant): assistant is TeacherOptionResponse => Boolean(assistant));

      const isNewSlot =
        initialSlots.length > 0 &&
        !initialSlots.some(
          (init) =>
            init.day === slot.day &&
            init.start === slot.start &&
            init.end === slot.end,
        );

      return [
        <div
          key={`own-${key}`}
          title={`Buổi của lớp ${classLabel} · ${slot.day} ${slot.start}-${slot.end}`}
          aria-label={`Buổi của lớp ${classLabel}, ${slot.day} ${slot.start}-${slot.end}, ${nameText || "chưa phân công giáo viên"}${viewMode === "teacher" && !activeAssigned ? ", do giáo viên khác phụ trách" : ""}`}
          className={`font-ui pointer-events-none absolute z-30 flex flex-col items-center justify-center rounded-md border p-1 text-center text-[11px] leading-tight shadow-sm ${
            viewMode === "overview" || activeAssigned
              ? "border-primary/45 bg-primary-soft text-primary"
              : "border-2 border-dashed border-slate-300 bg-slate-50 text-slate-700 shadow-sm"
          }`}
          style={style}
        >
          <div
            className="flex min-w-0 max-w-full flex-col items-center justify-center gap-0.5 text-center"
            aria-hidden="true"
          >
            {viewMode === "overview" ? (
              <>
                <span className="flex w-full max-w-full items-center justify-center gap-1.5 font-bold leading-tight">
                  <span className="truncate">{classLabel}</span>
                  {isNewSlot ? (
                    <span
                      aria-label="Buổi mới thêm"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                    />
                  ) : null}
                </span>
                {isDisplayableSession && (assignedTeachers.length > 0 || assignedAssistants.length > 0) ? (
                  <div className="mt-0.5 flex w-full max-w-full flex-col items-center gap-0.5 text-[10px] font-normal leading-tight">
                    {assignedTeachers.map((teacher) => (
                      <span key={teacher.id} className="block w-full max-w-full truncate px-0.5">
                        {teacher.full_name}
                      </span>
                    ))}
                    {assignedAssistants.map((assistant) => (
                      <span key={assistant.id} className="block w-full max-w-full truncate px-0.5">
                        {assistant.full_name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <span className="flex w-full max-w-full items-center justify-center gap-1.5 font-bold leading-tight">
                  <span className="truncate">{classLabel}</span>
                  {isNewSlot ? (
                    <span
                      aria-label="Buổi mới thêm"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                    />
                  ) : null}
                </span>
                {activeAssigned ? (
                  isDisplayableSession && (assignedTeachers.length > 0 || assignedAssistants.length > 0) ? (
                    <div className="mt-0.5 flex w-full max-w-full flex-col items-center gap-0.5 text-[10px] leading-tight">
                      {assignedTeachers.map((teacher) => {
                        const isCurrent = teacher.id === effectiveTeacherId;
                        return (
                          <span
                            key={teacher.id}
                            className={`block w-full max-w-full truncate px-0.5 ${
                              isCurrent
                                ? "font-bold text-primary"
                                : "font-normal text-primary/85"
                            }`}
                          >
                            {teacher.full_name}
                          </span>
                        );
                      })}
                      {assignedAssistants.map((assistant) => {
                        const isCurrent = assistant.id === effectiveTeacherId;
                        return (
                          <span
                            key={assistant.id}
                            className={`block w-full max-w-full truncate px-0.5 ${
                              isCurrent
                                ? "font-bold text-primary"
                                : "font-normal text-primary/85"
                            }`}
                          >
                            {assistant.full_name}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="block w-full max-w-full truncate px-0.5 text-[10px] font-bold leading-tight text-primary">
                      {activeTeacherName || nameText || "Đã chọn"}
                    </span>
                  )
                ) : (
                  <span className="block w-full max-w-full truncate px-0.5 text-[10px] font-medium leading-tight text-slate-500">
                    {activeStaffRole === "ASSISTANT"
                      ? "Chưa chọn trợ giảng này"
                      : "Chưa chọn giáo viên này"}
                  </span>
                )}
              </>
            )}
          </div>
        </div>,
      ];
    });
  }, [
    activeStaffRole,
    activeTeacherName,
    classLabel,
    defaultTeacherIds,
    effectiveTeacherId,
    formatAssignedNames,
    initialSlots,
    renderedSlots,
    selectedAssistantById,
    selectedTeacherById,
    slots,
    viewMode,
  ]);

  // Teacher-availability presentation keeps its focused busy overlay for the
  // legacy tooling mode. Class-centric mode renders every occupied class once
  // in overviewLaneOverlays and uses the disabled cells underneath it.
  const teacherBusyOverlays = useMemo(() => {
    if (scheduleMode !== "teacher-availability" || viewMode !== "teacher" || effectiveTeacherId === null) {
      return null;
    }
    const staffName =
      activeTeacherName ??
      (activeStaffRole === "ASSISTANT"
        ? "Trợ giảng đang chọn"
        : "Giáo viên đang chọn");
    return normalizedOccupiedBlocks.flatMap((slot) => {
      const legacy = isLegacyConflictBlock(slot);
      const isBusy =
        legacy ||
        (slot.busyTeacherIds ?? []).includes(effectiveTeacherId) ||
        (slot.busyAssistantIds ?? []).includes(effectiveTeacherId);
      if (!isBusy) {
        return [];
      }
      const { style } = getOccupiedSlotStyle(slot, 1, 0);
      const busyLabel = legacy ? LEGACY_CONFLICT_MESSAGE : `${staffName} đang bận`;
      return [
        <div
          key={`busy-${slot.classId ?? slot.className}-${slot.day}-${slot.start}-${slot.end}`}
          title={`${slot.className} (${slot.start}-${slot.end}) — ${busyLabel}`}
          aria-label={`${slot.className}, ${slot.day} ${slot.start} đến ${slot.end}, ${busyLabel}`}
          className="font-ui pointer-events-none absolute z-20 flex items-center justify-center rounded-md border border-gray-300 bg-slate-100/90 px-1 text-center text-[10px] font-semibold leading-tight shadow-sm"
          style={style}
        >
          <span className="flex min-w-0 flex-col items-center gap-0.5" aria-hidden="true">
            <span className="max-w-full truncate">{abbreviateClassName(slot.className)}</span>
            <span className="max-w-full truncate font-normal text-gray-500">{busyLabel}</span>
          </span>
        </div>,
      ];
    });
  }, [
    activeStaffRole,
    activeTeacherName,
    effectiveTeacherId,
    normalizedOccupiedBlocks,
    scheduleMode,
    viewMode,
  ]);

  const overviewLaneOverlays =
    viewMode === "overview"
      ? [...dayLaneLayouts.entries()].map(([day, layout]) => {
          const laneCount =
            layout.lanes.length +
            (layout.overflowSegments.length > 0 ? 1 : 0);
          return (
            <Fragment key={`day-${day}`}>
              {layout.lanes.map((lane, laneIndex) =>
                lane.map((slot) => {
                  // Width is determined by the maximum number of classes that
                  // overlap this exact interval, not by every class on the day.
                  // Sequential classes must reclaim the full day column even
                  // when another pair overlaps elsewhere in the same day.
                  const slotStart = timeToMinutes(slot.start);
                  const slotEnd = timeToMinutes(slot.end);
                  const overlappingCount = layout.blocks.filter((other) => {
                    const otherStart = timeToMinutes(other.start);
                    const otherEnd = timeToMinutes(other.end);
                    return otherStart < slotEnd && slotStart < otherEnd;
                  }).length;
                  // A third (or later) concurrent class reserves the summary
                  // lane, so the two visible blocks use the same three-column
                  // geometry as the "+N lớp bận" overlay. Outside that exact
                  // interval, no summary lane is reserved.
                  const slotLaneCount =
                    overlappingCount > MAX_OCCUPIED_LANES
                      ? MAX_OCCUPIED_LANES + 1
                      : Math.max(
                          1,
                          Math.min(MAX_OCCUPIED_LANES, overlappingCount),
                        );
                  const { style } = getOccupiedSlotStyle(
                    slot,
                    slotLaneCount,
                    laneIndex,
                  );
                  const color = getBlockedClassColor(slot);
                  const busyTeacherNames = (slot.busyTeacherIds ?? []).map(
                    (id) => selectedTeacherById.get(id)?.full_name ?? "giáo viên đã chọn",
                  );
                  const occupiedReason =
                    scheduleMode === "class-schedule"
                      ? "Lớp khác đã có lịch ở khung giờ này"
                      : busyTeacherNames.length
                        ? `Giáo viên ${busyTeacherNames.join(", ")} đã có lớp ở khung giờ này`
                        : "Giáo viên đã có lớp ở khung giờ này";
                  return (
                    <div
                      key={`${slot.classId ?? slot.className}-${slot.day}-${slot.start}-${slot.end}`}
                      title={`${slot.className} (${slot.start}-${slot.end}) — ${occupiedReason}`}
                      aria-label={`${slot.className}, ${slot.day} ${slot.start} đến ${slot.end}, ${occupiedReason}`}
                      className="font-ui pointer-events-none absolute z-20 flex items-center justify-center rounded-md border px-1 text-center text-[10px] font-semibold leading-tight shadow-sm"
                      style={{
                        ...style,
                        backgroundColor: color.background,
                        borderColor: color.border,
                        color: color.text,
                      }}
                    >
                      <span className="line-clamp-2" aria-hidden="true">
                        {abbreviateClassName(slot.className)}
                      </span>
                    </div>
                  );
                }),
              )}
              {layout.overflowSegments.map((segment) => (
                <div
                  key={`overflow-${day}-${segment.start}-${segment.end}`}
                  role="img"
                  aria-label={`${segment.count} lớp khác cũng bận trong khoảng ${minutesToTime(segment.start)} đến ${minutesToTime(segment.end)}`}
                  title={`+${segment.count} lớp bận trong khoảng ${minutesToTime(segment.start)}-${minutesToTime(segment.end)}`}
                  className="font-ui pointer-events-none absolute z-20 flex items-center justify-center rounded-md border border-dashed border-amber-600/60 bg-amber-50/90 px-1 text-center text-[10px] font-semibold leading-tight shadow-sm"
                  style={{
                    ...getOccupiedSlotStyle(
                      {
                        day: day as "Thứ 2",
                        start: minutesToTime(segment.start),
                        end: minutesToTime(segment.end),
                      },
                      laneCount,
                      MAX_OCCUPIED_LANES,
                    ).style,
                    color: "rgb(146 64 14)",
                  }}
                >
                  <span className="line-clamp-2" aria-hidden="true">
                    +{segment.count} lớp bận
                  </span>
                </div>
              ))}
            </Fragment>
          );
        })
      : null;

  const gridOverlays = [
    ...(teacherBusyOverlays ?? []),
    ...(scheduleMode === "teacher-availability" ? ownSessionOverlays ?? [] : []),
    ...(overviewLaneOverlays ?? []),
  ];

  const handleSave = () => {
    if (clickAnchor) {
      setClickMessage("Chọn thêm một ô liền kề để hoàn tất buổi học 60 phút.");
      return;
    }
    if (slots.length === 0) {
      onSave(null);
      onClose();
      return;
    }

    if (
      hasAssignmentError ||
      hasAssignmentConflict ||
      Boolean(occupiedError) ||
      occupiedLoading
    ) {
      return;
    }

    // Payload luôn gửi teacher_ids/assistant_ids rõ ràng: mọi buổi mới mang
    // ĐÚNG giáo viên người dùng đã chọn, không tự lấy người rảnh đầu tiên.
    const payloadSlots: ScheduleSlot[] = slots.map((slot) => ({
      day: slot.day,
      start: slot.start,
      end: slot.end,
      teacher_ids: getSlotEffectiveTeacherIds(slot, defaultTeacherIds).filter(
        (id) => selectedTeacherById.has(id),
      ),
      assistant_ids: getSlotEffectiveAssistantIds(slot).filter((id) =>
        selectedAssistantById.has(id),
      ),
    }));

    const grouped: Record<string, string[]> = {};
    payloadSlots.forEach((s) => {
      if (!grouped[s.day]) grouped[s.day] = [];
      grouped[s.day].push(`${s.start}-${s.end}`);
    });

    const textParts = DAYS_OF_WEEK.filter((d) => grouped[d]).map(
      (d) => `${d} (${grouped[d].join(", ")})`,
    );

    onSave({
      text: textParts.join("; "),
      slots: payloadSlots,
    });
    sessionLineageRef.current = [];
    onClose();
  };

  const isDraftDirty =
    getScheduleDraftSnapshot(slots) !== initialScheduleSnapshot;

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex justify-end ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!isOpen}
      inert={isOpen ? undefined : true}
    >
      <div
        aria-hidden="true"
        style={getSlideBackdropStyle(transitionDuration)}
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity motion-reduce:transition-none ${isVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        onPointerDown={(event) => {
          backdropPointerDownRef.current = event.target === event.currentTarget;
        }}
        onPointerUp={(event) => {
          if (backdropPointerDownRef.current && event.target === event.currentTarget) {
            requestCloseRef.current();
          }
          backdropPointerDownRef.current = false;
        }}
        onPointerCancel={() => {
          backdropPointerDownRef.current = false;
        }}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={getSlidePanelStyle(transitionDuration)}
        className={`relative z-10 flex h-full w-full flex-col bg-white shadow-2xl transition-transform motion-reduce:transition-none lg:w-[60vw] lg:min-w-[1080px] xl:w-[58vw] xl:min-w-[1140px] ${isVisible ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-primary/15 bg-primary-soft/60 px-5 py-3.5">
          <h3 id={titleId} className="section-title-text text-primary">
            Thiết lập lịch học tuần
          </h3>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            aria-label="Đóng phần thiết lập lịch học"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md p-1 text-gray-500 transition hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div
          className={
            scheduleMode === "class-schedule"
              ? "grid flex-1 gap-3 overflow-hidden p-4 select-none lg:grid-cols-[minmax(0,1fr)_190px]"
              : "grid flex-1 gap-3 overflow-hidden p-4 select-none lg:grid-cols-[minmax(0,1fr)_220px]"
          }
        >
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200">
            {occupiedLoading ? (
              <div
                role="status"
                aria-live="polite"
                aria-busy="true"
                className="flex h-8 shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 text-[13px] font-medium text-amber-800"
              >
                <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {scheduleMode === "class-schedule"
                  ? "Đang tải lịch các lớp trong phạm vi ngày…"
                  : "Đang tải lịch dạy của các nhân sự đã chọn…"}
              </div>
            ) : occupiedError ? (
              <InlineFormError
                className="border-b border-gray-100 px-3 py-2"
                action={
                  <button
                    type="button"
                    onClick={onRetryOccupied}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-destructive transition hover:bg-destructive-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" /> Thử lại
                  </button>
                }
              >
                {occupiedError}
              </InlineFormError>
            ) : null}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {scheduleMode === "teacher-availability" ? (
                <ScheduleTeacherScope
                  teachers={selectedTeachers}
                  assistants={selectedAssistants}
                  activeTeacherId={activeTeacherId}
                  onSelectTeacher={setActiveTeacherId}
                  selectedSessionCount={renderedSlots.length}
                  maxSessionCount={MAX_WEEKLY_CLASS_SLOTS}
                />
              ) : null}

              <div className="font-body-ui grid grid-cols-[64px_repeat(7,1fr)] border-b border-gray-200 bg-gray-100 text-center text-[13px] font-medium leading-tight text-gray-800">
                <div className="border-r border-gray-200 py-1.5">Giờ</div>
                {DAYS_OF_WEEK.map((day) => (
                  <div key={day} className="border-r border-gray-200 py-1.5 last:border-r-0">
                    {day}
                  </div>
                ))}
              </div>

              <ScheduleWeekGrid
                gridRef={scheduleGridRef}
                cells={cellDescriptors}
                overlays={gridOverlays}
                dragging={isScheduleDragging}
                busy={occupiedLoading}
                onCellFocus={(dayIndex, timeIndex) =>
                  setFocusedCell({ dayIndex, timeIndex })
                }
                onCellPointerDown={handleCellPointerDown}
                onCellKeyDown={handleCellKeyDown}
                onCellClick={handleCellClick}
                onGridPointerMove={handleGridPointerMove}
                onGridPointerUp={handleGridPointerUp}
                onGridPointerCancel={handleGridPointerCancel}
                onGridLostPointerCapture={(event) => {
                  setSlotLimitMessage(false);
                  clearDragSession(event.pointerId);
                }}
              />
            </div>
          </div>

          <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
            <ScheduleSessionPanel
              slots={renderedSlots}
              committedSlots={slots}
              panelMode={panelMode}
              activeSessionKey={activeSessionKey}
              selectedTeachers={selectedTeachers}
              selectedTeacherById={selectedTeacherById}
              selectedAssistantById={selectedAssistantById}
              defaultTeacherIds={defaultTeacherIds}
              conflictBlocks={conflictBlocks}
              getSlotConflict={getSlotAssignmentConflict}
              onOpenSession={openSessionDetail}
              onBackToList={() => {
                setPanelMode("list");
                setActiveSessionKey(null);
              }}
              onDeleteSlot={(day, start, end) => {
                setSlots((current) =>
                  current.filter(
                    (candidate) =>
                      !(candidate.day === day && candidate.start === start && candidate.end === end),
                  ),
                );
                setPanelMode("list");
                setActiveSessionKey(null);
              }}
              onToggleTeacherAssignment={(day, start, end, teacherId, add) =>
                updateSlotAssignment(day, start, end, "teacher_ids", teacherId, add)
              }
              onToggleAssistantAssignment={(day, start, end, assistantId, add) =>
                updateSlotAssignment(day, start, end, "assistant_ids", assistantId, add)
              }
              legacyList={scheduleMode === "class-schedule"}
              classLabel={classLabel}
              initialSlots={initialSlots}
            />
          </aside>
        </div>

        <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-5 py-3">
          {discardPrompt ? (
            <div
              role="alertdialog"
              aria-label="Xác nhận bỏ thay đổi lịch"
              className="mb-3 flex flex-wrap items-start justify-between gap-2 text-[13px] text-amber-900"
            >
              <span className="flex min-w-0 flex-1 items-start gap-2 leading-5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span>Thay đổi lịch chưa áp dụng. Bỏ thay đổi?</span>
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-8 rounded-md px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  onClick={() => setDiscardPrompt(false)}
                >
                  Tiếp tục chỉnh sửa
                </button>
                <button
                  type="button"
                  className="h-8 rounded-md border border-amber-300 px-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30"
                  onClick={() => {
                    setDiscardPrompt(false);
                    onClose();
                  }}
                >
                  Bỏ thay đổi
                </button>
              </span>
            </div>
          ) : null}
          {slots.length >= MAX_WEEKLY_CLASS_SLOTS || slotLimitMessage || clickMessage ? (
            <div className="mb-2">
              {slots.length >= MAX_WEEKLY_CLASS_SLOTS || slotLimitMessage ? (
                <p role="status" className="text-sm font-medium text-amber-700">
                  Mỗi lớp chỉ có tối đa 4 buổi mỗi tuần.
                </p>
              ) : null}
              {clickMessage ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-[13px] font-medium leading-5 text-primary"
                >
                  {clickMessage}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-[12px] font-medium text-gray-500">
              {isDraftDirty ? "Thay đổi chưa áp dụng" : ""}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-md px-3 text-sm"
              onClick={requestClose}
            >
              Hủy
            </Button>
            <Button
              type="button"
              className="h-8 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              disabled={
                hasAssignmentError ||
                hasAssignmentConflict ||
                Boolean(occupiedError) ||
                occupiedLoading ||
                Boolean(clickAnchor)
              }
              onClick={handleSave}
            >
              {occupiedError
                ? scheduleMode === "class-schedule"
                  ? "Không thể xác nhận khi chưa tải được lịch bận"
                  : "Áp dụng lịch"
                : clickAnchor
                  ? "Chọn thêm một ô liền kề"
                  : hasAssignmentError
                    ? "Có buổi chưa có giáo viên"
                    : hasAssignmentConflict
                      ? "Có nhân sự đã bận ở buổi đang chọn"
                      : scheduleMode === "class-schedule"
                        ? "Xác nhận"
                        : "Áp dụng lịch"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function measureScheduleGridGeometry(
  grid: HTMLDivElement | null,
  version: number,
): ScheduleGridGeometry | null {
  if (!grid) return null;

  const gridRect = grid.getBoundingClientRect();

  const rowRects = TIME_BLOCKS.map((_, timeIndex) => {
    const cell = grid.querySelector<HTMLElement>(
      `[data-day-index="0"][data-time-index="${timeIndex}"]`,
    );
    const rect = cell?.getBoundingClientRect();
    return rect ? { top: rect.top, bottom: rect.bottom } : null;
  });

  const dayRects = DAYS_OF_WEEK.map((_, dayIndex) => {
    const cell = grid.querySelector<HTMLElement>(
      `[data-day-index="${dayIndex}"][data-time-index="0"]`,
    );
    const rect = cell?.getBoundingClientRect();
    return rect ? { left: rect.left, right: rect.right } : null;
  });

  if (rowRects.some((r) => r === null) || dayRects.some((d) => d === null)) {
    return null;
  }

  return buildScheduleGridGeometry(
    {
      top: gridRect.top,
      bottom: gridRect.bottom,
      left: gridRect.left,
      right: gridRect.right,
    },
    rowRects as Array<{ top: number; bottom: number }>,
    dayRects as Array<{ left: number; right: number }>,
    version,
  );
}
