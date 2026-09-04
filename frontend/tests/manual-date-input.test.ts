import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  comparableManualDate,
  displayToIsoDate,
  formatManualDateInput,
  isValidIsoDate,
} from "../src/components/ui/manual-date-input";

const componentSource = readFileSync(
  new URL("../src/components/ui/manual-date-input.tsx", import.meta.url),
  "utf8",
);

test("manual dates progressively format dd/mm/yyyy", () => {
  assert.equal(formatManualDateInput("1"), "1");
  assert.equal(formatManualDateInput("0109"), "01/09");
  assert.equal(formatManualDateInput("01092026"), "01/09/2026");
  assert.equal(formatManualDateInput("01-09-2026123"), "01/09/2026");
});

test("manual dates slash-aware formatting preserves day, month and year during in-place edits", () => {
  // Editing day in-place does NOT shift month or year
  assert.equal(formatManualDateInput("4/08/2026"), "4/08/2026");
  assert.equal(formatManualDateInput("14/08/2026"), "14/08/2026");
  // Editing month in-place
  assert.equal(formatManualDateInput("04/9/2026"), "04/9/2026");
  assert.equal(formatManualDateInput("04/11/2026"), "04/11/2026");
  // Editing year in-place
  assert.equal(formatManualDateInput("04/08/2027"), "04/08/2027");
});

test("manual dates remove separators after the final digit is deleted", () => {
  assert.equal(formatManualDateInput("//"), "");
});

test("manual dates emit ISO only for real calendar dates", () => {
  assert.equal(displayToIsoDate("01/09/2026"), "2026-09-01");
  assert.equal(displayToIsoDate("31/02/2026"), null);
  assert.equal(displayToIsoDate("1/9/2026"), null);
  assert.equal(isValidIsoDate("2024-02-29"), true);
  assert.equal(isValidIsoDate("2026-02-29"), false);
});

test("empty and incomplete date drafts do not become persisted changes", () => {
  assert.equal(comparableManualDate("", "2026-09-01"), "2026-09-01");
  assert.equal(comparableManualDate("01/09/20", "2026-09-01"), "2026-09-01");
  assert.equal(comparableManualDate("2026-09-02", "2026-09-01"), "2026-09-02");
});

test("manual dates preserve the exact single control presentation with flexible caret", () => {
  assert.match(componentSource, /const DATE_GUIDE = "dd\/mm\/yyyy"/);
  assert.match(componentSource, /formTextControlClassName/);
  assert.match(componentSource, /inputMode="numeric"/);
  assert.match(componentSource, /maxLength=\{10\}/);
  assert.match(componentSource, /privacyToggle/);
  assert.match(componentSource, /collapseSelectionOnKeyboardFocus/);
  assert.match(componentSource, /setSelectionRange/);
});
