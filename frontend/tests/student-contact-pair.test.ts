import assert from "node:assert/strict";
import test from "node:test";
import {
  getCompleteContactPair,
  getContactPairError,
} from "../src/lib/forms/contact-pair";

test("student contact requires phone when a Zalo name is present", () => {
  assert.deepEqual(getContactPairError("Hà My", "", "học viên"), {
    missingField: "phone",
    message: "Vui lòng nhập số điện thoại học viên.",
  });
});

test("parent contact requires a Zalo name when a phone is present", () => {
  assert.deepEqual(getContactPairError("", "0912345678", "phụ huynh"), {
    missingField: "zalo",
    message: "Vui lòng nhập tên Zalo phụ huynh.",
  });
});

test("student contact is displayable only when both values are present", () => {
  assert.equal(getCompleteContactPair("Hà My", null), null);
  assert.equal(getCompleteContactPair(null, "0912345678"), null);
  assert.deepEqual(getCompleteContactPair(" Hà My ", " 0912345678 "), {
    zalo: "Hà My",
    phone: "0912345678",
  });
});
