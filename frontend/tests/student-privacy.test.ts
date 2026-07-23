import assert from "node:assert/strict";
import test from "node:test";

import {
  getStudentExportValue,
  getStudentVisibleValue,
  isStudentFieldHidden,
} from "../src/lib/students/privacy";

const student = {
  hidden_fields: ["school", "parent_contact"],
} as const;

test("student privacy hides only selected list values", () => {
  assert.equal(isStudentFieldHidden(student, "school"), true);
  assert.equal(isStudentFieldHidden(student, "notes"), false);
  assert.equal(getStudentVisibleValue(student, "school", "THCS Trưng Vương"), null);
  assert.equal(getStudentVisibleValue(student, "notes", "Cần hỗ trợ"), "Cần hỗ trợ");
});

test("student privacy exports hidden values as empty cells", () => {
  assert.equal(getStudentExportValue(student, "parent_contact", "0912345678"), "");
  assert.equal(getStudentExportValue(student, "student_contact", "0987654321"), "0987654321");
});
