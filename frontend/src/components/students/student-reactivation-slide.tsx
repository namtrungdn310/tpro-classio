"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { RiCheckLine as Check, RiHistoryLine as History, RiUserFollowLine as UserRoundCheck, RiCloseLine as X } from "react-icons/ri";
import { LoadingLabel } from "@/components/ui/loading-label";
import {
  canRevealSlidePanel,
  getSlideBackdropStyle,
  getSlidePanelStyle,
  getSlidePanelUnmountDelay,
  useSlidePanelMotion,
} from "@/lib/ui/slide-panel-motion";
import type {
  StudentIdentityCandidate,
  StudentIdentityConflict,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";

type StudentReactivationSlideProps = {
  className: string;
  conflict: StudentIdentityConflict | null;
  isPending: boolean;
  onClose: () => void;
  onCreateNew: (candidateIds: string[]) => void;
  onReactivate: (candidate: StudentIdentityCandidate) => void;
};

export function StudentReactivationSlide({
  className,
  conflict,
  isPending,
  onClose,
  onCreateNew,
  onReactivate,
}: StudentReactivationSlideProps) {
  const isOpen = conflict !== null;
  const [renderedConflict, setRenderedConflict] =
    useState<StudentIdentityConflict | null>(conflict);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateNewConfirmation, setIsCreateNewConfirmation] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const backdropPointerDownRef = useRef(false);
  const titleId = useId();
  const { durationMs, isReady } = useSlidePanelMotion(panelRef, shouldRender);

  useEffect(() => {
    if (!conflict) return;

    setRenderedConflict(conflict);
    setIsCreateNewConfirmation(false);
    setSelectedId((current) => {
      if (conflict.candidates.some((candidate) => candidate.id === current)) {
        return current;
      }
      const strongCandidates = conflict.candidates.filter(
        (candidate) => candidate.match_strength === "strong",
      );
      return strongCandidates.length === 1 ? strongCandidates[0].id : null;
    });
  }, [conflict]);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      return;
    }

    setIsVisible(false);
    if (!shouldRender) return;
    const delay = getSlidePanelUnmountDelay(
      durationMs,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const unmountTimer = setTimeout(() => {
      setShouldRender(false);
      setRenderedConflict(null);
    }, delay);

    return () => clearTimeout(unmountTimer);
  }, [durationMs, isOpen, shouldRender]);

  useEffect(() => {
    if (
      !canRevealSlidePanel({
        isOpen,
        isReady,
        isRendered: shouldRender,
      })
    ) {
      return;
    }

    let revealFrame = 0;
    const mountFrame = window.requestAnimationFrame(() => {
      revealFrame = window.requestAnimationFrame(() => setIsVisible(true));
    });
    return () => {
      window.cancelAnimationFrame(mountFrame);
      window.cancelAnimationFrame(revealFrame);
    };
  }, [isOpen, isReady, shouldRender]);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
      previousFocusRef.current = null;
    };
  }, [isOpen, isPending, onClose]);

  if (!shouldRender || !renderedConflict || typeof document === "undefined") {
    return null;
  }

  const selectedCandidate =
    renderedConflict.candidates.find((candidate) => candidate.id === selectedId) ??
    null;
  const candidateIds = renderedConflict.candidates.map((candidate) => candidate.id);

  return createPortal(
    <div
      aria-hidden={!isOpen}
      className={cn(
        "fixed inset-0 z-[70] flex justify-end",
        isOpen ? "pointer-events-auto" : "pointer-events-none",
      )}
      inert={!isOpen}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-black/35 transition-opacity motion-reduce:transition-none",
          isVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        style={getSlideBackdropStyle(durationMs)}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          backdropPointerDownRef.current = event.target === event.currentTarget;
        }}
        onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (
            !isPending &&
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
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "relative z-10 flex h-full w-full max-w-[500px] flex-col bg-white shadow-2xl transition-transform motion-reduce:transition-none",
          isVisible ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        style={getSlidePanelStyle(durationMs)}
        tabIndex={-1}
      >
        <header className="flex items-start justify-between gap-4 border-b border-primary/15 bg-primary-soft/60 px-5 py-3.5">
          <div>
            <h2 id={titleId} className="section-title-text text-primary">
              Kiểm tra hồ sơ học viên
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-600">
              Hệ thống tìm thấy hồ sơ có thông tin tương tự.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            aria-label="Đóng phần kiểm tra hồ sơ"
            className="rounded-md p-1 text-gray-500 transition hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            disabled={isPending}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isCreateNewConfirmation ? (
            <CreateNewConfirmation
              candidateCount={renderedConflict.candidates.length}
              onBack={() => setIsCreateNewConfirmation(false)}
            />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
                <History aria-hidden="true" className="h-4 w-4 text-gray-500" />
                Chọn đúng hồ sơ để tiếp tục
              </div>
              <div className="space-y-2.5">
                {renderedConflict.candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    isSelected={selectedId === candidate.id}
                    onSelect={() => setSelectedId(candidate.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <footer className="border-t border-gray-200 bg-white px-5 py-4">
          {isCreateNewConfirmation ? (
            <div className="flex justify-end gap-2">
              <button
                className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800 transition hover:bg-gray-50"
                disabled={isPending}
                onClick={() => setIsCreateNewConfirmation(false)}
                type="button"
              >
                Quay lại
              </button>
              <button
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending}
                onClick={() => onCreateNew(candidateIds)}
                type="button"
              >
                {isPending ? <LoadingLabel label="Đang tạo" /> : "Tạo hồ sơ mới"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                className="w-full text-left text-sm font-medium text-gray-600 underline decoration-gray-300 underline-offset-4 transition hover:text-primary"
                disabled={isPending}
                onClick={() => setIsCreateNewConfirmation(true)}
                type="button"
              >
                Đây là một học viên khác
              </button>
              <div className="flex justify-end gap-2">
                <button
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800 transition hover:bg-gray-50"
                  disabled={isPending}
                  onClick={onClose}
                  type="button"
                >
                  Quay lại chỉnh sửa
                </button>
                <button
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    isPending ||
                    !selectedCandidate ||
                    selectedCandidate.already_in_target_class
                  }
                  onClick={() => {
                    if (selectedCandidate) onReactivate(selectedCandidate);
                  }}
                  type="button"
                >
                  {isPending ? (
                    <LoadingLabel label="Đang xử lý" />
                  ) : selectedCandidate?.status === "inactive" ? (
                    `Khôi phục vào ${className}`
                  ) : (
                    `Thêm vào ${className}`
                  )}
                </button>
              </div>
            </div>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function CandidateCard({
  candidate,
  isSelected,
  onSelect,
}: {
  candidate: StudentIdentityCandidate;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
        isSelected
          ? "border-primary bg-primary-soft"
          : "border-gray-200 bg-white hover:border-primary/40 hover:bg-primary-soft/60",
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-950">{candidate.full_name}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                candidate.status === "inactive"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-emerald-50 text-emerald-700",
              )}
            >
              {candidate.status === "inactive" ? "Đã nghỉ" : "Đang học"}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {candidate.birth_date ? formatDate(candidate.birth_date) : "Chưa có ngày sinh"}
            {candidate.school ? ` · ${candidate.school}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            isSelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-gray-300 text-transparent",
          )}
        >
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-600">
        <span>PH: {candidate.masked_parent_phone ?? "Chưa có"}</span>
        <span>HV: {candidate.masked_student_phone ?? "Chưa có"}</span>
      </div>
      <div className="mt-2 text-sm text-gray-600">
        <span>Lớp trước:</span>
        {candidate.previous_classes.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {candidate.previous_classes.map((previousClass) => (
              <li key={`${previousClass.name}-${previousClass.enrollment_date ?? ""}`}>
                {previousClass.name}
                {" · "}
                {previousClass.enrollment_date
                  ? `Bắt đầu ${formatDate(previousClass.enrollment_date)}`
                  : "Chưa có ngày bắt đầu"}
              </li>
            ))}
          </ul>
        ) : (
          <span> Chưa có</span>
        )}
      </div>
      {candidate.already_in_target_class ? (
        <p className="mt-2 text-sm font-medium text-amber-700">
          Hồ sơ này đã có trong lớp đang chọn.
        </p>
      ) : null}
    </button>
  );
}

function CreateNewConfirmation({
  candidateCount,
  onBack,
}: {
  candidateCount: number;
  onBack: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <UserRoundCheck aria-hidden="true" className="h-5 w-5 text-amber-700" />
      <h3 className="mt-3 text-base font-semibold text-gray-950">
        Xác nhận tạo hồ sơ mới
      </h3>
      <p className="mt-1 text-sm leading-6 text-gray-700">
        Bạn đã kiểm tra {candidateCount} hồ sơ tương tự và xác nhận đây là một
        học viên khác. Hệ thống sẽ tạo hồ sơ độc lập với thông tin đang nhập.
      </p>
      <button
        className="mt-3 text-sm font-medium text-gray-700 underline underline-offset-4 hover:text-primary"
        onClick={onBack}
        type="button"
      >
        Xem lại hồ sơ tương tự
      </button>
    </div>
  );
}
