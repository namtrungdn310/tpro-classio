/**
 * FormTextControl — shared input styling token for all text controls in the
 * dashboard: Header search, Settings fields, and add/edit Dialog forms.
 *
 * Using a single className constant keeps typography, height, padding, focus
 * ring and autofill stable across Header, Settings and portalled dialogs.
 * Caret rendering remains browser-native for every editable text control.
 */

import { cn } from "@/lib/utils";

/** Base class for all dashboard text inputs. */
export const formTextControlClassName =
  "form-input-text h-8 w-full select-text rounded-md border border-gray-200 bg-white px-3 py-0 text-gray-900 outline-none transition placeholder:font-normal placeholder:text-gray-400 focus:border-primary/60 focus:ring-1 focus:ring-primary/15 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/15 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";

/** Appended alongside formTextControlClassName when the field has a validation error. */
export const formTextControlErrorClassName =
  "border-destructive focus:!border-destructive focus:!ring-destructive/15 focus-within:!border-destructive focus-within:!ring-destructive/15";

/** Narrower variant used in the header search bar (overrides `w-full` for md breakpoint). */
export const formTextControlHeaderClassName =
  cn(formTextControlClassName, "min-w-0 pl-7 pr-10 md:w-[min(20vw,260px)]");
