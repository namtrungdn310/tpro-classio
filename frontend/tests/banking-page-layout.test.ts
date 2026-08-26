import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bankingPage = readFileSync(
  new URL("../src/app/(dashboard)/banking/page.tsx", import.meta.url),
  "utf8",
);

test("banking page follows the dashboard panel scrolling contract", () => {
  assert.match(
    bankingPage,
    /flex min-h-0 flex-col gap-3 md:h-full md:overflow-hidden/,
  );
  assert.match(
    bankingPage,
    /scrollbar-hidden min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain/,
  );
  assert.match(
    bankingPage,
    /scrollbar-hidden min-h-0 overflow-x-hidden overscroll-contain md:flex-1 md:overflow-y-auto/,
  );
});

test("banking section switch matches the shared dashboard scope navigation", () => {
  assert.match(bankingPage, /aria-label="Khu vực ngân hàng"/);
  assert.match(bankingPage, /aria-pressed=\{activeTab === "accounts"\}/);
  assert.match(bankingPage, /aria-pressed=\{activeTab === "pay2s"\}/);
  assert.match(bankingPage, /onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(
    bankingPage,
    /bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary\/20/,
  );
  assert.match(
    bankingPage,
    /scrollbar-hidden flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1\.5/,
  );
});

test("banking actions and dialogs inherit shared controls", () => {
  assert.doesNotMatch(bankingPage, /bankingHeaderButtonClassName/);
  assert.match(bankingPage, /<FormDialogShell/);
  assert.match(bankingPage, /<FormDialogBody/);
  assert.match(bankingPage, /<FormDialogFooter/);
  assert.match(
    bankingPage,
    /scrollbar-hidden flex max-w-full items-center gap-1 overflow-x-auto/,
  );
});
