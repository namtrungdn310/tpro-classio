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
const confirmationDialogSource = readFileSync(
  new URL("../src/components/ui/confirmation-dialog.tsx", import.meta.url),
  "utf8",
);

test("refund actions use the shared circular money return icon", () => {
  assert.match(refundDialogSource, /<RefundIcon className="mr-1\.5[^\"]*"/);
  assert.match(refundIconSource, /RiRefund2Line/);
  assert.match(refundIconSource, /react-icons\/ri/);
  assert.doesNotMatch(
    refundIconSource,
    /CircleDollarSign|DollarSign|RefreshCw|RotateCw/,
  );
  assert.doesNotMatch(refundDialogSource, /HandCoins/);
});

test("unpay target uses a compact segmented control matching staff type selection", () => {
  assert.match(feesPageSource, /name="fee-unpay-target-state"/);
  assert.match(
    feesPageSource,
    /mt-2 grid h-8 w-full select-none grid-cols-2 overflow-hidden rounded-md border border-gray-200 bg-white p-0\.5/,
  );
  assert.match(
    feesPageSource,
    /bg-primary text-primary-foreground/,
  );
  assert.match(feesPageSource, /visibleUnpayTargetOptions\.map/);
  assert.match(
    feesPageSource,
    /const visibleUnpayTargetOptions = UNPAY_TARGET_OPTIONS;/,
  );
  assert.match(
    feesPageSource,
    /onClick=\{\(\) => setUnpayTargetState\(option\.value\)\}/,
  );
});

test("refund method and reason share a compact responsive row", () => {
  assert.match(
    refundDialogSource,
    /sm:grid-cols-\[248px_minmax\(0,1fr\)\]/,
  );
  assert.match(refundDialogSource, /<legend[^>]*>[\s\S]*Hình thức hoàn/);
  assert.match(refundDialogSource, /<span[^>]*>[\s\S]*Lý do hoàn phí/);
  assert.match(refundDialogSource, /h-8 bg-primary/);
  assert.match(refundDialogSource, /<SegmentedControl/);
  assert.match(refundDialogSource, /options=\{\[\.\.\.REFUND_METHODS\]\}/);
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

test("fee page reaches first usable state before lazy refund history loads", () => {
  assert.match(
    feesPageSource,
    /queryKey: \["fee-transactions", "period", \{ period, feeRecordIds \}\]/,
  );
  assert.match(
    feesPageSource,
    /feesQuery\.data !== undefined &&[\s\S]*refundTarget !== null/,
  );
  assert.doesNotMatch(
    feesPageSource,
    /!hasFeeTransactionData[\s\S]*feeTransactionsQuery\.isPending/,
  );
  assert.match(
    feesPageSource,
    /transactionHistories=\{feeTransactionsQuery\.data \?\? \[\]\}/,
  );
  assert.match(feesPageSource, /Math\.ceil\(recordIds\.length \/ 100\)/);
  assert.doesNotMatch(refundDialogSource, /useQueries|getFeeTransactions/);
});

test("copy feedback identifies the two fee message types", () => {
  assert.match(feesPageSource, /Đã sao chép tin nhắn đóng học phí\./);
  assert.match(
    feesPageSource,
    /Đã sao chép tin nhắn nhận học phí\./,
  );
});

test("confirmation dialogs clear repeated-click selection without click-through", () => {
  assert.match(confirmationDialogSource, /flex select-none items-center/);
  assert.doesNotMatch(confirmationDialogSource, /clearDocumentSelection/);
  assert.match(confirmationDialogSource, /useModalDialog/);
});
