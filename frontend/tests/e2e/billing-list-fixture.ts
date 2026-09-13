import type { Route } from "@playwright/test";

type Fee = { id: string; coverage_start: string | null; coverage_end: string | null; due_date: string | null; status: string; amount: number; paid_amount?: number; refunded_amount?: number };
export async function fulfillScheduleRead(route: Route, schedule: { fees: Fee[]; [key: string]: unknown }) {
  const url = new URL(route.request().url());
  if (!url.pathname.endsWith("/fees")) return route.fulfill({ json: { ...schedule, fees: [] } });
  const year = Number(url.searchParams.get("year") ?? 2026);
  const page = Number(url.searchParams.get("page") ?? 1);
  const size = Number(url.searchParams.get("page_size") ?? 20);
  const current = (f: Fee) => !["VOID", "SUPERSEDED"].includes(f.status);
  const pending = (f: Fee) => current(f) && f.status !== "PAID" && (f.paid_amount ?? 0) < f.amount;
  const feeYear = (f: Fee) => Number((f.coverage_start ?? f.due_date)?.slice(0, 4));
  const rows = schedule.fees.filter(f => (!year || feeYear(f) === year)
    && (url.searchParams.get("include_inactive") === "true" || current(f))
    && (url.searchParams.get("state") !== "PENDING" || pending(f))
    && (url.searchParams.get("state") !== "PAID" || (current(f) && f.status === "PAID" && !f.refunded_amount))
    && (url.searchParams.get("state") !== "REFUNDED" || (current(f) && (f.refunded_amount ?? 0) > 0)))
    .sort((a, b) => ((a.coverage_start ?? a.due_date ?? "").localeCompare(b.coverage_start ?? b.due_date ?? "") || (a.coverage_end ?? "").localeCompare(b.coverage_end ?? "") || (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.id.localeCompare(b.id)) * (url.searchParams.get("order") === "asc" ? 1 : -1));
  return route.fulfill({ json: { items: rows.slice((page - 1) * size, page * size), total: rows.length, page, page_size: size, has_next: page * size < rows.length,
    year: year || null, current_year: 2026, available_years: [...new Set([2026, ...schedule.fees.map(feeYear).filter(Boolean)])].sort((a, b) => b - a),
    older_pending_count: schedule.fees.filter(f => pending(f) && feeYear(f) < (year || 2026)).length,
    undated_pending_count: 0,
  } });
}
