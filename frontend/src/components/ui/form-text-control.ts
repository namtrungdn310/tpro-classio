/**
 * FormTextControl — shared input styling token for all text controls in the
 * dashboard: Header search, Settings fields, and add/edit Dialog forms.
 *
 * Using a single className constant ensures that every text input has
 * identical font, height, padding, focus ring and autofill styles, which
 * eliminates compositor-layer and sub-pixel differences that caused caret
 * inconsistency across Header (fixed + composited), Settings (scroll
 * container), and Dialog (portalled to body).
 */

/** Base class for all dashboard text inputs. */
export const formTextControlClassName =
  "form-input-text h-8 w-full rounded-md border border-gray-200 bg-white px-3 text-gray-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";

/** Appended alongside formTextControlClassName when the field has a validation error. */
export const formTextControlErrorClassName =
  "border-red-500 focus:border-red-500 focus:ring-red-100";

/** Narrower variant used in the header search bar (overrides `w-full` for md breakpoint). */
export const formTextControlHeaderClassName =
  "form-input-text h-8 w-full min-w-0 rounded-md border border-gray-200 bg-white pl-7 pr-10 text-gray-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200 md:w-[min(20vw,260px)]";
