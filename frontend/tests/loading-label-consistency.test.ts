import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const loadingLabelSource = source("../src/components/ui/loading-label.tsx");
const saveButtonSource = source("../src/components/ui/save-button.tsx");
const classFormSource = source("../src/components/classes/class-form-dialog.tsx");
const archiveClassSource = source("../src/components/classes/archive-class-dialog.tsx");
const staffFormSource = source("../src/components/staff/staff-form-dialog.tsx");
const studentPageSource = source("../src/app/(dashboard)/students/page.tsx");
const feeTemplateSource = source("../src/components/fees/fee-message-template-dialog.tsx");
const accountSettingsSource = source("../src/components/settings/account-settings-section.tsx");
const confirmationDialogSource = source("../src/components/ui/confirmation-dialog.tsx");

test("loading labels reserve both idle and pending widths without double punctuation", () => {
  assert.match(loadingLabelSource, /idleLabel\?: string/);
  assert.match(loadingLabelSource, /grid place-items-center whitespace-nowrap/);
  assert.match(loadingLabelSource, /<LoadingState label=\{label\} hidden=\{!isLoading\} \/>/);
  assert.match(loadingLabelSource, /loading-dots/);
  assert.doesNotMatch(loadingLabelSource, /label\}\.\.\.|label\}…/);
});

test("persisted actions expand only while the shared save button is pending", () => {
  assert.match(saveButtonSource, /<LoadingLabel/);
  assert.match(
    saveButtonSource,
    /isSaving \? <LoadingLabel label=\{pendingLabel\} \/> : idleLabel/,
  );
  assert.match(saveButtonSource, /pendingLabel = "Đang lưu"/);
  assert.match(saveButtonSource, /h-8 w-fit rounded-md/);

  for (const formSource of [
    classFormSource,
    studentPageSource,
    feeTemplateSource,
    staffFormSource,
    accountSettingsSource,
  ]) {
    assert.match(formSource, /<SaveButton/);
  }
  assert.match(studentPageSource, /label="Đang xoá"[\s\S]{0,80}idleLabel="Xoá khỏi lớp"/);
  assert.match(archiveClassSource, /label="Đang xử lý"[\s\S]{0,80}idleLabel="Ngừng lớp"/);
  assert.match(confirmationDialogSource, /label="Đang xử lý"[\s\S]{0,80}idleLabel=\{confirmLabel\}/);
});
