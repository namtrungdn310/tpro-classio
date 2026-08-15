"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RiCloseLine as X, RiSearchLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import {
  getSlideBackdropStyle,
  getSlidePanelStyle,
  useSlidePanelDuration,
} from "@/lib/ui/slide-panel-motion";
import type { TeacherOptionResponse } from "@/lib/types";

interface TeacherSlideProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (teacherIds: string[], assistantIds: string[]) => void;
  options: TeacherOptionResponse[];
  currentTeacherIds: string[];
  currentAssistantIds: string[];
}

const MAX_SELECTED = 10;

export function TeacherSlide({
  isOpen,
  onClose,
  onSave,
  options,
  currentTeacherIds,
  currentAssistantIds,
}: TeacherSlideProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [selectedAssistantIds, setSelectedAssistantIds] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropPointerDownRef = useRef(false);
  const transitionDuration = useSlidePanelDuration(panelRef);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setSelectedTeacherIds(currentTeacherIds);
      setSelectedAssistantIds(currentAssistantIds);
    }
  }, [currentAssistantIds, currentTeacherIds, isOpen]);

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase("vi");
  const { teachers, assistants } = useMemo(() => {
    const all = normalizedQuery
      ? options.filter((option) =>
          option.full_name.toLocaleLowerCase("vi").includes(normalizedQuery),
        )
      : options;
    return {
      teachers: all.filter((option) => option.staff_type === "TEACHER"),
      assistants: all.filter((option) => option.staff_type === "ASSISTANT"),
    };
  }, [normalizedQuery, options]);

  const toggleTeacher = (id: string) => {
    setSelectedTeacherIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : current.length >= MAX_SELECTED
          ? current
          : [...current, id],
    );
  };

  const toggleAssistant = (id: string) => {
    setSelectedAssistantIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : current.length >= MAX_SELECTED
          ? current
          : [...current, id],
    );
  };

  const handleConfirm = () => {
    if (selectedTeacherIds.length === 0) return;
    onSave(selectedTeacherIds, selectedAssistantIds);
    onClose();
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
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
    if (!firstElement || !lastElement) return;
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const renderOptionGrid = (
    items: TeacherOptionResponse[],
    selectedIds: string[],
    onToggle: (id: string) => void,
  ) =>
    items.length === 0 ? (
      <p className="helper-text px-1 py-2 italic text-gray-400">
        {normalizedQuery ? "Không tìm thấy." : "Không có."}
      </p>
    ) : (
      <div className="grid grid-cols-1 gap-1.5">
        {items.map((option) => {
          const selected = selectedIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(option.id)}
              className={`flex h-9 items-center justify-between rounded-md border px-3 text-sm font-medium transition-all duration-150 ${
                selected
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-gray-200 bg-white text-gray-700 hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
              }`}
            >
              <span className="truncate">{option.full_name}</span>
              {selected ? (
                <span aria-hidden="true" className="text-primary-foreground">✓</span>
              ) : null}
            </button>
          );
        })}
      </div>
    );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-slide-title"
      aria-hidden={!isOpen}
      inert={isOpen ? undefined : true}
      onKeyDown={handleDialogKeyDown}
      className={`fixed inset-0 z-[60] flex justify-end ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
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

      <div
        ref={panelRef}
        style={getSlidePanelStyle(transitionDuration)}
        className={`relative z-10 flex h-full w-full max-w-[380px] flex-col bg-white shadow-2xl transition-transform motion-reduce:transition-none ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="border-b border-primary/15 bg-primary-soft/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id="teacher-slide-title" className="section-title-text text-primary">
              Chọn giáo viên và trợ giảng
            </h3>
            <button
              type="button"
              data-teacher-slide-initial-focus
              aria-label="Đóng bộ chọn giáo viên"
              onClick={onClose}
              className="rounded-md p-1 text-gray-500 transition hover:bg-primary-soft hover:text-primary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="relative mt-3">
            <RiSearchLine
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Tìm theo tên..."
              autoComplete="off"
              className="form-input-text h-8 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          <div className="space-y-2">
            <h4 className="table-heading-text text-gray-400">
              Giáo viên <span className="text-gray-500">(bắt buộc)</span>
            </h4>
            {renderOptionGrid(teachers, selectedTeacherIds, toggleTeacher)}
            {selectedTeacherIds.length >= MAX_SELECTED ? (
              <p className="helper-text text-gray-400">
                Đã chọn tối đa {MAX_SELECTED} giáo viên.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <h4 className="table-heading-text text-gray-400">
              Trợ giảng <span className="text-gray-500">(không bắt buộc)</span>
            </h4>
            {renderOptionGrid(assistants, selectedAssistantIds, toggleAssistant)}
            {selectedAssistantIds.length >= MAX_SELECTED ? (
              <p className="helper-text text-gray-400">
                Đã chọn tối đa {MAX_SELECTED} trợ giảng.
              </p>
            ) : null}
          </div>
        </div>

        <div className="border-t border-gray-200 bg-gray-100 p-4">
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={selectedTeacherIds.length === 0}
            className={`w-full ${
              selectedTeacherIds.length > 0
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
