"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { LoadingLabel } from "@/components/ui/loading-label";
import { ManualDateInput } from "@/components/ui/manual-date-input";
import {
  analyzeBillingScheduleOptions,
  getBillingSchedule,
  type BillingScheduleDraft,
  type BillingScheduleOptionsResponse,
} from "@/lib/api/billing-dates";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDate } from "@/lib/utils/format";

export type BillingDateSelection = {
  draft?: BillingScheduleDraft;
  options?: BillingScheduleOptionsResponse;
};

export function formatCyclePeriod(
  period: string | null | undefined,
  anchorDate?: string | null,
) {
  if (!period) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(period)) {
    return period;
  }
  const fullMatch = period.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:T|$)/);
  if (fullMatch) {
    return `${fullMatch[3]}/${fullMatch[2]}/${fullMatch[1]}`;
  }
  const monthMatch = period.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (monthMatch) {
    let day = "01";
    if (anchorDate && /^\d{4}-\d{2}-(\d{2})/.test(anchorDate)) {
      day = anchorDate.slice(8, 10);
    } else if (anchorDate && /^(\d{2})\/\d{2}\/\d{4}/.test(anchorDate)) {
      day = anchorDate.slice(0, 2);
    }
    return `${day}/${monthMatch[2]}/${monthMatch[1]}`;
  }
  return formatDate(period);
}

export function BillingDateField({
  enrollmentId,
  initialAnchor,
  initialVersion = 0,
  onReview,
  onPendingChange,
  currentPeriod,
  nextPeriod,
  currentFeeStatus,
}: {
  enrollmentId: string;
  initialAnchor?: string | null;
  initialVersion?: number;
  onReview: (selection?: BillingDateSelection) => void;
  onPendingChange?: (id: string, pending: boolean) => void;
  currentPeriod?: string | null;
  nextPeriod?: string | null;
  currentFeeStatus?: "PAID" | "UNPAID" | null;
}) {
  const query = useQuery({
    queryKey: ["billing-schedule", enrollmentId],
    queryFn: ({ signal }) => getBillingSchedule(enrollmentId, signal),
    staleTime: 30_000,
  });

  const anchor = query.data ? query.data.anchor_date : initialAnchor ?? null;
  const version = query.data?.version ?? initialVersion;
  const effectiveCurrentPeriod = currentPeriod ?? query.data?.current_period;
  const effectiveNextPeriod = nextPeriod ?? query.data?.next_period;
  const effectiveFeeStatus =
    currentFeeStatus ?? (query.data?.current_fee_status as "PAID" | "UNPAID" | null);

  return (
    <BillingDateEditor
      key={enrollmentId}
      enrollmentId={enrollmentId}
      anchor={anchor}
      version={version}
      onReview={onReview}
      onPendingChange={onPendingChange}
      currentPeriod={effectiveCurrentPeriod}
      nextPeriod={effectiveNextPeriod}
      currentFeeStatus={effectiveFeeStatus}
    />
  );
}

function BillingDateEditor({
  enrollmentId,
  anchor,
  version,
  onReview,
  onPendingChange,
  currentPeriod,
  nextPeriod,
  currentFeeStatus,
}: {
  enrollmentId: string;
  anchor: string | null;
  version: number;
  onReview: (selection?: BillingDateSelection) => void;
  onPendingChange?: (id: string, pending: boolean) => void;
  currentPeriod?: string | null;
  nextPeriod?: string | null;
  currentFeeStatus?: "PAID" | "UNPAID" | null;
}) {
  const [value, setValue] = useState<string | null>(anchor);
  const [userModified, setUserModified] = useState(false);
  const [options, setOptions] = useState<BillingScheduleOptionsResponse | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [retry, setRetry] = useState(0);
  const [prevAnchor, setPrevAnchor] = useState(anchor);
  const [prevVersion, setPrevVersion] = useState(version);

  if (prevAnchor !== anchor || prevVersion !== version) {
    setPrevAnchor(anchor);
    setPrevVersion(version);
    if (!userModified) {
      setValue(anchor);
    } else if (prevVersion !== version) {
      setOptions(null);
      setError("Lịch thu vừa được cập nhật trên máy chủ. Vui lòng kiểm tra lại.");
    }
  }

  const changed = value !== anchor;
  const valid = Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const optionsReady = options?.new_anchor_date === value && options.expected_version === version;

  useEffect(() => {
    onPendingChange?.(enrollmentId, changed);
  }, [enrollmentId, changed, valid, onPendingChange]);

  useEffect(() => () => onPendingChange?.(enrollmentId, false), [enrollmentId, onPendingChange]);

  useEffect(() => {
    if (!changed || !valid) {
      setChecking(false);
      setOptions(null);
      setError("");
      return;
    }
    const controller = new AbortController();
    setChecking(true);
    setError("");

    const timer = setTimeout(() => {
      analyzeBillingScheduleOptions(
        enrollmentId,
        { anchor_date: value!, expected_version: version },
        controller.signal
      )
        .then((resp) => {
          if (!controller.signal.aborted) {
            setOptions(resp);
            setChecking(false);
          }
        })
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setChecking(false);
            setError(
              getApiErrorMessage(
                caught,
                "Không thể phân tích phương án lịch thu. Vui lòng thử lại."
              )
            );
          }
        });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [changed, valid, value, version, enrollmentId, retry]);

  const handleReviewClick = () => {
    if (error) {
      setError("");
      setRetry((n) => n + 1);
      return;
    }
    if (!changed || !valid) return;
    if (optionsReady && options) {
      const rec = options.options.find((o) => o.id === options.recommended_option_id) || options.options[0];
      const draft: BillingScheduleDraft = {
        anchor_date: value!,
        expected_version: version,
        strategy: rec ? rec.strategy : "KEEP_CURRENT",
        ...(rec?.suggested_first_cycle !== undefined && rec?.suggested_first_cycle !== null
          ? { first_cycle: rec.suggested_first_cycle }
          : {}),
        historical_cycles: [],
        gap_policy: "REVIEW",
        reason: "",
        expected_context_token: options.context_token,
        expected_pending_review_id: options.pending_review?.id,
      };
      onReview({ options, draft });
    }
  };

  const isButtonDisabled = changed && (!valid || (!error && (checking || !optionsReady)));

  let resolvedCurrent = currentPeriod;
  let resolvedNext = nextPeriod;
  if (!resolvedCurrent || !resolvedNext) {
    const baseDateStr = anchor || value;
    let year: number;
    let month: number;
    let day: number;
    if (baseDateStr && /^\d{4}-\d{2}-\d{2}$/.test(baseDateStr)) {
      const [y, m, d] = baseDateStr.split("-").map(Number);
      year = y;
      month = m;
      day = d;
    } else if (baseDateStr && /^(\d{2})\/(\d{2})\/(\d{4})$/.test(baseDateStr)) {
      const [d, m, y] = baseDateStr.split("/").map(Number);
      year = y;
      month = m;
      day = d;
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
      day = now.getDate();
    }
    if (!resolvedCurrent) {
      resolvedCurrent = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (!resolvedNext) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      resolvedNext = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const formattedCurrentPeriod = formatCyclePeriod(resolvedCurrent, anchor || value);
  const formattedNextPeriod = formatCyclePeriod(resolvedNext, anchor || value);
  const hasCycleInfo = Boolean(formattedCurrentPeriod || formattedNextPeriod);

  return (
    <FormField
      className="mt-3"
      label="Mốc thu học phí"
      controlId={`billing-date-${enrollmentId}`}
      error={error || undefined}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <ManualDateInput
            id={`billing-date-${enrollmentId}`}
            value={value}
            onChange={(next) => {
              setValue(next);
              setUserModified(next !== anchor);
              setOptions(null);
              setError("");
            }}
          />
        </div>
        {changed && <Button
          type="button"
          variant="outline"
          className="h-8 rounded-md border-gray-200 bg-white px-2.5 text-sm font-medium text-primary hover:bg-gray-50 hover:text-primary"
          aria-haspopup="dialog"
          aria-label={error ? "Thử lại" : checking ? "Đang kiểm tra" : "Xử lý thay đổi"}
          disabled={isButtonDisabled}
          onClick={handleReviewClick}
        >
          {error ? (
            "Thử lại"
          ) : checking ? (
            <LoadingLabel label="Đang kiểm tra" />
          ) : (
            "Xử lý thay đổi"
          )}
        </Button>}
      </div>
      {optionsReady && options?.is_blocked && <p role="status" className="mt-2 text-sm text-gray-700">
        {options.blocked_reason} Bấm Xử lý thay đổi để xem chi tiết.
      </p>}
      {hasCycleInfo ? (
        <div
          data-testid={`billing-cycle-note-${enrollmentId}`}
          className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] leading-5 text-gray-600"
        >
          <span className="inline-flex items-center">
            <span className="text-gray-500">Kỳ hiện tại:</span>&nbsp;
            <span
              className={
                currentFeeStatus === "PAID"
                  ? "font-semibold text-emerald-700 tabular-nums"
                  : "font-medium text-gray-800 tabular-nums"
              }
              title={currentFeeStatus === "PAID" ? "Đã thu học phí kỳ này" : undefined}
            >
              {formattedCurrentPeriod || "—"}
            </span>
          </span>
          <span className="select-none text-gray-300" aria-hidden="true">
            ·
          </span>
          <span className="inline-flex items-center">
            <span className="text-gray-500">Kỳ sau:</span>&nbsp;
            <span className="font-medium text-gray-800 tabular-nums">
              {formattedNextPeriod || "—"}
            </span>
          </span>
        </div>
      ) : null}
    </FormField>
  );
}
