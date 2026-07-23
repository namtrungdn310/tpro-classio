"use client";

import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";
import { formTextControlHeaderClassName } from "@/components/ui/form-text-control";

interface HeaderFilterOption {
  label: string;
  value: string;
}

interface HeaderFilterGroup {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: HeaderFilterOption[];
  hidden?: boolean;
  defaultValue?: string;
  allowDeselect?: boolean;
}

interface HeaderFilterControlsProps {
  filters: HeaderFilterGroup[];
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onClear?: () => void;
}

export function HeaderFilterControls({
  filters,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  onClear,
}: HeaderFilterControlsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverWidth, setPopoverWidth] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const visibleFilters = filters.filter((filter) => !filter.hidden);
  const visibleFilterLayoutKey = visibleFilters
    .map(
      (filter) =>
        `${filter.label}:${filter.value}:${filter.options
          .map((option) => `${option.value}:${option.label}`)
          .join(",")}`,
    )
    .join("|");
  const activeFilters = visibleFilters.filter((filter) => {
    if (filter.defaultValue !== undefined) {
      return filter.value !== filter.defaultValue;
    }
    return filter.value !== "";
  });
  const clearFilters = () => {
    if (onClear) {
      onClear();
    } else {
      visibleFilters.forEach((filter) => {
        if (filter.value) {
          filter.onChange("");
        }
      });
    }
    setIsOpen(false);
  };

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverWidth(null);
      return;
    }

    rowRefs.current = rowRefs.current.slice(0, visibleFilters.length);

    function measureWidth() {
      const widestRow = rowRefs.current.reduce((maxWidth, row) => {
        if (!row) {
          return maxWidth;
        }

        return Math.max(maxWidth, row.scrollWidth);
      }, 0);

      const viewportWidth = window.innerWidth;
      const nextWidth = Math.min(
        viewportWidth - 32,
        Math.max(280, Math.ceil(widestRow + 20)),
      );

      setPopoverWidth((currentWidth) =>
        currentWidth === nextWidth ? currentWidth : nextWidth,
      );
    }

    measureWidth();
    window.addEventListener("resize", measureWidth);

    return () => {
      window.removeEventListener("resize", measureWidth);
    };
  }, [isOpen, visibleFilterLayoutKey, visibleFilters.length]);

  return (
    <div className="relative flex min-w-0 flex-1 items-center md:flex-none" ref={rootRef}>
      <div className="relative w-full min-w-0 md:w-auto">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          autoComplete={savedInfoAutocomplete.disabled}
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className={formTextControlHeaderClassName}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
          {visibleFilters.length > 0 ? (
            <button
              type="button"
              aria-label="Bộ lọc"
              onClick={() => setIsOpen((current) => !current)}
              className={`relative inline-flex h-6 w-8 items-center justify-center rounded-[5px] transition ${
                activeFilters.length > 0 || isOpen
                  ? "bg-gray-100 text-gray-950"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {activeFilters.length > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gray-900 px-1 text-[10px] font-semibold text-white">
                  {activeFilters.length}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      </div>

      {isOpen && visibleFilters.length > 0 ? (
        <div
          className="absolute left-0 top-10 z-50 min-w-[280px] max-w-[calc(100vw-32px)] rounded-lg border border-gray-200 bg-white p-2.5 shadow-lg"
          style={popoverWidth ? { width: `${popoverWidth}px` } : undefined}
        >
          <div className="space-y-2.5">
            {visibleFilters.map((filter, index) => (
              <div key={filter.label} className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase text-gray-500">{filter.label}</p>
                <div
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  className="flex flex-nowrap gap-1.5 overflow-hidden"
                >
                  {filter.options.map((option) => {
                    const selected = filter.value === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          if (selected && filter.allowDeselect === false) {
                            return;
                          }
                          filter.onChange(selected ? "" : option.value);
                        }}
                        className={`inline-flex h-8 shrink-0 items-center rounded-full px-2.5 text-[12px] transition ${
                          selected
                            ? "bg-gray-100 font-medium text-gray-950"
                            : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {activeFilters.length > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-2 inline-flex text-[12px] text-gray-600 underline underline-offset-2 hover:text-gray-950"
            >
              Xoá lọc
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
