"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createScheduleDragCell,
  getGridCellsBetween,
  updateReversibleDragPath,
  type ScheduleDragCell,
} from "@/lib/classes/schedule-drag";
import { abbreviateClassName, getClassGroupInfo } from "@/lib/utils/class-groups";
import { DAYS_OF_WEEK, TIME_BLOCKS, type ScheduleSlot } from "@/components/layout/weekly-schedule-board";
import {
  canRevealSlidePanel,
  getSlideBackdropStyle,
  getSlidePanelUnmountDelay,
  getSlidePanelStyle,
  useSlidePanelMotion,
} from "@/lib/ui/slide-panel-motion";

interface OccupiedScheduleSlot extends ScheduleSlot {
  className: string;
}

const MAX_CONCURRENT_CLASSES = 1;
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

const getScheduleBlockKey = (cell: ScheduleDragCell) =>
  `${DAYS_OF_WEEK[cell.dayIndex]}-${TIME_BLOCKS[cell.timeIndex]}`;

interface ScheduleGridSlideProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (schedule: { text: string; slots: ScheduleSlot[] } | null) => void;
  currentValue?: { text: string; slots: ScheduleSlot[] } | null;
  occupiedSlots?: OccupiedScheduleSlot[];
}

export function ScheduleGridSlide({
  isOpen,
  onClose,
  onSave,
  currentValue,
  occupiedSlots = [],
}: ScheduleGridSlideProps) {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [focusedCell, setFocusedCell] = useState({ dayIndex: 0, timeIndex: 0 });
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const dragModeRef = useRef<"painting" | "erasing">("painting");
  const dragBaseBlocksRef = useRef<Set<string>>(new Set());
  const dragPathRef = useRef<ScheduleDragCell[]>([]);
  const dragCursorCellRef = useRef<ScheduleDragCell | null>(null);
  const backdropPointerDownRef = useRef(false);
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

      setFocusedCell({ dayIndex: 0, timeIndex: 0 });
    }
  }, [currentValue, isOpen]);

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
  }, [isOpen]);

  // Check if a cell is selected by checking if it overlaps with any slot
  const isCellSelected = (day: string, timeBlock: string) => {
    return slots.some((slot) => {
      if (slot.day !== day) return false;
      const slotStart = timeToMinutes(slot.start);
      const slotEnd = timeToMinutes(slot.end);
      const blockStart = timeToMinutes(timeBlock);
      return blockStart >= slotStart && blockStart < slotEnd;
    });
  };

  const isCellFullyBooked = useCallback((day: string, timeBlock: string) => {
    const blockStart = timeToMinutes(timeBlock);
    const blockEnd = blockStart + 30;

    return occupiedSlots.filter((slot) => {
      if (slot.day !== day) return false;
      const slotStart = timeToMinutes(slot.start);
      const slotEnd = timeToMinutes(slot.end);
      return slotStart < blockEnd && blockStart < slotEnd;
    }).length >= MAX_CONCURRENT_CLASSES;
  }, [occupiedSlots]);

  const getBlockedClassColor = (className: string) => {
    return getClassGroupInfo(className).color;
  };

  const getOccupiedSlotStyle = (slot: OccupiedScheduleSlot) => {
    const gridStart = timeToMinutes(TIME_BLOCKS[0]);
    const gridEnd = timeToMinutes(TIME_BLOCKS[TIME_BLOCKS.length - 1]) + 30;
    const gridDuration = gridEnd - gridStart;
    const slotStart = Math.max(gridStart, timeToMinutes(slot.start));
    const slotEnd = Math.min(gridEnd, timeToMinutes(slot.end));
    const dayIndex = DAYS_OF_WEEK.indexOf(slot.day);
    const color = getBlockedClassColor(slot.className);
    const overlappingSlots = occupiedSlots.filter((other) => {
      if (other.day !== slot.day) return false;
      const otherStart = timeToMinutes(other.start);
      const otherEnd = timeToMinutes(other.end);
      return otherStart < slotEnd && slotStart < otherEnd;
    });
    const laneCount = Math.min(MAX_CONCURRENT_CLASSES, Math.max(1, overlappingSlots.length));
    const laneIndex = Math.max(
      0,
      overlappingSlots.findIndex(
        (other) =>
          other.className === slot.className &&
          other.day === slot.day &&
          other.start === slot.start &&
          other.end === slot.end,
      ),
    );
    const normalizedLaneIndex = Math.min(laneIndex, laneCount - 1);

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

  const toggleCell = useCallback((day: string, timeBlock: string, mode: "painting" | "erasing") => {
    if (isCellFullyBooked(day, timeBlock)) {
      return;
    }

    setSlots((currentSlots) => {
      const currentBlocks = unpackSlotsToBlocks(currentSlots);
      const cellKey = `${day}-${timeBlock}`;
      const exists = currentBlocks.includes(cellKey);

      if ((mode === "painting" && exists) || (mode === "erasing" && !exists)) {
        return currentSlots;
      }

      const nextBlocks =
        mode === "painting"
          ? [...currentBlocks, cellKey]
          : currentBlocks.filter((block) => block !== cellKey);
      return getMergedSlots(nextBlocks);
    });
  }, [isCellFullyBooked]);

  const applyDragPath = useCallback(
    (path: ScheduleDragCell[], mode: "painting" | "erasing") => {
      const nextBlocks = new Set(dragBaseBlocksRef.current);
      path.forEach((cell) => {
        const blockKey = getScheduleBlockKey(cell);
        if (mode === "painting") {
          nextBlocks.add(blockKey);
        } else {
          nextBlocks.delete(blockKey);
        }
      });
      setSlots(getMergedSlots([...nextBlocks]));
    },
    [],
  );

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
    if (isCellFullyBooked(day, timeBlock)) {
      setIsDragging(false);
      return;
    }

    const baseBlocks = new Set(unpackSlotsToBlocks(slots));
    const anchorCell = createScheduleDragCell(dayIndex, timeIndex);
    const mode = baseBlocks.has(getScheduleBlockKey(anchorCell)) ? "erasing" : "painting";
    activePointerIdRef.current = event.pointerId;
    dragModeRef.current = mode;
    dragBaseBlocksRef.current = baseBlocks;
    dragPathRef.current = [anchorCell];
    dragCursorCellRef.current = anchorCell;
    setIsDragging(true);
    applyDragPath(dragPathRef.current, mode);
  };

  useEffect(() => {
    if (!isDragging) return;

    const endDragging = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId) return;
      dragPathRef.current = [];
      dragCursorCellRef.current = null;
      dragBaseBlocksRef.current.clear();
      activePointerIdRef.current = null;
      setIsDragging(false);
    };

    const continueDragging = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId) return;

      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-schedule-day][data-schedule-time]");
      const dayIndex = Number(target?.dataset.dayIndex);
      const timeIndex = Number(target?.dataset.timeIndex);
      if (!Number.isInteger(dayIndex) || !Number.isInteger(timeIndex)) return;

      const currentCell = dragCursorCellRef.current;
      const targetCell = createScheduleDragCell(dayIndex, timeIndex);
      if (!currentCell || currentCell.key === targetCell.key) return;

      const traversedCells = getGridCellsBetween(currentCell, targetCell).filter(
        (cell) =>
          !isCellFullyBooked(
            DAYS_OF_WEEK[cell.dayIndex],
            TIME_BLOCKS[cell.timeIndex],
          ),
      );
      const nextPath = updateReversibleDragPath(
        dragPathRef.current,
        traversedCells,
      );
      dragCursorCellRef.current = targetCell;
      if (nextPath === dragPathRef.current) return;

      dragPathRef.current = nextPath;
      applyDragPath(nextPath, dragModeRef.current);
    };

    window.addEventListener("pointermove", continueDragging);
    window.addEventListener("pointerup", endDragging);
    window.addEventListener("pointercancel", endDragging);

    return () => {
      window.removeEventListener("pointermove", continueDragging);
      window.removeEventListener("pointerup", endDragging);
      window.removeEventListener("pointercancel", endDragging);
    };
  }, [applyDragPath, isCellFullyBooked, isDragging]);

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
        toggleCell(day, timeBlock, isCellSelected(day, timeBlock) ? "erasing" : "painting");
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
    if (slots.length === 0) {
      onSave(null);
      onClose();
      return;
    }

    const grouped: Record<string, string[]> = {};
    slots.forEach((s) => {
      if (!grouped[s.day]) grouped[s.day] = [];
      grouped[s.day].push(`${s.start}-${s.end}`);
    });

    const textParts = DAYS_OF_WEEK.filter((d) => grouped[d]).map(
      (d) => `${d} (${grouped[d].join(", ")})`
    );

    onSave({
      text: textParts.join("; "),
      slots: slots,
    });
    onClose();
  };

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex justify-end ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!isOpen}
      inert={!isOpen}
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
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h3 id={titleId} className="section-title-text text-gray-900">
            Thiết lập lịch học tuần
          </h3>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Đóng phần thiết lập lịch học"
            className="rounded-md p-1 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
          >
            <X aria-hidden="true" className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="grid flex-1 gap-3 overflow-hidden p-4 select-none lg:grid-cols-[minmax(0,1fr)_200px]">
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200">
            <div className="font-body-ui grid grid-cols-[72px_repeat(7,1fr)] border-b border-gray-200 bg-gray-50 text-center text-[15px] font-medium leading-5 text-gray-700">
              <div className="border-r border-gray-200 py-2">Giờ</div>
              {DAYS_OF_WEEK.map((day) => (
                <div key={day} className="border-r border-gray-200 py-2 last:border-r-0">
                  {day}
                </div>
              ))}
            </div>

            <div className="relative flex flex-1 flex-col">
              {TIME_BLOCKS.map((timeBlock, timeIndex) => (
                <div key={timeBlock} className="grid flex-1 grid-cols-[72px_repeat(7,1fr)] text-center">
                  <div className={`font-body-ui flex items-center justify-center border-r border-gray-200 bg-gray-50 text-[15px] font-medium leading-4 text-gray-700 ${timeIndex > 0 ? "border-t border-gray-200/80" : ""}`}>
                    {timeBlock}
                  </div>
                  {DAYS_OF_WEEK.map((day, dayIndex) => {
                    const selected = isCellSelected(day, timeBlock);
                    const fullyBooked = isCellFullyBooked(day, timeBlock);
                    return (
                      <button
                        type="button"
                        key={day}
                        title={fullyBooked ? "Giáo viên đã có lớp ở khung giờ này" : undefined}
                        aria-label={`${day}, ${timeBlock} đến ${minutesToTime(timeToMinutes(timeBlock) + 30)}${fullyBooked ? ", giáo viên đã có lớp" : selected ? ", đã chọn" : ", chưa chọn"}`}
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
                          // Assistive technologies may dispatch click without a preceding key event.
                          if (event.detail === 0 && !fullyBooked) {
                            toggleCell(day, timeBlock, selected ? "erasing" : "painting");
                          }
                        }}
                        className={`touch-none border-r border-t border-gray-200/80 transition-colors duration-100 ease-out focus-visible:relative focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 ${fullyBooked
                          ? "cursor-not-allowed bg-gray-50"
                          : selected
                            ? "cursor-crosshair bg-gray-200 shadow-[inset_0_0_0_1px_#D1D5DB] hover:bg-gray-300/80"
                            : `cursor-crosshair bg-white hover:bg-gray-50 ${timeIndex === 0 ? "border-t-0" : ""}`
                          }`}
                      />
                    );
                  })}
                </div>
              ))}

              {occupiedSlots.map((slot, index) => {
                if (DAYS_OF_WEEK.indexOf(slot.day) === -1) {
                  return null;
                }

                const { color, style } = getOccupiedSlotStyle(slot);
                return (
                  <div
                    key={`${slot.className}-${slot.day}-${slot.start}-${slot.end}-${index}`}
                    title={`${slot.className} (${slot.start}-${slot.end})`}
                    aria-label={`${slot.className}, ${slot.start} đến ${slot.end}`}
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
              })}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
            <h4 className="section-title-text border-b border-gray-200 px-3 py-3 text-gray-900">
              Danh sách chi tiết
            </h4>

            {slots.length === 0 ? (
              <p className="helper-text px-3 py-3 italic text-gray-400">Chưa chọn khung giờ nào.</p>
            ) : (
              <div className="flex flex-1 flex-col items-start gap-2 overflow-y-auto px-3 py-3">
                {slots.map((slot, index) => (
                  <span
                    key={`${slot.day}-${slot.start}-${slot.end}-${index}`}
                    className="font-body-ui inline-flex w-fit max-w-full items-center whitespace-nowrap rounded-full bg-gray-100 px-2 py-1 text-[15px] font-medium leading-5 text-gray-800"
                  >
                    {slot.day} ({slot.start}-{slot.end})
                  </span>
                ))}
              </div>
            )}
          </aside>
        </div>

        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <Button type="button" className="w-full bg-gray-950 text-white hover:bg-black" onClick={handleSave}>
            Xác nhận
          </Button>
        </div>
      </div>
    </div>
  );
}
