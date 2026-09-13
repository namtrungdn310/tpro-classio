import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const formSection = source("../src/components/ui/form-section.tsx");
const classDialog = source("../src/components/classes/class-form-dialog.tsx");
const staffDialog = source("../src/components/staff/staff-form-dialog.tsx");
const refundDialog = source("../src/components/fees/fee-refund-dialog.tsx");
const studentsPage = source("../src/app/(dashboard)/students/page.tsx");

test("shared form sections expose an accessible heading with a stable chapter number", () => {
  assert.match(formSection, /aria-labelledby=\{labelId\}/);
  assert.match(formSection, /<h3/);
  assert.match(formSection, /order\?: number/);
  assert.match(formSection, /aria-hidden="true"/);
  assert.match(formSection, /bg-primary-soft/);
  assert.match(formSection, /rounded-\[10px\] border border-gray-200 bg-\[\#f7f9fc\]/);
  assert.doesNotMatch(formSection, /padStart|chapterNumber|useRef|createContext|useContext/);
  assert.doesNotMatch(formSection, /h-4 w-\[3px\][^\n]*bg-primary/);
  assert.doesNotMatch(formSection, /h-px min-w-4 flex-1 bg-gray-200/);
});

test("chapter numbers are explicit and stable across every form", () => {
  assert.match(classDialog, /<FormSection label="Thông tin lớp học" order=\{1\}>/);
  assert.match(classDialog, /<FormSection label="Học phí và thời hạn" order=\{2\}>/);
  assert.match(classDialog, /<FormSection label="Lịch học trong tuần" order=\{3\}/);
  assert.match(classDialog, /<FormSection label="Phân công nhân sự theo lịch học" order=\{4\}/);
  assert.match(studentsPage, /<FormSection label="Hồ sơ học viên" order=\{1\}>/);
  assert.match(studentsPage, /<FormSection label="Thông tin liên hệ" order=\{2\}>/);
  assert.match(studentsPage, /<FormSection label="Quá trình học" order=\{3\}>/);
  assert.match(staffDialog, /<FormSection label="Hồ sơ nhân sự" order=\{1\}>/);
  assert.match(staffDialog, /<FormSection label="Thông tin liên hệ" order=\{2\}>/);
  assert.match(refundDialog, /<FormSection label="Chi tiết khoản hoàn" order=\{1\}>/);
  assert.match(refundDialog, /<FormSection label="Thông tin hoàn phí" order=\{2\}>/);
  for (const source of [classDialog, staffDialog, refundDialog, studentsPage]) {
    assert.doesNotMatch(source, /FormSectionNumberProvider|SectionNumberContext/);
  }
});

test("class form groups identity, billing, schedule, and contextual staffing by business meaning", () => {
  for (const label of [
    "Thông tin lớp học",
    "Học phí và thời hạn",
    "Lịch học trong tuần",
    "Phân công nhân sự theo lịch học",
  ]) {
    assert.match(classDialog, new RegExp(`<FormSection label="${label}"`));
  }
  assert.match(classDialog, /label="Các buổi trong tuần"/);
});

test("student form groups profile, contacts, and learning history", () => {
  for (const label of ["Hồ sơ học viên", "Thông tin liên hệ", "Quá trình học"]) {
    assert.match(studentsPage, new RegExp(`<FormSection label="${label}"`));
  }
  assert.match(studentsPage, /label="Zalo học viên"/);
  assert.match(studentsPage, /label="Zalo phụ huynh"/);
});

test("staff and refund forms use concise, non-duplicated section labels", () => {
  assert.match(staffDialog, /<FormSection label="Hồ sơ nhân sự" order=\{1\}>/);
  assert.match(staffDialog, /<FormSection label="Thông tin liên hệ" order=\{2\}>/);
  assert.match(staffDialog, /label="Zalo và số điện thoại"/);

  assert.match(refundDialog, /<FormSection label="Chi tiết khoản hoàn" order=\{1\}>/);
  assert.match(refundDialog, /<FormSection label="Thông tin hoàn phí" order=\{2\}>/);
});
