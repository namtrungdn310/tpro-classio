import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const feesPageSource = readFileSync(
  new URL("../src/app/(dashboard)/fees/page.tsx", import.meta.url),
  "utf8",
);
const refundDialogSource = readFileSync(
  new URL("../src/components/fees/fee-refund-dialog.tsx", import.meta.url),
  "utf8",
);
const refundIconSource = readFileSync(
  new URL("../src/components/ui/refund-icon.tsx", import.meta.url),
  "utf8",
);

test("refund actions use the shared circular money return icon", () => {
  assert.match(refundDialogSource, /<RefundIcon className="mr-1\.5"/);
  assert.match(refundIconSource, /viewBox="0 0 24 24"/);
  assert.match(refundIconSource, /A10 10/);
  assert.match(refundIconSource, /h-3\.6/);
  assert.match(refundIconSource, /M15\.75 7\.75h-5\.2/);
  assert.doesNotMatch(
    refundIconSource,
    /CircleDollarSign|DollarSign|RefreshCw|RotateCw/,
  );
  assert.doesNotMatch(refundDialogSource, /HandCoins/);
});

test("unpay target keeps accessible radios without a tinted segmented wrapper", () => {
  assert.match(feesPageSource, /name="fee-unpay-target-state"/);
  assert.match(feesPageSource, /mt-2 grid h-9 gap-1\.5/);
  assert.doesNotMatch(
    feesPageSource,
    /mt-2 grid h-9 grid-cols-2 overflow-hidden rounded-md border border-gray-200 bg-white p-0\.5/,
  );
  assert.match(
    feesPageSource,
    /border-gray-950 bg-gray-950 text-white/,
  );
  assert.match(feesPageSource, /visibleUnpayTargetOptions\.map/);
});

test("refund method and reason share a compact responsive row", () => {
  assert.match(
    refundDialogSource,
    /sm:grid-cols-\[248px_minmax\(0,1fr\)\]/,
  );
  assert.match(refundDialogSource, /<legend[^>]*>[\s\S]*Hình thức hoàn/);
  assert.match(refundDialogSource, /<span[^>]*>[\s\S]*Lý do hoàn phí/);
  assert.match(refundDialogSource, /whitespace-nowrap/);
  assert.match(refundDialogSource, /h-8 bg-sky-600/);
  assert.match(
    refundDialogSource,
    /mt-1\.5 grid h-8 grid-cols-2 overflow-hidden rounded-md border border-gray-200 bg-white p-0\.5/,
  );
  assert.match(refundDialogSource, /form-input-text flex h-full/);
  assert.match(refundDialogSource, /bg-gray-950 text-white/);
  assert.doesNotMatch(refundDialogSource, /block max-w-\[360px\]/);
});

test("refund form omits the redundant total panel and reason example", () => {
  assert.doesNotMatch(refundDialogSource, /Tổng tiền sẽ hoàn/);
  assert.doesNotMatch(
    refundDialogSource,
    /placeholder="Ví dụ: Học viên dừng khóa học sớm"/,
  );
  assert.match(refundDialogSource, />\s*Lý do hoàn phí\s*</);
  assert.doesNotMatch(
    refundDialogSource,
    /Vui lòng nhập lý do hoàn phí có ít nhất 3 ký tự\./,
  );
});

test("refund validation reports each required amount while the reason remains optional", () => {
  assert.match(refundDialogSource, /getRefundAmountErrors/);
  assert.match(refundDialogSource, /useFormFieldFeedback\(feedbackFields\)/);
  assert.match(refundDialogSource, /onDraftChange=\{\(rawValue, isComplete\)/);
  assert.match(refundDialogSource, /Số tiền hoàn chưa đúng định dạng\./);
  assert.match(refundDialogSource, /onBlur=\{\(\) => markBlur\(amountField\)\}/);
  assert.match(refundDialogSource, /markSubmitted\(\)/);
  assert.match(
    refundDialogSource,
    /ariaDescribedBy=\{amountError \? amountErrorId : undefined\}/,
  );
  assert.doesNotMatch(refundDialogSource, /visibleReasonError|reasonErrorId/);
  assert.doesNotMatch(refundDialogSource, /setFormError|formErrorId/);
});

test("refund reversal keeps invalid feedback live and exposes it accessibly", () => {
  assert.match(refundDialogSource, /markReversalInput\("reason", value\)/);
  assert.match(refundDialogSource, /markReversalBlur\("reason"\)/);
  assert.match(refundDialogSource, /markReversalSubmitted\(\)/);
  assert.match(refundDialogSource, /aria-invalid=\{Boolean\(reversalError\)\}/);
  assert.match(
    refundDialogSource,
    /aria-describedby=\{reversalError \? reversalErrorId : undefined\}/,
  );
  assert.doesNotMatch(refundDialogSource, /setReversalError\(null\)/);
});

test("fee page finishes initial loading only after refund history is ready", () => {
  assert.match(
    feesPageSource,
    /queryKey: \["fee-transactions", "period", \{ period, feeRecordIds \}\]/,
  );
  assert.match(
    feesPageSource,
    /hasFeeData &&[\s\S]*!hasFeeTransactionData &&[\s\S]*feeTransactionsQuery\.isPending/,
  );
  assert.match(
    feesPageSource,
    /transactionHistories=\{feeTransactionsQuery\.data \?\? \[\]\}/,
  );
  assert.match(feesPageSource, /Math\.ceil\(recordIds\.length \/ 100\)/);
  assert.doesNotMatch(refundDialogSource, /useQueries|getFeeTransactions/);
});
