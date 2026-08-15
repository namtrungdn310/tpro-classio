"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { RiCloseLine as X } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { FormNotice } from "@/components/ui/form-notice";
import {
  getSlideBackdropStyle,
  getSlidePanelStyle,
  useSlidePanelDuration,
} from "@/lib/ui/slide-panel-motion";

interface DatePickerSlideProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDate: (dateStr: string) => void;
  currentValue?: string;
  initialViewDate?: string;
  title?: string;
  description?: string;
  minDate?: string;
  maxDate?: string;
  dateStepAnchor?: string;
  dateStepDays?: number;
  yearOptions?: number[];
}

export function DatePickerSlide({
  isOpen,
  onClose,
  onSelectDate,
  currentValue,
  initialViewDate,
  title = "Chọn ngày bắt đầu",
  description,
  minDate,
  maxDate,
  dateStepAnchor,
  dateStepDays,
  yearOptions,
}: DatePickerSlideProps) {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropPointerDownRef = useRef(false);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const transitionDuration = useSlidePanelDuration(panelRef);

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentValueYear = parseIsoDatePart(currentValue, 0);
  const minimumYear = Math.min(
    parseIsoDatePart(minDate, 0) ?? currentYear - 1,
    currentValueYear ?? currentYear,
  );
  const maximumYear = Math.max(
    parseIsoDatePart(maxDate, 0) ?? currentYear + 5,
    currentValueYear ?? currentYear,
  );
  const yearOptionsKey = yearOptions?.join(",") ?? "";
  const years = useMemo(
    () =>
      yearOptionsKey
        ? [...new Set(yearOptionsKey.split(",").map(Number))]
            .filter(Number.isInteger)
            .sort((left, right) => left - right)
        : Array.from(
            { length: Math.max(1, maximumYear - minimumYear + 1) },
            (_, index) => minimumYear + index,
          ),
    [maximumYear, minimumYear, yearOptionsKey],
  );

  // Keep an existing date intact. For a blank field, callers may preselect only
  // the calendar year/month while leaving the day (and therefore the field) empty.
  useEffect(() => {
    if (isOpen) {
      if (currentValue && /^\d{4}-\d{2}-\d{2}$/.test(currentValue)) {
        const [y, m, d] = currentValue.split("-").map(Number);
        setSelectedYear(years.includes(y) ? y : null);
        setSelectedMonth(m);
        setSelectedDay(d);
      } else if (initialViewDate && /^\d{4}-\d{2}-\d{2}$/.test(initialViewDate)) {
        const [y, m] = initialViewDate.split("-").map(Number);
        setSelectedYear(years.includes(y) ? y : null);
        setSelectedMonth(m >= 1 && m <= 12 ? m : null);
        setSelectedDay(null);
      } else {
        setSelectedYear(null);
        setSelectedMonth(null);
        setSelectedDay(null);
      }
    }
  }, [currentValue, initialViewDate, isOpen, maximumYear, minimumYear, years]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-date-picker-initial-focus]")?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      previouslyFocusedElement.current?.focus();
    };
  }, [isOpen]);

  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  // Determine days in month
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month, 0).getDate();
  };
  const activeYear = selectedYear ?? currentYear;
  const activeMonth = selectedMonth ?? currentMonth;
  const totalDays = getDaysInMonth(activeYear, activeMonth);
  const days = Array.from({ length: totalDays }, (_, i) => i + 1);

  const handleSelectYear = (year: number) => {
    if (!years.includes(year)) {
      return;
    }
    setSelectedYear(year);
    if (selectedMonth !== null && selectedDay !== null) {
      const maxDays = getDaysInMonth(year, selectedMonth);
      if (selectedDay > maxDays) {
        setSelectedDay(null);
      }
    }
  };

  const handleSelectMonth = (month: number) => {
    if (!monthHasSelectableDate(selectedYear ?? currentYear, month, minDate, maxDate, dateStepAnchor, dateStepDays)) {
      return;
    }
    setSelectedMonth(month);
    if (selectedDay !== null) {
      const year = selectedYear ?? currentYear;
      const maxDays = getDaysInMonth(year, month);
      if (selectedDay > maxDays) {
        setSelectedDay(null);
      }
    }
  };

  const handleSelectDay = (day: number) => {
    if (!isSelectableDate(activeYear, activeMonth, day, minDate, maxDate, dateStepAnchor, dateStepDays)) {
      return;
    }
    setSelectedDay(day);
  };

  const handleConfirm = () => {
    if (selectedYear !== null && selectedMonth !== null && selectedDay !== null) {
      const paddedMonth = String(selectedMonth).padStart(2, "0");
      const paddedDay = String(selectedDay).padStart(2, "0");
      onSelectDate(`${selectedYear}-${paddedMonth}-${paddedDay}`);
      onClose();
    }
  };

  const isFormValid = selectedYear !== null && selectedMonth !== null && selectedDay !== null
    && isSelectableDate(selectedYear, selectedMonth, selectedDay, minDate, maxDate, dateStepAnchor, dateStepDays);
  const hasSelectedMonth = selectedMonth !== null;
  const hasSelectedDay = selectedDay !== null;

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab" || !panelRef.current) {
      return;
    }

    event.stopPropagation();
    const focusableElements = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) => element.offsetParent !== null && !element.closest("[inert]"),
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);
    if (!firstElement || !lastElement) {
      return;
    }

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="date-picker-slide-title"
      aria-describedby={description ? "date-picker-slide-note" : undefined}
      aria-hidden={!isOpen}
      inert={isOpen ? undefined : true}
      onKeyDown={handleDialogKeyDown}
      className={`fixed inset-0 z-[60] flex justify-end ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      {/* Backdrop */}
      <div
        style={getSlideBackdropStyle(transitionDuration)}
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity motion-reduce:transition-none ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onPointerDown={(event) => {
          backdropPointerDownRef.current = event.target === event.currentTarget;
        }}
        onPointerUp={(event) => {
          if (
            backdropPointerDownRef.current &&
            event.target === event.currentTarget
          ) {
            onClose();
          }
          backdropPointerDownRef.current = false;
        }}
        onPointerCancel={() => {
          backdropPointerDownRef.current = false;
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        style={getSlidePanelStyle(transitionDuration)}
        className={`relative z-10 flex h-full w-full max-w-[340px] flex-col bg-white shadow-2xl transition-transform motion-reduce:transition-none ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="border-b border-primary/15 bg-primary-soft/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id="date-picker-slide-title" className="section-title-text text-primary">{title}</h3>
            <button
              type="button"
              data-date-picker-initial-focus
              aria-label="Đóng bộ chọn ngày"
              onClick={onClose}
              className="rounded-md p-1 text-gray-500 transition hover:bg-primary-soft hover:text-primary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {description ? (
            <FormNotice
              id="date-picker-slide-note"
              className="mt-1"
            >
              {description}
            </FormNotice>
          ) : null}
          {/* Year Section */}
          <div className="space-y-2">
            <h4 className="table-heading-text text-gray-400">Chọn năm</h4>
            <div className="grid w-full grid-cols-3 gap-1.5">
              {years.map((year) => (
                <button
                  key={year}
                  type="button"
                  aria-pressed={selectedYear === year}
                  onClick={() => handleSelectYear(year)}
                  className={`h-9 rounded-md border text-sm font-medium transition-all duration-150 ${
                    selectedYear === year
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-gray-200 bg-white text-gray-700 hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>

          {/* Month Section */}
          <div className="space-y-2">
            <h4 className="table-heading-text text-gray-400">Chọn tháng</h4>
            <div className="grid w-full grid-cols-3 gap-1.5">
              {months.map((month) => (
                (() => {
                  const disabled = !monthHasSelectableDate(selectedYear ?? currentYear, month, minDate, maxDate, dateStepAnchor, dateStepDays);
                  return (
                <button
                  key={month}
                  type="button"
                  aria-pressed={selectedMonth === month}
                  disabled={disabled}
                  onClick={() => handleSelectMonth(month)}
                  className={`h-9 w-full rounded-md border px-2 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300 ${
                    selectedMonth === month
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : `bg-white border-gray-200 text-gray-700 ${
                          hasSelectedMonth
                            ? "hover:border-primary/40"
                            : "hover:border-primary/40 hover:bg-primary-soft hover:text-primary hover:shadow-sm"
                        } active:translate-y-0 active:scale-[0.98]`
                  }`}
                >
                  Tháng {month}
                </button>
                  );
                })()
              ))}
            </div>
          </div>

          {/* Day Section */}
          <div className="space-y-2">
            <h4 className="table-heading-text text-gray-400">Chọn ngày</h4>
            <div className="grid w-full grid-cols-7 gap-1.5">
              {days.map((day) => (
                (() => {
                  const disabled = !isSelectableDate(activeYear, activeMonth, day, minDate, maxDate, dateStepAnchor, dateStepDays);
                  return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selectedDay === day}
                  disabled={disabled}
                  onClick={() => handleSelectDay(day)}
                  className={`h-8 w-full rounded-md border text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300 ${
                    selectedDay === day
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : `bg-white border-gray-200 text-gray-700 ${
                          hasSelectedDay
                            ? "hover:border-primary/40"
                            : "hover:border-primary/40 hover:bg-primary-soft hover:text-primary hover:shadow-sm"
                        } active:translate-y-0 active:scale-[0.98]`
                  }`}
                >
                  {day}
                </button>
                  );
                })()
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-100">
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!isFormValid}
            className={`w-full ${
              isFormValid
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            Xác nhận
          </Button>
        </div>
      </div>
    </div>
  );
}

function parseIsoDatePart(value: string | undefined, index: number): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const part = Number(value.split("-")[index]);
  return Number.isFinite(part) ? part : null;
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isSelectableDate(
  year: number,
  month: number,
  day: number,
  minDate?: string,
  maxDate?: string,
  dateStepAnchor?: string,
  dateStepDays?: number,
): boolean {
  const value = toIsoDate(year, month, day);
  if ((minDate && value < minDate) || (maxDate && value > maxDate)) {
    return false;
  }
  if (dateStepAnchor && dateStepDays && dateStepDays > 0) {
    const difference = differenceInIsoDays(dateStepAnchor, value);
    return difference > 0 && difference % dateStepDays === 0;
  }
  return true;
}

function monthHasSelectableDate(
  year: number,
  month: number,
  minDate?: string,
  maxDate?: string,
  dateStepAnchor?: string,
  dateStepDays?: number,
): boolean {
  const totalDays = new Date(year, month, 0).getDate();
  return Array.from({ length: totalDays }, (_, index) => index + 1).some((day) =>
    isSelectableDate(
      year,
      month,
      day,
      minDate,
      maxDate,
      dateStepAnchor,
      dateStepDays,
    ),
  );
}

function differenceInIsoDays(start: string, end: string): number {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round(
    (Date.UTC(endYear, endMonth - 1, endDay) -
      Date.UTC(startYear, startMonth - 1, startDay)) /
      86_400_000,
  );
}
