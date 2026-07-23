import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getContactSuggestionQuery } from "../src/lib/students/use-contact-pair-suggestion";

const studentPageSource = readFileSync(
  fileURLToPath(new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url)),
  "utf8",
);

test("uses a complete Vietnamese phone to suggest the missing Zalo name", () => {
  assert.deepEqual(getContactSuggestionQuery("", "0912 345 678"), {
    target: "zalo",
    phone: "0912345678",
  });
  assert.deepEqual(getContactSuggestionQuery("", "+84 912 345 678"), {
    target: "zalo",
    phone: "0912345678",
  });
});

test("uses a Zalo name to suggest the missing phone", () => {
  assert.deepEqual(getContactSuggestionQuery("  Mẹ An  ", ""), {
    target: "phone",
    zaloName: "Mẹ An",
  });
});

test("does not query while a phone is incomplete or both fields have values", () => {
  assert.equal(getContactSuggestionQuery("", "09123"), null);
  assert.equal(getContactSuggestionQuery("Mẹ An", "0912345678"), null);
  assert.equal(getContactSuggestionQuery("", ""), null);
});

test("renders an inline accessible suggestion accepted with Tab for both contact groups", () => {
  assert.match(studentPageSource, /aria-autocomplete=.*"inline"/);
  assert.match(studentPageSource, /aria-keyshortcuts=.*"Tab"/);
  assert.match(studentPageSource, /event\.key === "Tab"/);
  assert.match(studentPageSource, /owner: "student"/);
  assert.match(studentPageSource, /owner: "parent"/);
  assert.match(studentPageSource, /Nhấn Tab để điền nhanh/);
});
