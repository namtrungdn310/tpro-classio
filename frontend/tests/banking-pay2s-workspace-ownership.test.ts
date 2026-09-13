import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bankingPage = readFileSync(
  new URL("../src/app/(dashboard)/banking/page.tsx", import.meta.url),
  "utf8",
);
const bankingApi = readFileSync(
  new URL("../src/lib/api/banking.ts", import.meta.url),
  "utf8",
);
const feesPage = readFileSync(
  new URL("../src/app/(dashboard)/fees/page.tsx", import.meta.url),
  "utf8",
);

test("banking exposes one workspace-owned Pay2S setup flow", () => {
  for (const label of [
    "Nhập khóa Pay2S của workspace này",
    "Access Key",
    "Secret Key",
    "Partner Code dùng tạo QR",
    "Lưu cấu hình",
    "Xác thực",
  ]) {
    assert.match(bankingPage, new RegExp(label));
  }

  assert.doesNotMatch(bankingPage, /Pay2S dùng chung|operatingMode|central/i);
  assert.doesNotMatch(bankingApi, /\/ops\/workspaces|managedWorkspaceId/);
  assert.match(bankingApi, /\/banking\/providers\/pay2s/);
});

test("fees can create a payment request from the regular fee list", () => {
  assert.match(feesPage, /onCreatePaymentRequest/);
  assert.match(feesPage, /FeePaymentRequestDialog/);
  assert.match(feesPage, /automatic_recording_ready/);
});
