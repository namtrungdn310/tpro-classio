"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";
import {
  FormDialogBody,
  FormDialogCloseButton,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { ManualDateInput } from "@/components/ui/manual-date-input";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import {
  analyzeBillingScheduleOptions,
  applyBillingSchedule,
  getBillingSchedule,
  previewBillingSchedule,
  type BillingSchedule,
  type BillingScheduleDraft,
  type BillingScheduleOptionItem,
  type BillingScheduleOptionsResponse,
  type BillingSchedulePreview,
  type HistoricalCycleItem,
} from "@/lib/api/billing-dates";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
  acceptPlan,
  isUncertainBillingOutcome,
  matchesAcceptedPlan,
  type AcceptedPlan,
} from "@/lib/billing/accepted-plan";
import type { BillingDateSelection } from "./billing-date-field";

type Props = {
  enrollmentId: string;
  className?: string;
  studentName?: string;
  selection?: BillingDateSelection;
  onClose: () => void;
  onApplied: () => void;
};

const showDate = (value?: string | null) =>
  value ? value.split("-").reverse().join("/") : "—";
const showMoney = (value: number) => `${value.toLocaleString("vi-VN")}đ`;

function getOptionDisplayInfo(
  opt: BillingScheduleOptionItem
): { label: string; description: string } {
  if (opt.strategy === "KEEP_CURRENT") {
    let desc = opt.description;
    if (!desc || desc === "Kỳ hiện tại vẫn thu đúng theo mốc ban đầu, mốc mới tính từ kỳ tiếp theo.") {
      if (opt.old_due_date && opt.next_due_date) {
        desc = `Kỳ hiện tại vẫn giữ hạn thu ${showDate(opt.old_due_date)}. Mốc mới áp dụng từ kỳ sau (hạn thu ${showDate(opt.next_due_date)}).`;
      } else {
        desc = "Kỳ hiện tại vẫn thu đúng theo mốc ban đầu, mốc mới tính từ kỳ tiếp theo.";
      }
    }
    return {
      label: opt.label.startsWith("Tạm ngưng") ? opt.label : "Áp dụng mốc mới từ kỳ tiếp theo",
      description: opt.is_allowed
        ? desc
        : (opt.disabled_reason || "Không khả dụng cho trường hợp này."),
    };
  }
  if (opt.strategy === "REPLACE_CURRENT") {
    let desc = opt.description;
    if (!opt.is_allowed) {
      desc = opt.disabled_reason || "Không khả dụng vì kỳ hiện tại đã nộp học phí, không thể thay đổi hạn thu kỳ này để tránh sai lệch báo cáo tài chính.";
    } else if (!desc || desc.includes("Tính lại chu kỳ mới")) {
      if (opt.new_due_date && opt.old_due_date) {
        desc = `Đổi hạn thu kỳ này sang ngày ${showDate(opt.new_due_date)} (thay vì ${showDate(opt.old_due_date)}). Các kỳ sau theo chu kỳ của lớp, xem ngày cụ thể trong kết quả kiểm tra.`;
      } else {
        desc = "Đổi hạn thu kỳ này sang mốc mới (thay thế khoản thu chưa thanh toán).";
      }
    }
    return {
      label: "Áp dụng mốc mới ngay kỳ hiện tại",
      description: desc,
    };
  }
  let desc = opt.description;
  if (!opt.is_allowed) {
    if (opt.disabled_reason) {
      if (opt.disabled_reason.includes("giao với khoản") || opt.disabled_reason.includes("ranh giới")) {
        desc = "Không khả dụng do trùng lặp với khoản học phí đã có.";
      } else if (opt.disabled_reason.includes("quá khứ xa")) {
        desc = "Không áp dụng cho mốc ngày trong quá khứ xa.";
      } else {
        desc = opt.disabled_reason;
      }
    } else {
      desc = "Không khả dụng cho trường hợp này.";
    }
  }
  return {
    label: opt.label,
    description: desc,
  };
}

export function BillingScheduleDialog(props: Props) {
  const [shellState, setShellState] = useState({ busy: false, dirty: false });
  const query = useQuery({
    queryKey: ["billing-schedule", props.enrollmentId],
    queryFn: ({ signal }) => getBillingSchedule(props.enrollmentId, signal),
    staleTime: 30_000,
  });

  return (
      <FormDialogShell
        placement="right"
        width="standard"
        title="Xử lý đổi mốc thu học phí"
        onClose={props.onClose}
        isBusy={shellState.busy}
        dirty={shellState.dirty}
        confirmDescription="Các phương án chưa xác nhận sẽ bị huỷ. Ngày bạn nhập bên ngoài vẫn được giữ."
      >
      {query.data ? (
        props.selection?.draft && props.selection.draft.anchor_date !== query.data.anchor_date ? (
          <ScheduleEditMode {...props} initial={query.data} onShellStateChange={setShellState} />
        ) : (
          <><FormDialogBody>Không có thay đổi mốc thu cần xử lý.</FormDialogBody><FormDialogFooter><FormDialogCloseButton>Đóng</FormDialogCloseButton></FormDialogFooter></>
        )
      ) : <>
        <FormDialogBody>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            {query.isError ? (
              <>
                <p role="alert" className="text-sm font-medium text-destructive">
                  {getApiErrorMessage(query.error, "Không tải được lịch thu")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => void query.refetch()}
                >
                  Thử lại
                </Button>
              </>
            ) : (
              <LoadingLabel label="Đang tải lịch thu" />
            )}
          </div>
        </FormDialogBody>
          <FormDialogFooter>
            <FormDialogCloseButton>Đóng</FormDialogCloseButton>
          </FormDialogFooter>
      </>}
      </FormDialogShell>
    );
}


function ScheduleEditMode({
  enrollmentId,
  className,
  studentName,
  initial,
  selection,
  onApplied,
  onShellStateChange,
}: Props & {
  initial: BillingSchedule;
  onShellStateChange: (state: { busy: boolean; dirty: boolean }) => void;
}) {
  const queryClient = useQueryClient();
  const anchor = selection?.draft?.anchor_date ?? initial.anchor_date;
  const [optionsData, setOptionsData] =
    useState<BillingScheduleOptionsResponse | null>(selection?.options ?? null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [analysisAttempt, setAnalysisAttempt] = useState(0);
  const [needsRecheck, setNeedsRecheck] = useState(false);

  const [selectedOptionId, setSelectedOptionId] = useState<string>(() => {
    if (selection?.options?.recommended_option_id) {
      const rec = selection.options.options.find(
        (o) => o.id === selection.options?.recommended_option_id && o.is_allowed
      );
      if (rec) return rec.id;
    }
    const firstAllowed = selection?.options?.options.find((o) => o.is_allowed);
    if (firstAllowed) return firstAllowed.id;
    return selection?.draft?.strategy ?? "KEEP_CURRENT";
  });

  const [selectedCycles, setSelectedCycles] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    const supplied = selection?.options?.options;
    if (supplied) {
      supplied.forEach((opt) => {
        if (opt.candidate_cycles && opt.candidate_cycles.length > 0) {
          const def = opt.candidate_cycles.find((c) => c.is_default) || opt.candidate_cycles[0];
          if (def) init[opt.id] = def.cycle_no;
        }
      });
    }
    if (selection?.draft?.first_cycle !== undefined && selection?.draft?.strategy) {
      const matchOpt = selection?.options?.options.find((o) => o.strategy === selection?.draft?.strategy);
      if (matchOpt) {
        init[matchOpt.id] = selection.draft.first_cycle;
      }
    }
    return init;
  });

  const [reason, setReason] = useState(selection?.draft?.reason ?? "");
  const [replaceFutureWaivers, setReplaceFutureWaivers] = useState(false);
  const [customApplyFrom, setCustomApplyFrom] = useState(selection?.draft?.apply_from_date ?? "");
  const [useCustomDate, setUseCustomDate] = useState(Boolean(selection?.draft?.apply_from_date));
  const [firstCycleInput, setFirstCycleInput] = useState(
    selection?.draft?.first_cycle !== undefined
      ? String(selection.draft.first_cycle + 1)
      : "1"
  );
  const [selectedHistoricalCycles, setSelectedHistoricalCycles] = useState<
    number[]
  >(selection?.draft?.historical_cycles ?? []);
  const [historicalOffset, setHistoricalOffset] = useState(0);
  const [allHistoricalCycles, setAllHistoricalCycles] = useState<
    HistoricalCycleItem[]
  >([]);
  const [hasMoreHistorical, setHasMoreHistorical] = useState(false);
  const [loadingMoreHistorical, setLoadingMoreHistorical] = useState(false);
  const historicalRequest = useRef<AbortController | null>(null);

  // Ensure selected option is allowed if optionsData has loaded
  useEffect(() => {
    if (!optionsData || optionsData.is_blocked) return;
    const current = optionsData.options.find((o) => o.id === selectedOptionId);
    if (current && !current.is_allowed) {
      const allowed =
        optionsData.options.find((o) => o.id === optionsData.recommended_option_id && o.is_allowed) ||
        optionsData.options.find((o) => o.is_allowed);
      if (allowed) {
        setSelectedOptionId(allowed.id);
        if (allowed.suggested_first_cycle != null) {
          setFirstCycleInput(String(allowed.suggested_first_cycle + 1));
        }
      }
    }
  }, [optionsData, selectedOptionId]);

  useEffect(() => {
    historicalRequest.current?.abort();
    setLoadingMoreHistorical(false);
    return () => historicalRequest.current?.abort();
  }, [selectedOptionId, analysisAttempt]);

  // Preview & execution state
  const [preview, setPreview] = useState<BillingSchedulePreview | null>(null);
  const [accepted, setAccepted] = useState<AcceptedPlan<
    BillingScheduleDraft,
    BillingSchedulePreview
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const previewCacheRef = useRef<Map<string, BillingSchedulePreview>>(new Map());
  const submitting = useRef(false);

  const [baseline] = useState(() => JSON.stringify({
    selectedOptionId, firstCycleInput, selectedCycles, customApplyFrom, useCustomDate, replaceFutureWaivers,
    historical: [...selectedHistoricalCycles].sort((a, b) => a - b), reason: reason.trim(),
  }));
  const isDirty = baseline !== JSON.stringify({
    selectedOptionId, firstCycleInput, selectedCycles, customApplyFrom, useCustomDate,
    historical: [...selectedHistoricalCycles].sort((a, b) => a - b), reason: reason.trim(),
  });
  useEffect(() => {
    onShellStateChange({ busy: busy || isChecking, dirty: isDirty || uncertain });
  }, [busy, isChecking, isDirty, uncertain, onShellStateChange]);

  // Analyze options whenever anchor date changes
  useEffect(() => {
    if (busy || uncertain) return;
    if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
      setOptionsData(null);
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const supplied = selection?.options;
    if (analysisAttempt === 0 && supplied?.new_anchor_date === anchor && supplied.expected_version === initial.version) {
      const option = supplied.options.find((o) => o.id === selectedOptionId);
      setAllHistoricalCycles(option?.available_historical_cycles ?? []);
      setHasMoreHistorical(option?.has_more_historical_cycles ?? false);
      setHistoricalOffset(option?.historical_offset ?? 0);
      return;
    }
    setLoadingOptions(true);
    setOptionsError("");
    setPreviewError("");

    analyzeBillingScheduleOptions(
      enrollmentId,
      {
        anchor_date: anchor,
        expected_version: initial.version,
        historical_offset: 0,
        historical_limit: 12,
        replace_future_waivers: replaceFutureWaivers,
      },
      controller.signal
    )
      .then((resp) => {
        if (!controller.signal.aborted) {
          setOptionsData(resp);
          setLoadingOptions(false);
          // Set recommended option ONLY if user hasn't already selected a valid allowed option
          const rec =
            resp.options.find((o) => o.id === resp.recommended_option_id && o.is_allowed) ||
            resp.options.find((o) => o.is_allowed) ||
            resp.options[0];
          setSelectedOptionId((prev) => {
            const currentValid = resp.options.find((o) => o.id === prev && o.is_allowed);
            if (currentValid) return prev;
            if (rec) {
              if (rec.suggested_first_cycle !== undefined && rec.suggested_first_cycle !== null) {
                setFirstCycleInput(String(rec.suggested_first_cycle + 1));
              }
              if (rec.available_historical_cycles) {
                setAllHistoricalCycles(rec.available_historical_cycles);
                setHasMoreHistorical(rec.has_more_historical_cycles);
                setHistoricalOffset(rec.historical_offset);
              }
              return rec.id;
            }
            return prev;
          });
          // Initialize candidate cycle choices
          const newCycles: Record<string, number> = {};
          resp.options.forEach((opt) => {
            if (opt.candidate_cycles && opt.candidate_cycles.length > 0) {
              const def = opt.candidate_cycles.find((c) => c.is_default) || opt.candidate_cycles[0];
              if (def) {
                newCycles[opt.id] = def.cycle_no;
              }
            }
          });
          setSelectedCycles((prev) => {
            const merged = { ...newCycles };
            for (const [optId, cycleNo] of Object.entries(prev)) {
              const opt = resp.options.find((o) => o.id === optId);
              if (opt?.candidate_cycles?.some((c) => c.cycle_no === cycleNo)) {
                merged[optId] = cycleNo;
              }
            }
            return merged;
          });
          // Reset historical selections on anchor change
          setSelectedHistoricalCycles([]);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLoadingOptions(false);
          setOptionsError(
            getApiErrorMessage(err, "Không thể phân tích phương án lịch thu")
          );
        }
      });

    return () => controller.abort();
  // The selection is fixed for this panel session; choices must not restart analysis.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, enrollmentId, initial.version, selection?.options, analysisAttempt, replaceFutureWaivers]);

  // Load more historical cycles pagination
  const handleLoadMoreHistorical = async () => {
    if (!anchor || loadingMoreHistorical || !optionsData) return;
    const controller = new AbortController();
    historicalRequest.current = controller;
    const nextOffset = historicalOffset + 12;
    setLoadingMoreHistorical(true);
    try {
      const resp = await analyzeBillingScheduleOptions(enrollmentId, {
        anchor_date: anchor,
        expected_version: initial.version,
        historical_offset: nextOffset,
        historical_limit: 12,
        replace_future_waivers: replaceFutureWaivers,
      }, controller.signal);
      if (controller.signal.aborted) return;
      const activeOpt = resp.options.find((o) => o.id === selectedOptionId);
      if (resp.context_token !== optionsData.context_token) {
        setOptionsError("Lịch thu đã thay đổi. Đóng bảng và kiểm tra lại ngày đã nhập.");
        setAccepted(null);
        return;
      }
      if (activeOpt && activeOpt.available_historical_cycles) {
        setAllHistoricalCycles((prev) => [
          ...prev,
          ...activeOpt.available_historical_cycles,
        ]);
        setHasMoreHistorical(activeOpt.has_more_historical_cycles);
        setHistoricalOffset(nextOffset);
      }
    } catch (error) {
      if (!controller.signal.aborted) setPreviewError(getApiErrorMessage(error, "Không tải được các kỳ trước. Vui lòng thử lại."));
    } finally {
      if (!controller.signal.aborted) setLoadingMoreHistorical(false);
    }
  };

  const currentOption = optionsData?.options.find((o) => o.id === selectedOptionId);
  const firstNewCharge = preview?.plan.charges.find(
    (charge) => charge.kind === "CYCLE" && charge.cycle_no === preview.plan.first_cycle,
  );
  const otherCharges = preview?.plan.charges.filter((charge) => charge !== firstNewCharge) ?? [];
  const selectedCandidateCycleNo = currentOption ? selectedCycles[currentOption.id] : undefined;

  const isFormValid = Boolean(
    anchor &&
      /^\d{4}-\d{2}-\d{2}$/.test(anchor) &&
      currentOption?.is_allowed &&
      !loadingOptions && !optionsError &&
      optionsData?.new_anchor_date === anchor && optionsData.expected_version === initial.version &&
      (!useCustomDate || (/^\d{4}-\d{2}-\d{2}$/.test(customApplyFrom) && !Number.isNaN(Date.parse(customApplyFrom)))) &&
      (currentOption.strategy !== "FROM_CYCLE" || (/^\d+$/.test(firstCycleInput) && Number.isSafeInteger(Number(firstCycleInput)) && Number(firstCycleInput) >= 1))
  );

  const effectiveReason = reason.trim()
    ? (reason.trim().length >= 3 ? reason.trim() : `${reason.trim()} (Thay đổi mốc)`)
    : "Thay đổi mốc thu học phí";

  const currentDraft: BillingScheduleDraft = useMemo(
    () => ({
      anchor_date: anchor ?? "",
      expected_version: initial.version,
      strategy: currentOption?.strategy ?? "KEEP_CURRENT",
      ...(useCustomDate
        ? { apply_from_date: customApplyFrom }
        : selectedCandidateCycleNo !== undefined
        ? { first_cycle: selectedCandidateCycleNo }
        : currentOption?.strategy === "FROM_CYCLE"
          ? { first_cycle: Math.max(0, Number(firstCycleInput) - 1) }
          : {}),
      historical_cycles: selectedHistoricalCycles,
      gap_policy: "WAIVE",
      replace_future_waivers: replaceFutureWaivers,
      reason: effectiveReason,
      expected_context_token: optionsData?.context_token,
      expected_pending_review_id: optionsData?.pending_review?.id,
    }),
    [
      anchor,
      initial.version,
      currentOption?.strategy,
      selectedCandidateCycleNo,
      useCustomDate,
      customApplyFrom,
      firstCycleInput,
      selectedHistoricalCycles,
      effectiveReason,
      replaceFutureWaivers,
      optionsData?.context_token,
      optionsData?.pending_review?.id,
    ]
  );

  // Reset confirmation state whenever financial options/inputs change
  const financialKey = `${anchor}:${selectedOptionId}:${selectedCandidateCycleNo ?? ""}:${firstCycleInput}:${useCustomDate}:${customApplyFrom}:${replaceFutureWaivers}:${selectedHistoricalCycles.join(",")}`;
  const prevFinancialKey = useRef(financialKey);
  useEffect(() => {
    if (prevFinancialKey.current !== financialKey) {
      prevFinancialKey.current = financialKey;
      setIsConfirmed(false);
      setPreviewError("");
    }
  }, [financialKey]);

  // Background pre-warm: quietly fetch preview in background so clicking "Xác nhận mốc" is near-instant
  useEffect(() => {
    if (
      !optionsData ||
      loadingOptions ||
      optionsError ||
      optionsData.is_blocked ||
      !isFormValid ||
      busy ||
      uncertain
    )
      return;

    const cacheKey = `${enrollmentId}:${JSON.stringify(currentDraft)}`;
    if (previewCacheRef.current.has(cacheKey)) return;

    let active = true;
    const timer = setTimeout(() => {
      previewBillingSchedule(enrollmentId, currentDraft)
        .then((res) => {
          if (active && res) {
            previewCacheRef.current.set(cacheKey, res);
          }
        })
        .catch(() => {});
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    optionsData,
    loadingOptions,
    optionsError,
    isFormValid,
    busy,
    uncertain,
    currentDraft,
    enrollmentId,
  ]);

  const isPlanAccepted = matchesAcceptedPlan(accepted, currentDraft);
  const canCheck =
    isFormValid &&
    !busy &&
    !isChecking &&
    !needsRecheck &&
    !loadingOptions;

  const handleCheckPlan = async () => {
    if (!isFormValid || isChecking || busy || loadingOptions) return;
    setIsChecking(true);
    setPreviewError("");

    const cacheKey = `${enrollmentId}:${JSON.stringify(currentDraft)}`;
    const cached = previewCacheRef.current.get(cacheKey);

    if (cached) {
      setTimeout(() => {
        setPreview(cached);
        setAccepted(acceptPlan(currentDraft, cached, crypto.randomUUID()));
        setIsConfirmed(true);
        setIsChecking(false);
      }, 120);
      return;
    }

    try {
      const res = await previewBillingSchedule(enrollmentId, currentDraft);
      previewCacheRef.current.set(cacheKey, res);
      setPreview(res);
      setAccepted(acceptPlan(currentDraft, res, crypto.randomUUID()));
      setIsConfirmed(true);
    } catch (err) {
      setPreview(null);
      setAccepted(null);
      setIsConfirmed(false);
      setPreviewError(getApiErrorMessage(err, "Không thể kiểm tra phương án lịch thu"));
    } finally {
      setIsChecking(false);
    }
  };

  const handleSave = async () => {
    if (submitting.current || busy) return;

    if (uncertain) {
      if (!accepted) return;
      submitting.current = true;
      setBusy(true);
      setPreviewError("");
      try {
        await applyBillingSchedule(enrollmentId, {
          ...accepted.draft,
          request_id: accepted.requestId,
          expected_preview_fingerprint: accepted.preview.preview_fingerprint,
        });
        void queryClient.invalidateQueries({ queryKey: ["classes"] });

        // Invalidate all dependent caches
        void queryClient.invalidateQueries({
          queryKey: ["billing-schedule", enrollmentId],
        });
        void queryClient.invalidateQueries({
          queryKey: ["fees"],
          refetchType: "none",
        });
        void queryClient.invalidateQueries({
          queryKey: ["dashboard"],
          refetchType: "none",
        });
        void queryClient.invalidateQueries({
          queryKey: ["reports"],
          refetchType: "none",
        });
        void queryClient.invalidateQueries({
          queryKey: ["students"],
          refetchType: "none",
        });

        onApplied();
      } catch (caught) {
        setPreviewError(getApiErrorMessage(caught, "Không thể cập nhật lịch thu"));
        const unknown = isUncertainBillingOutcome(caught);
        setUncertain(unknown);
        if (!unknown) {
          setAccepted(null);
          setIsConfirmed(false);
          setNeedsRecheck(true);
        }
      } finally {
        setBusy(false);
        submitting.current = false;
      }
      return;
    }

    if (!accepted || !matchesAcceptedPlan(accepted, currentDraft) || !accepted.preview.can_apply) {
      return;
    }

    submitting.current = true;
    setBusy(true);
    setPreviewError("");

    try {
      await applyBillingSchedule(enrollmentId, {
        ...accepted.draft,
        request_id: accepted.requestId,
        expected_preview_fingerprint: accepted.preview.preview_fingerprint,
      });

      // Invalidate all dependent caches
      void queryClient.invalidateQueries({ queryKey: ["classes"] });
      void queryClient.invalidateQueries({
        queryKey: ["billing-schedule", enrollmentId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["fees"],
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: ["dashboard"],
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: ["reports"],
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: ["students"],
        refetchType: "none",
      });

      onApplied();
    } catch (caught) {
      setPreviewError(getApiErrorMessage(caught, "Không thể cập nhật lịch thu"));
      const unknown = isUncertainBillingOutcome(caught);
      setUncertain(unknown);
      if (!unknown) {
        setAccepted(null);
        setIsConfirmed(false);
        setNeedsRecheck(true);
      }
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  return (
    <>
      <FormDialogBody className="space-y-4">
        {/* Transition Summary Bar - Rõ ràng là đổi mốc học viên trong lớp */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50/80 px-3.5 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-1.5 font-medium text-gray-900 min-w-0">
            <span>Mốc thu học phí học viên</span>
            {studentName && (
              <strong className="font-semibold text-gray-950 truncate max-w-[200px]" title={studentName}>
                {studentName}
              </strong>
            )}
            {className && (
              <span className="text-gray-500 font-normal shrink-0">
                (Lớp {className})
              </span>
            )}
          </div>
          <span className="tabular-nums font-medium shrink-0">
            <span className="text-gray-500 line-through">
              {showDate(initial.anchor_date)}
            </span>
            {" → "}
            <span className="font-semibold text-primary">
              {showDate(anchor)}
            </span>
          </span>
        </div>


        {/* Lưới so sánh 2 kỳ - Rõ ràng, dễ đọc */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-gray-50/70 p-3.5 text-sm">
          <div>
            <span className="text-sm font-medium text-gray-700 block">
              Kỳ hiện tại:
            </span>
            <span className="font-semibold text-gray-950 mt-1 block tabular-nums text-sm">
              {optionsData?.cycle_info
                ? `${showDate(optionsData.cycle_info.current_cycle_start)} → ${showDate(optionsData.cycle_info.current_cycle_end)}`
                : "Theo lịch đã phát sinh"}
            </span>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700 block">
              Kỳ mới:
            </span>
            <span className="font-semibold text-primary mt-1 block tabular-nums text-sm">
              {(() => {
                const activeCycle = currentOption?.candidate_cycles?.find(
                  (c) => c.cycle_no === selectedCycles[selectedOptionId]
                );
                if (activeCycle) {
                  return `Từ ${showDate(activeCycle.coverage_start)}`;
                }
                if (selectedOptionId === "REPLACE_CURRENT" && currentOption?.new_due_date) {
                  return `Từ ${showDate(currentOption.new_due_date)}`;
                }
                if (currentOption?.next_due_date) {
                  return `Từ ${showDate(currentOption.next_due_date)}`;
                }
                return `Từ ${showDate(anchor)}`;
              })()}
            </span>
          </div>
        </div>

        {/* Form controls */}
        <fieldset disabled={busy || uncertain} className="space-y-4">
          {Boolean(optionsData?.replaceable_waived_intervals?.length) && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 font-medium">
                <input type="checkbox" autoComplete="off" checked={replaceFutureWaivers}
                  disabled={loadingOptions || isChecking}
                  aria-describedby="future-waivers-help"
                  onChange={(event) => {
                    setReplaceFutureWaivers(event.target.checked);
                    setAccepted(null);
                    setPreview(null);
                    setIsConfirmed(false);
                    setSelectedCycles({});
                    setLoadingOptions(true);
                    setAnalysisAttempt((n) => n + 1);
                  }} />
                Thay thế phần miễn thu của kế hoạch tương lai chưa áp dụng
              </label>
              <p id="future-waivers-help" className="text-gray-600">
                Dùng khi cần sửa mốc đã nhập nhầm. Chỉ tính lại các khoảng bên dưới theo phương án mới;
                không xóa lịch sử, không thay khoản đã có tiền hoặc phần miễn thu đã bắt đầu.
              </p>
              <ul className="list-disc pl-5 tabular-nums">
                {optionsData?.replaceable_waived_intervals?.map((span) => (
                  <li key={`${span.start}:${span.end}`}>Từ {showDate(span.start)} đến trước {showDate(span.end)}</li>
                ))}
              </ul>
            </div>
          )}
          {/* Options loading & list */}
          {loadingOptions ? (
            <div className="py-6 text-center text-sm text-gray-600">
              <LoadingLabel label="Đang phân tích" />
            </div>
          ) : optionsError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
            >
              {optionsError}
            </div>
          ) : optionsData?.is_blocked ? (
            <div
              role="status"
              className="rounded-lg border border-gray-200 bg-gray-50 p-3.5 text-sm text-gray-700"
            >
              {optionsData.blocked_reason || "Chưa có phương án có thể áp dụng. Vui lòng kiểm tra dữ liệu lịch thu."}
            </div>
          ) : optionsData ? (
            (() => {
              const optionsToShow = optionsData.options;
              return (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="form-section-title-text text-[15px] font-bold text-gray-950">
                      Phương án áp dụng mốc mới
                    </span>
                    {optionsToShow.length > 1 && (
                      <span className="text-xs font-semibold text-gray-600 bg-gray-100 rounded px-2 py-0.5">
                        {optionsToShow.length} phương án
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {optionsToShow.map((opt: BillingScheduleOptionItem) => {
                      const isSelected = selectedOptionId === opt.id;
                      const { label: labelText, description: descText } = getOptionDisplayInfo(opt);

                      const handleSelect = () => {
                        if (!opt.is_allowed || busy || uncertain) return;
                        if (selectedOptionId !== opt.id) {
                          setSelectedOptionId(opt.id);
                          setPreviewError("");
                          if (opt.suggested_first_cycle != null) {
                            setFirstCycleInput(String(opt.suggested_first_cycle + 1));
                          }
                          if (opt.available_historical_cycles) {
                            setAllHistoricalCycles(opt.available_historical_cycles);
                            setHistoricalOffset(opt.historical_offset);
                            setHasMoreHistorical(opt.has_more_historical_cycles);
                          }
                        }
                      };

                      return (
                        <div
                          key={opt.id}
                          role="button"
                          tabIndex={opt.is_allowed ? 0 : -1}
                          className={cn(
                            "relative block rounded-lg border p-4 text-left transition-all duration-150 ease-out select-none",
                            !opt.is_allowed
                              ? "cursor-not-allowed border-gray-200 bg-gray-50/70 opacity-60"
                              : isSelected
                                ? "border-primary bg-primary-soft/15 ring-1 ring-primary/30 shadow-xs cursor-pointer"
                                : "cursor-pointer border-gray-200 bg-white hover:border-primary/40 hover:bg-gray-50/70 shadow-xs active:scale-[0.995]"
                          )}
                          onClick={handleSelect}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelect();
                            }
                          }}
                        >
                          <input
                            type="radio"
                            name="billing_option"
                            id={`opt-${opt.id}`}
                            checked={isSelected}
                            disabled={!opt.is_allowed || busy || uncertain}
                            onChange={handleSelect}
                            tabIndex={-1}
                            className="sr-only pointer-events-none"
                          />

                          <div className="flex flex-col gap-2 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={cn(
                                  "text-[15px] sm:text-base font-bold leading-snug",
                                  !opt.is_allowed ? "text-gray-400" : "text-gray-900"
                                )}
                              >
                                {labelText}
                              </span>
                              {opt.is_recommended && opt.is_allowed && (
                                <StatusPill tone="primary" className="text-xs font-semibold">
                                  Đề xuất
                                </StatusPill>
                              )}
                              {!opt.is_allowed && (
                                <StatusPill tone="gray" className="text-xs font-medium">
                                  Không khả dụng
                                </StatusPill>
                              )}
                            </div>
                            {descText && (
                              <p
                                className={cn(
                                  "text-sm leading-relaxed",
                                  !opt.is_allowed ? "text-gray-400" : "text-gray-700"
                                )}
                              >
                                {descText}
                              </p>
                            )}

                            {/* Flexible Candidate Cycle Selector */}
                            {opt.candidate_cycles && opt.candidate_cycles.length > 1 && opt.is_allowed && (
                              <div
                                className="mt-2 pt-2.5 border-t border-gray-100"
                                onClick={() => {
                                  // Clicking anywhere in the candidate cycles container selects this option immediately
                                  handleSelect();
                                }}
                              >
                                <span className="text-xs font-semibold text-gray-600 block mb-1.5 pointer-events-none">
                                  Chọn thời điểm bắt đầu mốc mới:
                                </span>
                                <div
                                  className="flex flex-wrap gap-1.5"
                                  role="radiogroup"
                                  aria-label="Thời điểm bắt đầu mốc mới"
                                >
                                  {opt.candidate_cycles.map((cand) => {
                                    const isCandSelected =
                                      !useCustomDate &&
                                      (selectedCycles[opt.id] ?? opt.candidate_cycles[0].cycle_no) ===
                                      cand.cycle_no;
                                    return (
                                      <button
                                        key={cand.cycle_no}
                                        type="button"
                                        role="radio"
                                        aria-checked={isCandSelected}
                                        disabled={!opt.is_allowed || busy || uncertain}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSelect();
                                          setUseCustomDate(false);
                                          setSelectedCycles((prev) => ({
                                            ...prev,
                                            [opt.id]: cand.cycle_no,
                                          }));
                                        }}
                                        className={cn(
                                          "inline-flex h-7 min-h-[28px] items-center justify-center rounded-md border px-2.5 text-xs font-medium tabular-nums transition-colors select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/25 active:scale-[0.98]",
                                          isCandSelected && isSelected
                                            ? "border-primary bg-primary text-white shadow-2xs font-medium"
                                            : isCandSelected
                                              ? "border-primary/50 bg-primary-soft text-primary font-medium"
                                              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                                        )}
                                      >
                                        {cand.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          ) : null}

          {currentOption?.is_allowed && currentOption.strategy !== "UNCHANGED" && (
            <div className="space-y-2">
              <Button type="button" variant="outline" aria-expanded={useCustomDate}
                disabled={busy || uncertain || isChecking} onClick={() => setUseCustomDate(!useCustomDate)}>
                {useCustomDate ? "Dùng kỳ gợi ý" : "Chọn thời điểm áp dụng khác"}
              </Button>
              {useCustomDate && (
                <FormField label="Áp dụng từ kỳ bắt đầu vào hoặc sau ngày" controlId="billing-apply-from"
                  hint="Hệ thống chọn kỳ theo mốc mới và hiển thị ngày chính xác trước khi lưu. Đây không phải đổi hạn riêng một khoản.">
                  <ManualDateInput id="billing-apply-from" value={customApplyFrom}
                    onChange={(value) => setCustomApplyFrom(value ?? "")}
                    disabled={busy || uncertain || isChecking} />
                </FormField>
              )}
            </div>
          )}
          {/* Numeric fallback for older option responses without date candidates. */}
          {currentOption?.strategy === "FROM_CYCLE" && !useCustomDate && !currentOption.candidate_cycles.length && (
            <FormField
              label="Kỳ bắt đầu áp dụng"
              controlId="billing-first-cycle"
              hint="Chọn kỳ hiện tại hoặc tương lai (đánh số từ 1)."
            >
              <input
                autoComplete="off"
                id="billing-first-cycle"
                className={formTextControlClassName}
                inputMode="numeric"
                value={firstCycleInput}
                onChange={(e) => setFirstCycleInput(e.target.value)}
                placeholder="1"
              />
            </FormField>
          )}



          {/* Sub-options: Paginated historical cycles selection */}
          {(currentOption?.requires_historical_selection ||
            allHistoricalCycles.length > 0) && (
            <details
              open={currentOption?.requires_historical_selection || selectedHistoricalCycles.length > 0}
              className="group rounded-lg border border-gray-200 bg-gray-50/40 p-3 text-sm transition-all"
            >
              <summary className="flex cursor-pointer items-center justify-between font-medium text-gray-800 select-none">
                <div className="flex items-center gap-2">
                  <span className="form-label-text text-gray-900">
                    Kỳ cần truy thu khi áp dụng mốc mới
                  </span>
                  {selectedHistoricalCycles.length > 0 ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {selectedHistoricalCycles.length} kỳ đã chọn
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500 font-normal">
                      (Mặc định không truy thu)
                    </span>
                  )}
                </div>
                <span className="text-xs text-primary font-medium group-open:rotate-180 transition-transform inline-block">
                  ▼
                </span>
              </summary>
              <div className="mt-2.5 pt-2 border-t border-gray-200/60 space-y-2">
                <p className="text-xs text-gray-500">
                  Hệ thống không tự tạo nợ quá khứ. Chỉ tích chọn nếu bạn muốn chủ động tạo thêm khoản thu cho các kỳ trước.
                </p>
                <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                  {allHistoricalCycles.map((hc) => {
                    const isChecked = selectedHistoricalCycles.includes(hc.cycle_no);
                    return (
                      <label
                        key={hc.cycle_no}
                        className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white p-2.5 text-sm text-gray-800 transition hover:bg-gray-50/80"
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            autoComplete="off"
                            checked={isChecked}
                            onChange={(e) => {
                              setSelectedHistoricalCycles((prev) =>
                                e.target.checked
                                  ? [...prev, hc.cycle_no]
                                  : prev.filter((n) => n !== hc.cycle_no)
                              );
                            }}
                            className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                          />
                          <span className="font-medium text-gray-900">
                            {hc.label}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500 tabular-nums">
                          {showDate(hc.coverage_start)} – {showDate(hc.coverage_end)}
                        </span>
                      </label>
                    );
                  })}
                  {hasMoreHistorical && (
                    <button
                      type="button"
                      disabled={loadingMoreHistorical}
                      onClick={handleLoadMoreHistorical}
                      className="w-full py-2 text-center text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                    >
                      {loadingMoreHistorical ? (
                        <LoadingLabel label="Đang tải thêm" />
                      ) : (
                        "Xem thêm các kỳ trước đó"
                      )}
                    </button>
                  )}
                </div>
              </div>
            </details>
          )}

          {/* Optional reason */}
          <FormField
            label="Lý do điều chỉnh"
            controlId="billing-reason"
          >
            <textarea
              id="billing-reason"
              autoComplete="off"
              rows={3}
              className="min-h-20 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm leading-5 font-normal text-gray-900 outline-none transition placeholder:font-normal placeholder:text-gray-400 focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập lý do điều chỉnh lịch thu (tuỳ chọn)..."
            />
          </FormField>
        </fieldset>

        {previewError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
          >
            {previewError}
          </div>
        )}
        {(needsRecheck || optionsError || optionsData?.is_blocked) && !uncertain && (
          <Button
            type="button"
            variant="outline"
            className="text-primary"
            disabled={busy || loadingOptions || isChecking}
            onClick={async () => {
              setAccepted(null);
              setPreview(null);
              setIsConfirmed(false);
              setLoadingOptions(true);
              await queryClient.refetchQueries({ queryKey: ["billing-schedule", enrollmentId] });
              setNeedsRecheck(false);
              setAnalysisAttempt((n) => n + 1);
            }}
          >
            Kiểm tra lại
          </Button>
        )}

        {/* Loading animation khi nhấn Xác nhận mốc */}
        {isChecking && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-2.5 rounded-lg border border-primary/20 bg-primary-soft/10 p-4 text-sm font-medium text-primary transition-all duration-200"
          >
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <LoadingLabel label="Đang kiểm tra chi tiết phương án" />
          </div>
        )}

        {/* Live Preview Panel - Gọn gàng, đúng trọng tâm, font chữ chuẩn Tpro - Chỉ hiện sau khi ấn Xác nhận mốc */}
        {!isChecking && isConfirmed && preview && isPlanAccepted && (
          <div
            className="rounded-lg border border-primary/20 bg-primary-soft/10 p-4 space-y-3 transition-all duration-200"
            aria-label="Xem trước lịch thu sau khi đổi mốc"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white text-xs font-bold">
                  ✓
                </div>
                <span className="text-[15px] sm:text-base font-bold text-gray-950">
                  Kết quả kiểm tra phương án
                </span>
              </div>
              <span className="inline-flex items-center rounded-full bg-white border border-primary/20 px-2.5 py-0.5 text-xs font-semibold text-primary shadow-2xs">
                Hợp lệ · Sẵn sàng áp dụng
              </span>
            </div>

            {/* Trọng tâm 1: Kỳ thu kế tiếp theo mốc mới */}
            {preview.plan.suspension_adjustment ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Miễn thu và ngày hoãn được đối chiếu để không tính trùng: bảo lưu {preview.plan.suspension_adjustment.previous_days} → {preview.plan.suspension_adjustment.preserved_days} ngày.
              {preview.plan.suspension_adjustment.pending_only ? " Phần chênh lệch được ghi nhận chờ kỳ phù hợp." : ` Áp dụng từ kỳ bắt đầu ${showDate(preview.plan.suspension_adjustment.applies_from)}; khoản đã chốt giữ nguyên.`}
            </p> : null}
            {Boolean(preview.plan.replaced_waived_intervals?.length) && (
              <div role="status" className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                <p className="font-semibold">Phần miễn thu cũ sẽ được thay thế khi lưu:</p>
                {preview.plan.replaced_waived_intervals?.map((span) => (
                  <p key={`${span.start}:${span.end}`}>Từ {showDate(span.start)} đến trước {showDate(span.end)}</p>
                ))}
                <p>Học phí và khoảng miễn thu mới theo kết quả bên dưới. Lịch sử cũ vẫn được giữ.</p>
              </div>
            )}
            {firstNewCharge && (
              <div className="rounded-lg border border-gray-200 bg-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 font-medium mb-1">
                  <span className="uppercase tracking-wider font-bold text-primary text-xs">
                    Kỳ thu kế tiếp
                  </span>
                  <span>
                    Hạn nộp:{" "}
                    <strong className="text-gray-950 font-bold">
                      {showDate(firstNewCharge.due_date)}
                    </strong>
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 mt-1">
                  <span className="text-sm sm:text-base font-semibold text-gray-950 tabular-nums">
                    {showDate(firstNewCharge.coverage.start)} – trước{" "}
                    {showDate(firstNewCharge.coverage.end)}
                  </span>
                  <span className="text-base sm:text-lg font-bold text-gray-950 tabular-nums">
                    {showMoney(firstNewCharge.amount)}
                  </span>
                </div>
              </div>
            )}

            {/* Trọng tâm 2: Tác động đến khoản thu cũ / hiện tại */}
            {preview.plan.scheduled_segments.map((segment, index) => (
              <div key={index} className="rounded-md border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800">
                Tiếp tục lịch cũ từ {showDate(segment.coverage.start)} đến trước {showDate(segment.coverage.end)}.
                {" "}Mức phí mỗi kỳ: {showMoney(segment.amount)}. Các khoản được sinh dần khi đến kỳ, không tạo trước toàn bộ.
              </div>
            ))}
            {preview.replaced_fees.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-sm text-amber-950 flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-medium min-w-0 flex-1 break-words">
                  Khoản sẽ được thay thế: Hủy khoản thu chưa nộp {preview.replaced_fees.map((f) => (f.coverage ? `${showDate(f.coverage.start)} – ${showDate(f.coverage.end)}` : "")).join(", ")}
                </span>
                <span className="font-bold text-amber-950 shrink-0">
                  {preview.replaced_fees.map((f) => showMoney(f.amount)).join(", ")}
                </span>
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-white/90 px-3.5 py-2.5 text-sm font-medium text-gray-800 break-words">
                Không thay thế khoản thu cũ. Các khoản đã có và giao dịch đã ghi nhận được giữ nguyên.
              </div>
            )}

            {/* Trọng tâm 3: Khoản chờ duyệt (nếu có) */}
            {preview.pending_review && preview.pending_review.fees.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-sm text-amber-950">
                <p className="font-medium break-words">
                  Đồng thời xác nhận và cập nhật {preview.pending_review.fees.length} khoản thu trong đợt chờ duyệt.
                </p>
              </div>
            )}

            {/* Trọng tâm 4: Khoảng chuyển tiếp miễn thu (nếu có) */}
            {preview.plan.waived_intervals.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-sm font-medium text-amber-950 break-words">
                Miễn thu khoảng chuyển tiếp:{" "}
                {preview.plan.waived_intervals
                  .map((w) => `${showDate(w.start)} – ${showDate(w.end)}`)
                  .join(", ")}
              </div>
            )}

            {/* Thu gọn tùy chọn: Xem danh sách toàn bộ kỳ nếu cần */}
            {otherCharges.length > 0 && (
              <details className="text-sm text-gray-600 pt-1">
                <summary className="cursor-pointer text-primary hover:underline select-none font-medium">
                  Xem thêm {otherCharges.length} khoản dự kiến (gồm truy thu nếu đã chọn)
                </summary>
                <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto pr-1">
                  {otherCharges.map((ch, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center justify-between gap-1 rounded border border-gray-100 bg-white px-3 py-1.5 text-sm"
                    >
                      <span className="tabular-nums font-medium text-gray-900">
                        {showDate(ch.coverage.start)} – {showDate(ch.coverage.end)}
                      </span>
                      <span className="tabular-nums text-gray-700">
                        Hạn thu: {showDate(ch.due_date)} ·{" "}
                        <strong className="font-bold text-gray-950">
                          {showMoney(ch.amount)}
                        </strong>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogCloseButton disabled={busy || isChecking} className="h-8 rounded-md px-3 text-sm font-medium">
          Huỷ
        </FormDialogCloseButton>

        {isConfirmed && isPlanAccepted && !uncertain ? (
          <Button
            type="button"
            className="h-8 rounded-md px-3.5 text-sm font-medium"
            disabled={busy || !accepted?.preview.can_apply}
            onClick={handleSave}
          >
            {busy ? (
              <LoadingLabel label="Đang lưu..." />
            ) : (
              "Lưu"
            )}
          </Button>
        ) : uncertain ? (
          <Button
            type="button"
            className="h-8 rounded-md px-3 text-sm font-medium"
            disabled={busy || !accepted}
            onClick={handleSave}
          >
            {busy ? (
              <LoadingLabel label="Đang lưu..." />
            ) : (
              "Thử lại lưu"
            )}
          </Button>
        ) : (
          <Button
            type="button"
            className="h-8 rounded-md px-3.5 text-sm font-medium"
            disabled={!canCheck}
            onClick={handleCheckPlan}
          >
            {isChecking ? (
              <LoadingLabel label="Đang kiểm tra..." />
            ) : (
              "Xác nhận mốc"
            )}
          </Button>
        )}
      </FormDialogFooter>
    </>
  );
}
