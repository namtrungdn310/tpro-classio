"use client";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { DAYS_OF_WEEK, TIME_BLOCKS, formatTimeBlock } from "./weekly-schedule-board";

export type ScheduleCellState = "free" | "selected" | "busy" | "overview";

export interface ScheduleCellDescriptor {
  dayIndex: number;
  timeIndex: number;
  day: string;
  timeBlock: string;
  state: ScheduleCellState;
  isClickAnchor: boolean;
  isEndpointCell: boolean;
  isDragAnchor: boolean;
  ariaLabel: string;
  title?: string;
  ariaPressed: boolean;
  ariaDisabled: boolean;
  tabIndex: number;
}

interface ScheduleWeekGridProps {
  gridRef: RefObject<HTMLDivElement>;
  cells: ScheduleCellDescriptor[][];
  /** Absolute overlays: busy blocks (z-20), own sessions (z-30), overview lanes. */
  overlays: ReactNode[];
  dragging: boolean;
  busy?: boolean;
  onCellFocus: (dayIndex: number, timeIndex: number) => void;
  onCellPointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    day: string,
    timeBlock: string,
    dayIndex: number,
    timeIndex: number,
  ) => void;
  onCellKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    dayIndex: number,
    timeIndex: number,
  ) => void;
  onCellClick: (
    event: ReactMouseEvent<HTMLButtonElement>,
    day: string,
    timeBlock: string,
    dayIndex: number,
    timeIndex: number,
  ) => void;
  onGridPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onGridPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onGridPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onGridLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

const CELL_BASE_CLASS =
  "touch-none border-r border-t border-gray-200/80 transition-colors duration-100 ease-out focus-visible:relative focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60";

function getCellClassName(cell: ScheduleCellDescriptor): string {
  if (cell.state === "busy") {
    return `${CELL_BASE_CLASS} cursor-not-allowed bg-gray-50`;
  }
  if (cell.state === "overview") {
    return `${CELL_BASE_CLASS} cursor-default schedule-grid-cell-idle ${cell.timeIndex === 0 ? "border-t-0" : ""}`;
  }
  if (cell.isClickAnchor) {
    return `${CELL_BASE_CLASS} schedule-grid-cell-pending cursor-pointer shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_55%,transparent)] outline outline-1 outline-dashed outline-offset-[-3px] outline-primary/60`;
  }
  if (cell.isEndpointCell) {
    return `${CELL_BASE_CLASS} schedule-grid-cell-endpoint cursor-crosshair`;
  }
  if (cell.isDragAnchor) {
    return `${CELL_BASE_CLASS} schedule-grid-cell-anchor cursor-crosshair shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_50%,transparent)]`;
  }
  if (cell.state === "selected") {
    return `${CELL_BASE_CLASS} schedule-grid-cell-selected cursor-crosshair shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_30%,transparent)]`;
  }
  return `${CELL_BASE_CLASS} schedule-grid-cell-idle cursor-pointer ${cell.timeIndex === 0 ? "border-t-0" : ""}`;
}

export function ScheduleWeekGrid({
  gridRef,
  cells,
  overlays,
  dragging,
  busy,
  onCellFocus,
  onCellPointerDown,
  onCellKeyDown,
  onCellClick,
  onGridPointerMove,
  onGridPointerUp,
  onGridPointerCancel,
  onGridLostPointerCapture,
}: ScheduleWeekGridProps) {
  return (
    <div
      ref={gridRef}
      className="relative flex flex-1 flex-col"
      data-schedule-grid="true"
      data-schedule-dragging={dragging ? true : undefined}
      aria-busy={busy || undefined}
      onPointerMove={onGridPointerMove}
      onPointerUp={onGridPointerUp}
      onPointerCancel={onGridPointerCancel}
      onLostPointerCapture={onGridLostPointerCapture}
    >
      {TIME_BLOCKS.map((timeBlock, timeIndex) => (
        <div
          key={timeBlock}
          className="relative grid min-h-0 flex-1 grid-cols-[64px_repeat(7,1fr)] text-center"
        >
          <div
            className={`font-body-ui flex min-h-0 items-center justify-center border-r border-gray-200 bg-primary-soft/40 text-[11px] font-medium leading-none text-gray-700 ${timeIndex > 0 ? "border-t border-gray-200/80" : ""}`}
          >
            {formatTimeBlock(timeBlock)}
          </div>
          {DAYS_OF_WEEK.map((day, dayIndex) => {
            const cell = cells[timeIndex]?.[dayIndex];
            if (!cell) return null;
            return (
              <button
                type="button"
                key={day}
                title={cell.title}
                aria-label={cell.ariaLabel}
                aria-pressed={cell.ariaPressed}
                aria-disabled={cell.ariaDisabled}
                tabIndex={cell.tabIndex}
                data-schedule-day={cell.day}
                data-schedule-time={cell.timeBlock}
                data-day-index={cell.dayIndex}
                data-time-index={cell.timeIndex}
                data-schedule-state={cell.state}
                data-click-anchor={cell.isClickAnchor ? "true" : undefined}
                data-schedule-endpoint={cell.isEndpointCell ? "true" : undefined}
                onFocus={() => onCellFocus(cell.dayIndex, cell.timeIndex)}
                onPointerDown={(event) =>
                  onCellPointerDown(
                    event,
                    cell.day,
                    cell.timeBlock,
                    cell.dayIndex,
                    cell.timeIndex,
                  )
                }
                onKeyDown={(event) => onCellKeyDown(event, cell.dayIndex, cell.timeIndex)}
                onClick={(event) =>
                  onCellClick(
                    event,
                    cell.day,
                    cell.timeBlock,
                    cell.dayIndex,
                    cell.timeIndex,
                  )
                }
                className={getCellClassName(cell)}
              />
            );
          })}
        </div>
      ))}
      {overlays}
    </div>
  );
}
