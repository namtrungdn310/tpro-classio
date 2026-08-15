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
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RiCloseLine as X, RiLoader4Line as LoaderCircle, RiRefreshLine as RefreshCw } from "react-icons/ri";
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
import { abbreviateClassName } from "@/lib/utils/class-groups";
import {
  getClassGroupInfoForRecord,
  getSlotEffectiveAssistantIds,
  getSlotEffectiveTeacherIds,
} from "@/lib/classes/presentation";
import type { ClassCategory, ClassResponse, TeacherOptionResponse } from "@/lib/types";
import { DAYS_OF_WEEK, formatTimeBlock, TIME_BLOCKS, type ScheduleSlot } from "@/components/layout/weekly-schedule-board";
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
const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
};

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

/**
 * Tìm session đã xóa cùng ngày giao khoảng lớn nhất với slot mới — lineage
 * theo ĐÚNG session/interval, không lấy nhầm phân công của buổi khác cùng
 * ngày.
 */
const findLineageSession = (
  lineage: ReadonlyArray<{
    day: string;
    start: string;
    end: string;
    teacher_ids: string[];
    assistant_ids: string[];
  }>,
  nextSlot: ScheduleSlot,
):
  | { teacher_ids: string[]; assistant_ids: string[] }
  | undefined => {
  const nextStart = timeToMinutes(nextSlot.start);
  const nextEnd = timeToMinutes(nextSlot.end);
  let best: { teacher_ids: string[]; assistant_ids: string[] } | undefined;
  let bestOverlap = 0;
  for (const candidate of lineage) {
    if (candidate.day !== nextSlot.day) continue;
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
}: ScheduleGridSlideProps) {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [dragPreview, setDragPreview] = useState<ScheduleDragPreview | null>(null);
  const [clickAnchor, setClickAnchor] = useState<ScheduleClickAnchor | null>(null);
  const [clickMessage, setClickMessage] = useState<string | null>(null);
  const [isScheduleDragging, setIsScheduleDragging] = useState(false);
  const [slotLimitMessage, setSlotLimitMessage] = useState(false);
  const [focusedCell, setFocusedCell] = useState({ dayIndex: 0, timeIndex: 0 });
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scheduleGridRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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
  // Đánh dấu cử chỉ pointer vừa chạy: click-fallback (event.detail === 0)
  // chỉ dành cho assistive technology / keyboard, KHÔNG tạo buổi từ tap touch.
  const pointerGestureRef = useRef(false);
  // Lineage của các buổi đã xóa (theo session/interval, KHÔNG theo ngày) để
  // vẽ lại sau khi đổi biên giờ không lấy nhầm phân công của buổi khác cùng
  // ngày.
  const sessionLineageRef = useRef<
    Array<{
      day: string;
      start: string;
      end: string;
      teacher_ids: string[];
      assistant_ids: string[];
    }>
  >([]);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const { durationMs: transitionDuration, isReady: isMotionReady } =
    useSlidePanelMotion(dialogRef, shouldRender);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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

    // Two frames guarantee that the measured off-screen state is painted once,
    // even when React flushes an interaction effect before the browser paints.
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
      if (currentValue && Array.isArray(currentValue.slots)) {
        setSlots(currentValue.slots);
      } else {
        setSlots([]);
      }
      setSlotLimitMessage(false);
      setClickAnchor(null);
      setClickMessage(null);
      sessionLineageRef.current = [];

      setFocusedCell({ dayIndex: 0, timeIndex: 0 });
    }
  }, [currentValue, isOpen]);

  // Geometry is deliberately invalidated by layout signals instead of being
  // rebuilt for every raw pointer event. Observing the representative cells
  // matters: flex can redistribute row heights without changing the outer
  // grid rectangle, which a grid-only observer would miss.
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
  }, [isOpen]);

  const releasePointerCapture = useCallback((pointerId: number) => {
    const grid = scheduleGridRef.current;
    if (!grid) return;
    if (grid.hasPointerCapture(pointerId)) {
      grid.releasePointerCapture(pointerId);
    }
  }, []);

  const clearDragSession = useCallback((pointerId: number) => {
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
  }, [releasePointerCapture]);

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
        onCloseRef.current();
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
  }, [clearDragSession, clickAnchor, isOpen]);

  // Lookup tên theo id cho pool GV/TG ĐÃ CHỌN của lớp. Slot mới chỉ được gán
  // trong tập này — nhân sự ngoài tập không bao giờ xuất hiện ở panel lịch.
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

  // Danh sách block trực quan đã normalize: dedupe bằng classId + ngày + giờ,
  // sort theo day/start/end/className để thứ tự vẽ ổn định. Mỗi buổi bận chỉ
  // render ĐÚNG MỘT block chứa tên lớp; không tô từng ô 30 phút phía sau.
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

  // Check if a cell is selected by checking if it belongs to the rendered
  // block set, which reflects the drag preview while a gesture is active.
  const isCellSelected = (day: string, timeBlock: string) =>
    renderedBlocks.has(`${day}-${timeBlock}`);

  // Nhớ phân công của buổi vừa bị xóa theo session (day + interval) để vẽ lại
  // Nhân sự bận tại từng ô 30 phút theo vai trò. Block không kèm staff (dữ
  // liệu cũ) được coi là bận với TOÀN BỘ GV đã chọn — bảo toàn hành vi chặn
  // cũ cho dữ liệu thiếu thông tin.
  const busyStaffAtBlock = useCallback(
    (day: string, timeBlock: string, role: "TEACHER" | "ASSISTANT"): Set<string> => {
      const blockStart = timeToMinutes(timeBlock);
      const blockEnd = blockStart + 30;
      const busy = new Set<string>();
      for (const slot of normalizedOccupiedBlocks) {
        if (slot.day !== day) continue;
        const slotStart = timeToMinutes(slot.start);
        const slotEnd = timeToMinutes(slot.end);
        if (!(slotStart < blockEnd && blockStart < slotEnd)) continue;
        const roleIds = role === "TEACHER" ? slot.busyTeacherIds : slot.busyAssistantIds;
        if (roleIds && roleIds.length > 0) {
          for (const staffId of roleIds) busy.add(staffId);
        } else if (role === "TEACHER" && (!slot.busyTeacherIds || slot.busyTeacherIds.length === 0)) {
          // Block legacy không kèm busy teacher: quy ước bận với toàn bộ GV đã chọn.
          if (
            slot.busyTeacherIds === undefined &&
            slot.busyAssistantIds === undefined
          ) {
            for (const teacherId of defaultTeacherIds) busy.add(teacherId);
          }
        }
      }
      return busy;
    },
    [defaultTeacherIds, normalizedOccupiedBlocks],
  );

  // Ô chỉ bị khóa khi TOÀN BỘ giáo viên đã chọn đều bận: một giáo viên bận
  // không khóa giáo viên khác đang rảnh; trợ giảng bận không bao giờ khóa ô.
  // Block không kèm staff info (dữ liệu cũ) chặn ô theo quy ước cũ.
  const isCellFullyBooked = useCallback(
    (day: string, timeBlock: string) => {
      const blockStart = timeToMinutes(timeBlock);
      const blockEnd = blockStart + 30;
      const hasLegacyBlock = normalizedOccupiedBlocks.some((slot) => {
        if (slot.day !== day) return false;
        const slotStart = timeToMinutes(slot.start);
        const slotEnd = timeToMinutes(slot.end);
        return (
          slotStart < blockEnd &&
          blockStart < slotEnd &&
          slot.busyTeacherIds === undefined &&
          slot.busyAssistantIds === undefined
        );
      });
      if (hasLegacyBlock) return true;
      if (defaultTeacherIds.length === 0) return false;
      const busy = busyStaffAtBlock(day, timeBlock, "TEACHER");
      return defaultTeacherIds.every((teacherId) => busy.has(teacherId));
    },
    [busyStaffAtBlock, defaultTeacherIds, normalizedOccupiedBlocks],
  );

  // Nhân sự rảnh xuyên suốt TOÀN BỘ interval (mọi block 30 phút trong đó).
  const getFreeStaffForInterval = useCallback(
    (
      day: string,
      startMinutes: number,
      endMinutes: number,
      role: "TEACHER" | "ASSISTANT",
    ): string[] => {
      const busy = new Set<string>();
      for (let minutes = startMinutes; minutes < endMinutes; minutes += 30) {
        for (const staffId of busyStaffAtBlock(day, minutesToTime(minutes), role)) {
          busy.add(staffId);
        }
      }
      const pool = role === "TEACHER" ? defaultTeacherIds : defaultAssistantIds;
      return pool.filter((staffId) => !busy.has(staffId));
    },
    [busyStaffAtBlock, defaultAssistantIds, defaultTeacherIds],
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
        isCellFullyBooked(DAYS_OF_WEEK[dragPreview.dayIndex], TIME_BLOCKS[blockIndex]),
    );
  })();

  const renderedSlots = getMergedSlots([...renderedBlocks]);
  // An end time is a boundary, not another persisted 30-minute block. The UI
  // nevertheless keeps that boundary's row visibly filled so users can see
  // exactly where their drag ended. Deriving it from renderedSlots makes the
  // cue identical during preview and after commit without changing saved data.
  const renderedEndpointCells = new Set(
    renderedSlots
      .filter((slot) => TIME_BLOCKS.includes(slot.end))
      .map((slot) => `${slot.day}-${slot.end}`),
  );
  const committedEndpointCells = new Set(
    slots
      .filter((slot) => TIME_BLOCKS.includes(slot.end))
      .map((slot) => `${slot.day}-${slot.end}`),
  );

  // sau khi đổi biên giờ không lấy nhầm phân công của buổi khác cùng ngày.
  const rememberErasedSession = useCallback(
    (slot: ScheduleSlot) => {
      sessionLineageRef.current.push({
        day: slot.day,
        start: slot.start,
        end: slot.end,
        teacher_ids: getSlotEffectiveTeacherIds(slot, defaultTeacherIds),
        assistant_ids: getSlotEffectiveAssistantIds(slot),
      });
      if (sessionLineageRef.current.length > 8) {
        sessionLineageRef.current.shift();
      }
    },
    [defaultTeacherIds],
  );

  // Áp dụng phân công cho slot vừa commit:
  // - slot trùng buổi cũ (theo khoảng giao ngày) giữ nguyên phân công trước đó;
  // - slot vừa bị xóa rồi vẽ lại dùng lineage của ĐÚNG session đó;
  // - slot hoàn toàn mới gán nhân sự RẢNH xuyên suốt interval (không gán người
  //   đang bận rồi chờ backend báo lỗi).
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
        const remembered = findLineageSession(sessionLineageRef.current, slot);
        if (remembered) {
          return {
            ...slot,
            teacher_ids: remembered.teacher_ids,
            assistant_ids: remembered.assistant_ids,
          };
        }
        const startMinutes = timeToMinutes(slot.start);
        const endMinutes = timeToMinutes(slot.end);
        return {
          ...slot,
          teacher_ids: getFreeStaffForInterval(
            slot.day,
            startMinutes,
            endMinutes,
            "TEACHER",
          ),
          assistant_ids: getFreeStaffForInterval(
            slot.day,
            startMinutes,
            endMinutes,
            "ASSISTANT",
          ),
        };
      }),
    [
      defaultAssistantIds,
      defaultTeacherIds,
      getFreeStaffForInterval,
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
          const next = add
            ? [...list, id]
            : list.filter((candidate) => candidate !== id);
          return { ...slot, [field]: next };
        }),
      );
    },
    [],
  );

  const getBlockedClassColor = (slot: OccupiedScheduleSlot) => {
    return getClassGroupInfoForRecord({
      name: slot.className,
      class_category: slot.classCategory ?? null,
      grade_level: slot.gradeLevel ?? null,
    } as ClassResponse).color;
  };

  // Mọi buổi đã commit phải còn ít nhất một giáo viên thuộc tập đã chọn.
  const hasAssignmentError = useMemo(
    () =>
      slots.some((slot) => {
        const effective = getSlotEffectiveTeacherIds(slot, defaultTeacherIds);
        return effective.filter((id) => selectedTeacherById.has(id)).length === 0;
      }),
    [defaultTeacherIds, selectedTeacherById, slots],
  );

  // Nhân sự đã phân công cho buổi cũ nhưng nay bị bận (availability mới):
  // hiển thị lỗi cụ thể và chặn xác nhận cho tới khi user xử lý.
  const getSlotAssignmentConflict = (
    slot: ScheduleSlot,
  ): { busyTeachers: string[]; busyAssistants: string[] } | null => {
    const assignedTeachers = getSlotEffectiveTeacherIds(
      slot,
      defaultTeacherIds,
    ).filter((id) => selectedTeacherById.has(id));
    const assignedAssistants = getSlotEffectiveAssistantIds(slot);
    const freeTeachers = getFreeStaffForInterval(
      slot.day,
      timeToMinutes(slot.start),
      timeToMinutes(slot.end),
      "TEACHER",
    );
    const freeAssistants = getFreeStaffForInterval(
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
  };
  const hasAssignmentConflict = slots.some(
    (slot) => getSlotAssignmentConflict(slot) !== null,
  );

  // Lane theo interval partitioning (KHÔNG dùng connected component): sort theo
  // start/end/key rồi reuse lane khi interval trước đã kết thúc. Số lane = số
  // block đồng thời tối đa. Hiển thị tối đa MAX_OCCUPIED_LANES lane cho block
  // thật; concurrency vượt mức này được gộp thành summary riêng (lane dự trữ)
  // không phủ lên block khác.
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
          // Half-open [start, end): chỉ chạm biên (last.end === start) không
          // overlap — block kế tiếp tái sử dụng lane.
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
      // Sweep-line segment cho hidden count: tại mỗi đoạn giữa hai boundary,
      // hidden = số block đang active - số lane hiển thị (MAX_OCCUPIED_LANES).
      // "+n" đúng theo từng đoạn, KHÔNG gộp bắc cầu theo connected cluster và
      // không phụ thuộc thứ tự greedy lane. Merge đoạn kề chỉ khi cùng count.
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
      layouts.set(day, { lanes, overflowSegments });
    }
    return layouts;
  }, [normalizedOccupiedBlocks]);

  const getOccupiedSlotStyle = (slot: OccupiedScheduleSlot, laneCount: number, laneIndex: number) => {
    const gridStart = timeToMinutes(TIME_BLOCKS[0]);
    const gridEnd = timeToMinutes(TIME_BLOCKS[TIME_BLOCKS.length - 1]) + 30;
    const gridDuration = gridEnd - gridStart;
    const slotStart = Math.max(gridStart, timeToMinutes(slot.start));
    const slotEnd = Math.min(gridEnd, timeToMinutes(slot.end));
    const dayIndex = DAYS_OF_WEEK.indexOf(slot.day);
    const color = getBlockedClassColor(slot);
    const normalizedLaneIndex = Math.min(Math.max(0, laneIndex), laneCount - 1);

    return {
      color,
      style: {
        left: `calc(72px + ((100% - 72px) / 7) * ${dayIndex} + 4px + (((100% - 72px) / 7 - 8px) / ${laneCount}) * ${normalizedLaneIndex})`,
        top: `calc(${((slotStart - gridStart) / gridDuration) * 100}% + 2px)`,
        width: `calc(((100% - 72px) / 7 - 8px) / ${laneCount} - 2px)`,
        height: `calc(${((slotEnd - slotStart) / gridDuration) * 100}% - 4px)`,
      },
    };
  };

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
        return "Giáo viên đã bận ở khung giờ này.";
      case "outside-range":
        return "Khung giờ này nằm ngoài phạm vi có thể thiết lập.";
      default:
        return null;
    }
  };

  const handleCellActivation = (
    day: string,
    timeBlock: string,
    dayIndex: number,
    timeIndex: number,
  ) => {
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
        isCellFullyBooked(
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

    if (result.reason === "created" || result.reason === "extended") {
      const clickedMinutes = timeToMinutes(timeBlock);
      const affectedSlot = nextSlots.find(
        (slot) =>
          slot.day === day &&
          timeToMinutes(slot.start) <= clickedMinutes &&
          clickedMinutes < timeToMinutes(slot.end),
      );
      if (affectedSlot && defaultTeacherIds.length > 0) {
        const freeTeachers = getFreeStaffForInterval(
          day,
          timeToMinutes(affectedSlot.start),
          timeToMinutes(affectedSlot.end),
          "TEACHER",
        );
        if (freeTeachers.length === 0) {
          setClickAnchor(null);
          setClickMessage("Không còn giáo viên rảnh xuyên suốt khung giờ này.");
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

    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    pointerGestureRef.current = true;
    const isCommittedEndpoint = committedEndpointCells.has(`${day}-${timeBlock}`);
    if (!isCommittedEndpoint && isCellFullyBooked(day, timeBlock)) {
      return;
    }
    setSlotLimitMessage(false);

    const baseBlocks = new Set(unpackSlotsToBlocks(slots));
    const clickedKey = getScheduleBlockKey(dayIndex, timeIndex);
    const mode =
      baseBlocks.has(clickedKey) || isCommittedEndpoint
        ? "erasing"
        : "painting";
    // Chưa có dữ liệu lịch bận (đang tải / lỗi) thì không cho vẽ mới — chỉ
    // được xóa buổi của chính lớp mình để tránh vẽ đè lên lịch chưa biết.
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
    // The helper intentionally keeps the preview null until the gesture spans
    // at least two 30-minute blocks (the one-hour business minimum).
    setDragPreview(createScheduleDragPreview(session));
    capturePointer(event.pointerId);
  };

  const isPreviewBlocked = (dayIndex: number, blockIndex: number) =>
    isCellFullyBooked(DAYS_OF_WEEK[dayIndex], TIME_BLOCKS[blockIndex]);

  const applyPointerPosition = (clientY: number) => {
    const session = dragSessionRef.current;
    if (!session) return;
    let geometry = dragGridGeometryRef.current;
    let geometryWasRefreshed = false;

    // Invalidate the geometry if the grid has resized since it was measured
    // (viewport / font / flex reflow), and re-measure only when necessary.
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

    // Only the latest pointer coordinate is the source of truth; the pointer
    // path is never replayed to build the interval.
    const boundary = resolveScheduleBoundary(clientY, geometry);
    if (boundary === session.currentBoundary && !geometryWasRefreshed) return;

    const nextSession =
      boundary === session.currentBoundary
        ? session
        : updateScheduleDragSession(session, boundary);
    dragSessionRef.current = nextSession;
    const preview = createScheduleDragPreview(nextSession);

    // An endpoint can always be dragged upward to shorten its own session,
    // but extending it downward requires a trustworthy availability snapshot.
    if (
      nextSession.mode === "painting" &&
      (occupiedLoading || Boolean(occupiedError))
    ) {
      setDragPreview(null);
      return;
    }

    if (!preview) {
      // Quay lại anchor: hủy preview, chờ mốc mới.
      setDragPreview(null);
      setSlotLimitMessage(false);
      return;
    }

    const nextBlocks = applyScheduleDragPreview(
      nextSession.baseBlocks,
      preview,
      getScheduleBlockKey,
      (blockIndex) => isPreviewBlocked(nextSession.dayIndex, blockIndex),
    );
    if (getMergedSlots([...nextBlocks]).length > MAX_WEEKLY_CLASS_SLOTS) {
      // Không render buổi thứ 5 rồi mới báo: giữ preview hợp lệ cuối cùng,
      // chỉ báo giới hạn để người dùng kéo ngược lại.
      setSlotLimitMessage(true);
      return;
    }
    // Không còn GV rảnh xuyên suốt interval (mọi block đều bận hết) thì
    // không mở rộng preview — chặn tạo buổi không thể phân công.
    if (
      nextSession.mode === "painting" &&
      preview.interval &&
      defaultTeacherIds.length > 0
    ) {
      const freeTeachers = getFreeStaffForInterval(
        DAYS_OF_WEEK[nextSession.dayIndex],
        scheduleBoundaryToMinutes(preview.interval.startBoundary),
        scheduleBoundaryToMinutes(preview.interval.endBoundary),
        "TEACHER",
      );
      if (freeTeachers.length === 0) {
        return;
      }
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
    // Capture the last pointermove boundary before the pointerup coordinate
    // can overwrite it.
    const sessionAtLastMove = dragSessionRef.current;
    if (sessionAtLastMove) {
      // pointerup coordinates are authoritative even without a final move.
      applyPointerPosition(event.clientY);
      const session = dragSessionRef.current ?? sessionAtLastMove;
      const geometry = dragGridGeometryRef.current;
      const boundary = geometry ? resolveScheduleBoundary(event.clientY, geometry) : session.currentBoundary;
      const candidateSession: ScheduleDragSession = {
        ...session,
        currentBoundary: boundary,
      };
      // The pointerup coordinate can land on the seam between the two cells
      // of a short slot and collapse the interval back to the anchor (e.g.
      // releasing right on the shared border of a two-block slot erased from
      // its bottom cell). Fall back to the last pointermove boundary so the
      // gesture still commits instead of silently discarding the erase.
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
        // Contract B.1: một buổi tối thiểu 60 phút. Preview 30 phút (1 block)
        // được hiển thị để phản hồi pointer ngay, nhưng KHÔNG commit khi
        // nhả chuột trên interval chưa đủ 2 block.
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
          (blockIndex) => isPreviewBlocked(finalSession.dayIndex, blockIndex),
        );
        const nextSlots = getMergedSlots([...nextBlocks]);
        // Erasing can fragment a slot into a sub-60‑minute stub.
        // Auto‑drop any orphan shorter than the minimum session length so a
        // partial drag-back never creates an invalid single‑block schedule.
        // Painting never produces orphans because the interval is already
        // gated at ≥ 2 blocks, so only erase-mode results need cleanup.
        const cleanedSlots =
          finalPreview.mode === "erasing"
            ? nextSlots.filter(
                (slot) =>
                  timeToMinutes(slot.end) - timeToMinutes(slot.start) >=
                  MIN_SCHEDULE_SESSION_BLOCKS * 30,
              )
            : nextSlots;
        // Painting không còn GV rảnh xuyên suốt interval: không commit buổi
        // không thể phân công.
        if (
          finalPreview.mode === "painting" &&
          defaultTeacherIds.length > 0
        ) {
          const freeTeachers = getFreeStaffForInterval(
            DAYS_OF_WEEK[finalSession.dayIndex],
            scheduleBoundaryToMinutes(finalPreview.interval.startBoundary),
            scheduleBoundaryToMinutes(finalPreview.interval.endBoundary),
            "TEACHER",
          );
          if (freeTeachers.length === 0) {
            setSlotLimitMessage(false);
            clearDragSession(event.pointerId);
            return;
          }
        }
        if (cleanedSlots.length > MAX_WEEKLY_CLASS_SLOTS) {
          setSlotLimitMessage(true);
        } else {
          setSlotLimitMessage(false);
          if (finalPreview.mode === "erasing" && finalPreview.interval) {
            // Nhớ phân công các slot bị xóa trong vùng kéo để vẽ lại sau khi
            // đổi biên giờ không mất nhân sự đã phân công.
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
      isCellFullyBooked(DAYS_OF_WEEK[nextDayIndex], TIME_BLOCKS[nextTimeIndex])
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
      if (!isCellFullyBooked(day, timeBlock)) {
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

    // Payload luôn gửi teacher_ids/assistant_ids rõ ràng, khớp chính xác với
    // preview: effective staff của từng buổi giao với pool đã chọn. Assistant
    // rỗng giữ rỗng — không bao giờ fallback sang pool trợ giảng.
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
      (d) => `${d} (${grouped[d].join(", ")})`
    );

    onSave({
      text: textParts.join("; "),
      slots: payloadSlots,
    });
    sessionLineageRef.current = [];
    onClose();
  };

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
            onClose();
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
        className={`relative z-10 flex h-full w-full flex-col bg-white shadow-2xl transition-transform motion-reduce:transition-none lg:w-[52vw] lg:min-w-[960px] ${isVisible ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-primary/15 bg-primary-soft/60 px-5 py-3.5">
          <h3 id={titleId} className="section-title-text text-primary">
            Thiết lập lịch học tuần
          </h3>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Đóng phần thiết lập lịch học"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md p-1 text-gray-500 transition hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="grid flex-1 gap-3 overflow-hidden p-4 select-none lg:grid-cols-[minmax(0,1fr)_200px]">
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200">
            {occupiedLoading ? (
              <div
                role="status"
                aria-live="polite"
                aria-busy="true"
                className="flex h-8 shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 text-[13px] font-medium text-amber-800"
              >
                <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Đang tải lịch dạy của các nhân sự đã chọn…
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
            <div className="font-body-ui grid grid-cols-[72px_repeat(7,1fr)] border-b border-gray-200 bg-gray-100 text-center text-[15px] font-medium leading-5 text-gray-800">
              <div className="border-r border-gray-200 py-2">Giờ</div>
              {DAYS_OF_WEEK.map((day) => (
                <div key={day} className="border-r border-gray-200 py-2 last:border-r-0">
                  {day}
                </div>
              ))}
            </div>

            <div
              ref={scheduleGridRef}
              className="relative flex flex-1 flex-col"
              data-schedule-grid="true"
              data-schedule-dragging={isScheduleDragging ? true : undefined}
              aria-busy={occupiedLoading || undefined}
              onPointerMove={handleGridPointerMove}
              onPointerUp={handleGridPointerUp}
              onPointerCancel={handleGridPointerCancel}
              onLostPointerCapture={(event) => {
                setSlotLimitMessage(false);
                clearDragSession(event.pointerId);
              }}
            >
              {TIME_BLOCKS.map((timeBlock, timeIndex) => (
                  <div key={timeBlock} className="relative grid flex-1 grid-cols-[72px_repeat(7,1fr)] text-center">
                  <div className={`font-body-ui flex items-center justify-center border-r border-gray-200 bg-primary-soft/40 text-[15px] font-medium leading-4 text-gray-700 ${timeIndex > 0 ? "border-t border-gray-200/80" : ""}`}>
                    {formatTimeBlock(timeBlock)}
                  </div>
                  {DAYS_OF_WEEK.map((day, dayIndex) => {
                    const selected = isCellSelected(day, timeBlock);
                    const fullyBooked = isCellFullyBooked(day, timeBlock);
                    const isClickAnchor =
                      clickAnchor?.dayIndex === dayIndex &&
                      clickAnchor.blockIndex === timeIndex;
                    const isEndpointCell = renderedEndpointCells.has(
                      `${day}-${timeBlock}`,
                    );
                    const isAnchorCell =
                      dragPreview &&
                      dragPreview.anchorBoundary === timeIndex &&
                      dragPreview.dayIndex === dayIndex &&
                      selected;
                    const showAsGray = selected || isClickAnchor || isEndpointCell;
                    return (
                      <button
                        type="button"
                        key={day}
                        title={fullyBooked ? "Giáo viên đã có lớp ở khung giờ này" : undefined}
                        aria-label={`${day}, ${timeBlock} đến ${minutesToTime(timeToMinutes(timeBlock) + 30)}${fullyBooked ? ", giáo viên đã có lớp" : selected ? ", đã chọn" : isClickAnchor ? ", đang chờ chọn ô liền kề" : isEndpointCell ? ", mốc kết thúc" : ", chưa chọn"}`}
                        aria-pressed={selected}
                        aria-disabled={fullyBooked}
                        tabIndex={
                          focusedCell.dayIndex === dayIndex && focusedCell.timeIndex === timeIndex
                            ? 0
                            : -1
                        }
                        data-schedule-day={day}
                        data-schedule-time={timeBlock}
                        data-day-index={dayIndex}
                        data-time-index={timeIndex}
                        data-click-anchor={isClickAnchor ? "true" : undefined}
                        data-schedule-endpoint={isEndpointCell ? "true" : undefined}
                        onFocus={() => setFocusedCell({ dayIndex, timeIndex })}
                        onPointerDown={(event) =>
                          handleCellPointerDown(
                            event,
                            day,
                            timeBlock,
                            dayIndex,
                            timeIndex,
                          )
                        }
                        onKeyDown={(event) => handleCellKeyDown(event, dayIndex, timeIndex)}
                        onClick={(event) => {
                          // Assistive technologies may dispatch click without a
                          // preceding key event. Pointer/touch taps are already
                          // handled once on pointerup, so their synthetic click
                          // must be consumed rather than applied twice.
                          const fromPointer = pointerGestureRef.current;
                          pointerGestureRef.current = false;
                          if (event.detail === 0 && !fullyBooked && !fromPointer) {
                            handleCellActivation(
                              day,
                              timeBlock,
                              dayIndex,
                              timeIndex,
                            );
                          }
                        }}
                        className={`touch-none border-r border-t border-gray-200/80 transition-colors duration-100 ease-out focus-visible:relative focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 ${fullyBooked
                          ? "cursor-not-allowed bg-gray-50"
                          : showAsGray
                            ? isClickAnchor
                              ? "schedule-grid-cell-pending cursor-pointer shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_55%,transparent)] outline outline-1 outline-dashed outline-offset-[-3px] outline-primary/60"
                              : isEndpointCell
                                ? "schedule-grid-cell-endpoint cursor-crosshair"
                              : isAnchorCell
                              ? "schedule-grid-cell-anchor cursor-crosshair shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_50%,transparent)]"
                              : "schedule-grid-cell-selected cursor-crosshair shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_30%,transparent)]"
                            : `schedule-grid-cell-idle cursor-pointer ${timeIndex === 0 ? "border-t-0" : ""}`
                          }`}
                      />
                    );
                  })}
                </div>
              ))}

              {[...dayLaneLayouts.entries()].map(([day, layout]) => {
                const laneCount =
                  layout.lanes.length +
                  (layout.overflowSegments.length > 0 ? 1 : 0);
                return (
                  <Fragment key={`day-${day}`}>
                    {layout.lanes.map((lane, laneIndex) =>
                      lane.map((slot) => {
                        const { color, style } = getOccupiedSlotStyle(
                          slot,
                          laneCount,
                          laneIndex,
                        );
                        const busyRoles = [
                          ...(slot.busyTeacherIds?.length
                            ? ["giáo viên bận"]
                            : []),
                          ...(slot.busyAssistantIds?.length
                            ? ["trợ giảng bận"]
                            : []),
                        ].join(", ");
                        return (
                          <div
                            key={`${slot.classId ?? slot.className}-${slot.day}-${slot.start}-${slot.end}`}
                            title={
                              busyRoles
                                ? `${slot.className} (${slot.start}-${slot.end}) — ${busyRoles}`
                                : `${slot.className} (${slot.start}-${slot.end})`
                            }
                            aria-label={
                              busyRoles
                                ? `${slot.className}, ${slot.day} ${slot.start} đến ${slot.end}, ${busyRoles}`
                                : `${slot.className}, ${slot.day} ${slot.start} đến ${slot.end}`
                            }
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
                              className: "+n",
                              classId: "",
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
              })}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
            <h4 className="section-title-text border-b border-gray-200 px-3 py-3 text-gray-900">
              Danh sách chi tiết
            </h4>

            {renderedSlots.length === 0 ? (
              <p className="helper-text px-3 py-3 italic text-gray-400">Chưa chọn khung giờ nào.</p>
            ) : (
              <div className="flex flex-1 flex-col items-stretch gap-2 overflow-y-auto px-3 py-3">
                {renderedSlots.map((slot, index) => {
                  const committed = slots.find(
                    (candidate) =>
                      candidate.day === slot.day &&
                      candidate.start === slot.start &&
                      candidate.end === slot.end,
                  );
                  const effectiveTeacherIds = getSlotEffectiveTeacherIds(
                    committed ?? slot,
                    defaultTeacherIds,
                  );
                  const assignedTeacherIds = effectiveTeacherIds.filter((id) =>
                    selectedTeacherById.has(id),
                  );
                  const effectiveAssistantIds = getSlotEffectiveAssistantIds(
                    committed ?? slot,
                  );
                  const assignedAssistantIds = effectiveAssistantIds.filter((id) =>
                    selectedAssistantById.has(id),
                  );
                  const missingTeacher = assignedTeacherIds.length === 0;
                  const slotConflict = getSlotAssignmentConflict(committed ?? slot);
                  const slotHasConflict = slotConflict !== null;
                  return (
                    <div
                      key={`${slot.day}-${slot.start}-${slot.end}-${index}`}
                      className={`flex flex-col gap-1.5 rounded-lg border bg-white px-2.5 py-2 ${
                        slotHasConflict
                          ? "border-amber-300 bg-amber-50/60"
                          : "border-gray-200"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-body-ui whitespace-nowrap text-[15px] font-medium leading-5 text-gray-800">
                          {slot.day} ({slot.start}-{slot.end})
                        </span>
                        {committed ? (
                          <button
                            type="button"
                            aria-label={`Xoá buổi ${slot.day} ${slot.start}-${slot.end}`}
                            onClick={() =>
                              setSlots((current) =>
                                current.filter(
                                  (candidate) =>
                                    !(
                                      candidate.day === slot.day &&
                                      candidate.start === slot.start &&
                                      candidate.end === slot.end
                                    ),
                                ),
                              )
                            }
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                      {committed ? (
                        <div className="flex flex-col gap-1">
                          {selectedTeachers.length === 1 ? (
                            // Một GV: tóm tắt cố định, không render choice thừa.
                            <p className="text-[12px] font-medium leading-5 text-gray-700">
                              GV: {selectedTeachers[0].full_name}
                            </p>
                          ) : selectedTeachers.length > 1 ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="helper-text text-[12px] font-medium text-gray-500">
                                GV:
                              </span>
                              {selectedTeachers.map((teacher) => {
                                const selected = assignedTeacherIds.includes(teacher.id);
                                return (
                                  <button
                                    key={teacher.id}
                                    type="button"
                                    aria-pressed={selected}
                                    disabled={
                                      selected &&
                                      assignedTeacherIds.length === 1
                                    }
                                    title={
                                      selected && assignedTeacherIds.length === 1
                                        ? "Mỗi buổi phải còn ít nhất một giáo viên"
                                        : undefined
                                    }
                                    onClick={() =>
                                      updateSlotAssignment(
                                        slot.day,
                                        slot.start,
                                        slot.end,
                                        "teacher_ids",
                                        teacher.id,
                                        !selected,
                                      )
                                    }
                                    className={`min-h-10 rounded-full border px-3 py-1 text-[12px] font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 ${
                                      selected
                                        ? "border-gray-700 bg-gray-800 text-white"
                                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                                    }`}
                                  >
                                    {teacher.full_name}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {selectedAssistants.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="helper-text text-[12px] font-medium text-gray-500">
                                TG:
                              </span>
                              {selectedAssistants.map((assistant) => {
                                const selected = assignedAssistantIds.includes(assistant.id);
                                return (
                                  <button
                                    key={assistant.id}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() =>
                                      updateSlotAssignment(
                                        slot.day,
                                        slot.start,
                                        slot.end,
                                        "assistant_ids",
                                        assistant.id,
                                        !selected,
                                      )
                                    }
                                    className={`min-h-10 rounded-full border px-3 py-1 text-[12px] font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                                      selected
                                        ? "border-gray-700 bg-gray-800 text-white"
                                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                                    }`}
                                  >
                                    {assistant.full_name}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {missingTeacher ? (
                            <p role="alert" className="text-[12px] font-medium leading-4 text-destructive">
                              Buổi này không còn giáo viên. Chọn lại giáo viên hoặc xóa buổi.
                            </p>
                          ) : null}
                          {slotHasConflict && slotConflict ? (
                            <p role="alert" className="text-[12px] font-medium leading-4 text-amber-800">
                              {[
                                ...(slotConflict.busyTeachers.length > 0
                                  ? [
                                      `Giáo viên ${slotConflict.busyTeachers
                                        .map((id) => selectedTeacherById.get(id)?.full_name ?? "đã chọn")
                                        .join(", ")} hiện đã bận khung giờ này`,
                                    ]
                                  : []),
                                ...(slotConflict.busyAssistants.length > 0
                                  ? [
                                      `Trợ giảng ${slotConflict.busyAssistants
                                        .map((id) => selectedAssistantById.get(id)?.full_name ?? "đã chọn")
                                        .join(", ")} hiện đã bận khung giờ này`,
                                    ]
                                  : []),
                              ].join(". ")}
                              . Vui lòng chọn nhân sự khác hoặc đổi giờ.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {slotLimitMessage ? (
              <p role="status" className="px-3 pb-3 text-sm font-medium text-amber-700">
                Mỗi lớp chỉ có tối đa 4 buổi mỗi tuần.
              </p>
            ) : null}
            {clickMessage ? (
              <p
                role="status"
                aria-live="polite"
                className="px-3 pb-3 text-[13px] font-medium leading-5 text-primary"
              >
                {clickMessage}
              </p>
            ) : null}
          </aside>
        </div>

        <div className="border-t border-gray-200 p-4 bg-gray-100">
          <Button
            type="button"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
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
              ? "Không thể xác nhận khi chưa tải được lịch bận"
              : clickAnchor
                ? "Chọn thêm một ô liền kề"
              : hasAssignmentError
                ? "Có buổi chưa có giáo viên"
                : hasAssignmentConflict
                  ? "Có nhân sự đã bận ở buổi đang chọn"
                  : "Xác nhận"}
          </Button>
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
