import assert from "node:assert/strict";
import test from "node:test";
import { abbreviateClassName, getClassGroupInfo } from "../src/lib/utils/class-groups";

test("recognizes school grades from compact and curriculum class names", () => {
  const cases = [
    ["1A1", "grade-1"],
    ["6C1", "grade-6"],
    ["L12", "grade-12"],
    ["Kèm 9", "grade-9"],
    ["Global Success 6", "grade-6"],
    ["Tiếng Anh 8 nâng cao", "grade-8"],
    ["i-Learn Smart World 7", "grade-7"],
    ["Friends Plus 11", "grade-11"],
    ["Global Success nâng cao lớp 6", "grade-6"],
    ["Tiếng Anh nâng cao lớp 8", "grade-8"],
  ] as const;

  for (const [className, expectedGroup] of cases) {
    assert.equal(getClassGroupInfo(className).key, expectedGroup, className);
  }
});

test("prioritizes IELTS over numeric grade-like text", () => {
  for (const className of ["IELTS 7.0", "IELTS 10", "IELTS Foundation", "Pre-IELTS 5.0"]) {
    assert.equal(getClassGroupInfo(className).key, "ielts", className);
  }
});

test("recognizes the center's exam preparation programs", () => {
  const cases = [
    ["Ôn thi vào lớp 10", "entrance-10"],
    ["Luyện thi tuyển sinh 10 môn Tiếng Anh", "entrance-10"],
    ["Chuyên Anh Lê Quý Đôn lớp 9", "specialized"],
    ["Thi chuyên LQĐ", "specialized"],
    ["Học sinh giỏi thành phố lớp 9", "gifted-local"],
    ["Đội tuyển HSG quốc gia lớp 12", "gifted-national"],
    ["Đội tuyển Tiếng Anh HSG quốc gia 12", "gifted-national"],
    ["Ôn thi Đại học lớp 12", "graduation"],
    ["Ôn thi tốt nghiệp THPT 12", "graduation"],
  ] as const;

  for (const [className, expectedGroup] of cases) {
    assert.equal(getClassGroupInfo(className).key, expectedGroup, className);
  }
});

test("creates compact schedule labels without losing access to the full model name", () => {
  const cases = [
    ["IELTS Chuyên sâu", "IELTS CS"],
    ["IELTS Tổng hợp", "IELTS TH"],
    ["IELTS Foundation", "IELTS FDN"],
    ["IELTS Intensive Writing", "IELTS INT W"],
    ["Học sinh giỏi thành phố lớp 9", "HSG TP 9"],
    ["Đội tuyển HSG quốc gia lớp 12", "HSG QG 12"],
    ["Chuyên Anh Lê Quý Đôn lớp 9", "Chuyên LQĐ 9"],
    ["Ôn thi vào lớp 10", "Ôn thi 10"],
    ["Ôn thi Đại học lớp 12", "Ôn thi ĐH 12"],
    ["Tiếng Anh 8 nâng cao", "TA8 NC"],
    ["Global Success 6", "Global6"],
    ["Global Success nâng cao lớp 6", "Global6 NC"],
    ["Tiếng Anh nâng cao lớp 8", "TA8 NC"],
    ["Đội tuyển Tiếng Anh HSG quốc gia 12", "HSG QG 12"],
  ] as const;

  for (const [className, expectedShortName] of cases) {
    assert.equal(abbreviateClassName(className), expectedShortName, className);
    assert.ok(abbreviateClassName(className).length <= 14, className);
  }
});

test("uses a stable fallback color for future custom names", () => {
  const first = getClassGroupInfo("Nhóm Cô Hạnh buổi tối");
  const second = getClassGroupInfo("Nhóm Cô Hạnh buổi tối");

  assert.deepEqual(first.color, second.color);
  assert.equal(first.key, second.key);
});
