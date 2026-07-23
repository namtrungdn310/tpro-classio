"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
}

export function DatePickerSlide({
  isOpen,
  onClose,
  onSelectDate,
  currentValue,
}: DatePickerSlideProps) {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const transitionDuration = useSlidePanelDuration(panelRef);

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const years = [currentYear - 1, currentYear, currentYear + 1];

  // Initialize values from currentValue if valid YYYY-MM-DD
  useEffect(() => {
    if (isOpen) {
      if (currentValue && /^\d{4}-\d{2}-\d{2}$/.test(currentValue)) {
        const [y, m, d] = currentValue.split("-").map(Number);
        setSelectedYear(y >= currentYear - 1 && y <= currentYear + 1 ? y : null);
        setSelectedMonth(m);
        setSelectedDay(d);
      } else {
        setSelectedYear(null);
        setSelectedMonth(null);
        setSelectedDay(null);
      }
    }
  }, [currentValue, currentYear, isOpen]);

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

  const isFormValid = selectedYear !== null && selectedMonth !== null && selectedDay !== null;
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
      aria-hidden={!isOpen}
      inert={!isOpen}
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
        onClick={onClose}
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
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 id="date-picker-slide-title" className="section-title-text text-gray-900">Chọn ngày bắt đầu</h3>
          <button
            type="button"
            data-date-picker-initial-focus
            aria-label="Đóng bộ chọn ngày"
            onClick={onClose}
            className="rounded-md p-1 hover:bg-gray-100"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
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
                      ? "border-gray-400 bg-gray-200 text-gray-950 shadow-sm"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
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
                <button
                  key={month}
                  type="button"
                  aria-pressed={selectedMonth === month}
                  onClick={() => handleSelectMonth(month)}
                  className={`h-9 w-full rounded-md border px-2 text-sm font-medium transition-all duration-200 ${
                    selectedMonth === month
                      ? "border-gray-400 bg-gray-200 text-gray-950 shadow-sm"
                      : `bg-white border-gray-200 text-gray-700 ${
                          hasSelectedMonth
                            ? "hover:border-gray-300"
                            : "hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950 hover:shadow-sm"
                        } active:translate-y-0 active:scale-[0.98]`
                  }`}
                >
                  Tháng {month}
                </button>
              ))}
            </div>
          </div>

          {/* Day Section */}
          <div className="space-y-2">
            <h4 className="table-heading-text text-gray-400">Chọn ngày</h4>
            <div className="grid w-full grid-cols-7 gap-1.5">
              {days.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selectedDay === day}
                  onClick={() => handleSelectDay(day)}
                  className={`h-8 w-full rounded-md border text-sm font-medium transition-all duration-200 ${
                    selectedDay === day
                      ? "border-gray-400 bg-gray-200 text-gray-950 shadow-sm"
                      : `bg-white border-gray-200 text-gray-700 ${
                          hasSelectedDay
                            ? "hover:border-gray-300"
                            : "hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950 hover:shadow-sm"
                        } active:translate-y-0 active:scale-[0.98]`
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!isFormValid}
            className={`w-full ${
              isFormValid
                ? "bg-gray-950 text-white hover:bg-black"
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
