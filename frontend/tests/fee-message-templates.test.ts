import assert from "node:assert/strict";
import test from "node:test";
import {
  FEE_MESSAGE_TOKENS,
  feeMessageTemplatesResponseSchema,
  feeMessageTemplateValuesSchema,
  splitFeeMessageTemplateLines,
  tokenizeFeeMessageTemplate,
} from "../src/lib/fees/message-templates";
import { TEST_FEE_MESSAGE_TEMPLATES as DEFAULT_FEE_MESSAGE_TEMPLATES } from "./fixtures/fee-message-templates";

test("keeps the default workflow layout explicit and distinguishes hard breaks from same-line fields", () => {
  assert.deepEqual(splitFeeMessageTemplateLines(DEFAULT_FEE_MESSAGE_TEMPLATES.payment_reminder_template), [
    "TPRO English xin thông báo học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:",
    "{{chi_tiet_hoc_phi}}",
    "Ngày đến hạn: {{ngay_den_han}}.",
    "Tổng học phí cần thanh toán: {{tong_tien}}.",
    "Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.",
  ]);
  assert.deepEqual(splitFeeMessageTemplateLines(DEFAULT_FEE_MESSAGE_TEMPLATES.payment_received_template), [
    "TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:",
    "{{chi_tiet_hoc_phi}}",
    "Ngày đến hạn: {{ngay_den_han}}.",
    "Tổng học phí đã nhận: {{tong_tien}}.",
    "TPRO English cảm ơn phụ huynh.",
  ]);
  assert.equal(DEFAULT_FEE_MESSAGE_TEMPLATES.payment_reminder_template.includes("{{ky_hoc_phi}}\n"), false);
  assert.equal(DEFAULT_FEE_MESSAGE_TEMPLATES.payment_received_template.includes("{{tong_tien}}.\n"), true);
});

test("normalizes platform line endings without changing authored layout", () => {
  const parsed = feeMessageTemplateValuesSchema.parse({
    payment_reminder_template: `${DEFAULT_FEE_MESSAGE_TEMPLATES.payment_reminder_template}\r\n`,
    payment_received_template: DEFAULT_FEE_MESSAGE_TEMPLATES.payment_received_template,
  });

  assert.equal(
    parsed.payment_reminder_template,
    `${DEFAULT_FEE_MESSAGE_TEMPLATES.payment_reminder_template}\n`,
  );
});

test("preserves intentional blank and trailing editor rows", () => {
  const reminder = DEFAULT_FEE_MESSAGE_TEMPLATES.payment_reminder_template.replace(
    "Tổng học phí cần thanh toán: {{tong_tien}}.\n",
    "Tổng học phí cần thanh toán: {{tong_tien}}.\n\n",
  );
  const receipt = `${DEFAULT_FEE_MESSAGE_TEMPLATES.payment_received_template}\n`;

  const parsed = feeMessageTemplateValuesSchema.parse({
    payment_reminder_template: reminder,
    payment_received_template: receipt,
  });

  assert.equal(parsed.payment_reminder_template, reminder);
  assert.equal(parsed.payment_received_template, receipt);
  assert.equal(parsed.payment_reminder_template.split("\n").length, 6);
  assert.equal(parsed.payment_received_template.split("\n").length, 6);
});

test("tokenizes supported variables into user-facing Zalo editor labels", () => {
  assert.deepEqual(
    tokenizeFeeMessageTemplate("Học phí {{ky_hoc_phi}} của {{ten_hoc_vien}}"),
    [
      { type: "text", value: "Học phí " },
      { type: "token", label: "Kỳ học phí", value: "{{ky_hoc_phi}}" },
      { type: "text", value: " của " },
      { type: "token", label: "Tên học viên", value: "{{ten_hoc_vien}}" },
    ],
  );
});

test("exposes the fixed class-amount and due-date tokens without the legacy overdue token", () => {
  assert.deepEqual(
    FEE_MESSAGE_TOKENS.map(({ label, token }) => ({ label, token })),
    [
      { label: "Tên học viên", token: "{{ten_hoc_vien}}" },
      { label: "Kỳ học phí", token: "{{ky_hoc_phi}}" },
      { label: "Tên lớp: Số tiền", token: "{{chi_tiet_hoc_phi}}" },
      { label: "Ngày đến hạn", token: "{{ngay_den_han}}" },
      { label: "Tổng tiền", token: "{{tong_tien}}" },
    ],
  );
});

test("upgrades a stored legacy reminder before validating or rendering it", () => {
  const parsed = feeMessageTemplateValuesSchema.parse({
    payment_reminder_template:
      "Nhắc {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{tong_tien}} {{nhac_qua_han}}",
    payment_received_template:
      "Đã nhận {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{tong_tien}}",
  });

  assert.doesNotMatch(parsed.payment_reminder_template, /nhac_qua_han/);
  assert.match(parsed.payment_reminder_template, /{{ngay_den_han}}/);
  assert.match(parsed.payment_received_template, /{{ngay_den_han}}/);
});

test("does not accept the retired overdue token in a receipt template", () => {
  assert.throws(() =>
    feeMessageTemplateValuesSchema.parse({
      ...DEFAULT_FEE_MESSAGE_TEMPLATES,
      payment_received_template:
        "Sai {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{ngay_den_han}} {{tong_tien}} {{nhac_qua_han}}",
    }),
  );
});

test("keeps unknown variables visible as editable text", () => {
  assert.deepEqual(tokenizeFeeMessageTemplate("Sai {{khong_duoc_ho_tro}}"), [
    { type: "text", value: "Sai " },
    { type: "text", value: "{{khong_duoc_ho_tro}}" },
  ]);
});

test("rejects missing, unknown and malformed Zalo variables", () => {
  assert.throws(() =>
    feeMessageTemplateValuesSchema.parse({
      ...DEFAULT_FEE_MESSAGE_TEMPLATES,
      payment_reminder_template:
        "Thiếu tổng {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}}",
    }),
  );
  assert.throws(() =>
    feeMessageTemplateValuesSchema.parse({
      ...DEFAULT_FEE_MESSAGE_TEMPLATES,
      payment_received_template:
        "Sai {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{tong_tien}} {{token_la}}",
    }),
  );
  assert.throws(() =>
    feeMessageTemplateValuesSchema.parse({
      ...DEFAULT_FEE_MESSAGE_TEMPLATES,
      payment_received_template:
        "Sai {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{tong_tien}",
    }),
  );
});

test("rejects control characters that cannot be sent as plain text", () => {
  assert.throws(() =>
    feeMessageTemplateValuesSchema.parse({
      ...DEFAULT_FEE_MESSAGE_TEMPLATES,
      payment_received_template: `${DEFAULT_FEE_MESSAGE_TEMPLATES.payment_received_template}\u0000`,
    }),
  );
});

test("rejects extra braces around otherwise valid variables", () => {
  assert.throws(() =>
    feeMessageTemplateValuesSchema.parse({
      ...DEFAULT_FEE_MESSAGE_TEMPLATES,
      payment_received_template:
        "{{{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{tong_tien}}",
    }),
  );
});

test("rejects template versions outside PostgreSQL integer range", () => {
  assert.throws(() =>
    feeMessageTemplatesResponseSchema.parse({
      ...DEFAULT_FEE_MESSAGE_TEMPLATES,
      updated_at: null,
      version: 2_147_483_648,
    }),
  );
});
