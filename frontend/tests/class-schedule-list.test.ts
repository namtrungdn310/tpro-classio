import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClassScheduleList } from "../src/components/classes/class-schedule-list";

test("class schedule list keeps sessions distinct and limits gray to day chips", () => {
  const html = renderToStaticMarkup(
    createElement(ClassScheduleList, {
      slots: [
        { day: "Thứ 4", start: "13:30", end: "15:00" },
        { day: "Thứ 2", start: "13:30", end: "15:00" },
        { day: "Thứ 6", start: "17:00", end: "18:30" },
      ],
    }),
  );

  assert.match(html, /Thứ 2/);
  assert.match(html, /Thứ 4/);
  assert.match(html, /13:30–15:00/);
  assert.match(html, /Thứ 6/);
  assert.match(html, /rounded-md bg-gray-100/);
  assert.match(html, /grid-cols-\[repeat\(4,102px\)\]/);
  assert.match(html, /text-left/);
  assert.doesNotMatch(html, /border-l/);
  assert.doesNotMatch(html, /bg-gray-200/);
  assert.match(html, /inline-field-divider/);
  assert.doesNotMatch(html, /bg-sky-200/);
  assert.equal((html.match(/data-schedule-divider="true"/g) ?? []).length, 3);
  assert.equal((html.match(/font-body-ui/g) ?? []).length, 6);
  assert.doesNotMatch(html, /absolute|translate-x|schedule-divider-offset/);
  assert.match(html, /aria-label="Lịch học: Thứ 2, 13:30 đến 15:00/);
});

test("class form schedule keeps its original centered alignment", () => {
  const html = renderToStaticMarkup(
    createElement(ClassScheduleList, {
      slots: [{ day: "Thứ 2", start: "13:30", end: "15:00" }],
      variant: "field",
    }),
  );

  assert.match(html, /text-center/);
  assert.doesNotMatch(html, /text-left/);
  assert.match(html, /grid-cols-4/);
  assert.doesNotMatch(html, /sm:grid-cols-\[repeat\(4,102px\)\]/);
  assert.equal((html.match(/data-schedule-divider="true"/g) ?? []).length, 1);
  assert.match(html, /grid-cols-\[1px_minmax\(0,1fr\)\]/);
  assert.match(html, /data-schedule-divider-variant="field"/);
  assert.match(html, /inline-field-divider/);
  assert.doesNotMatch(html, /w-\[1\.5px\]/);
  assert.doesNotMatch(html, /absolute|translate-x|schedule-divider-offset/);
});

test("class schedule list keeps four sessions visible and summarizes overflow", () => {
  const fourHtml = renderToStaticMarkup(
    createElement(ClassScheduleList, {
      maxVisibleSlots: 4,
      slots: [
        { day: "Thứ 2", start: "13:30", end: "15:00" },
        { day: "Thứ 3", start: "15:00", end: "16:30" },
        { day: "Thứ 4", start: "17:00", end: "18:30" },
        { day: "Thứ 5", start: "18:30", end: "20:00" },
      ],
    }),
  );
  assert.doesNotMatch(fourHtml, /Xem chi tiết/);
  assert.match(fourHtml, /Thứ 5/);
  assert.equal((fourHtml.match(/data-schedule-divider="true"/g) ?? []).length, 4);

  const overflowHtml = renderToStaticMarkup(
    createElement(ClassScheduleList, {
      maxVisibleSlots: 4,
      slots: [
        { day: "Thứ 2", start: "13:30", end: "15:00" },
        { day: "Thứ 3", start: "15:00", end: "16:30" },
        { day: "Thứ 4", start: "17:00", end: "18:30" },
        { day: "Thứ 5", start: "18:30", end: "20:00" },
        { day: "Thứ 6", start: "20:00", end: "21:30" },
      ],
    }),
  );
  assert.match(overflowHtml, /\+2 ca/);
  assert.match(overflowHtml, /Còn lại/);
  assert.equal((overflowHtml.match(/data-schedule-divider="true"/g) ?? []).length, 4);
});
