"use client";
import { useEffect, useState } from "react";
import { formTextControlClassName } from "./form-text-control";
import { cn } from "@/lib/utils";

/** Filtering is committed on blur/Enter, never clamped on each typed digit. */
export function YearFilterInput({ value, onChange, disabled }: { value: number; onChange: (year: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const year = Number(draft);
    if (/^\d{4}$/.test(draft) && year >= 1900 && year <= 9998) onChange(year);
    else setDraft(String(value));
  };
  return <input type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={draft} disabled={disabled}
    onChange={e => setDraft(e.target.value.replace(/\D/g, ""))} onBlur={commit}
    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} className={cn(formTextControlClassName, "w-24")} />;
}
