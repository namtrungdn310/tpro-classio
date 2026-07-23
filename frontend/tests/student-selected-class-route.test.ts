import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudentsHref,
  forgetRememberedStudentClass,
  getSelectedStudentClassFromSearchParams,
  normalizeSelectedStudentClassId,
  readRememberedStudentClass,
  rememberStudentClass,
  replaceSelectedStudentClassInSearchParams,
} from "../src/lib/students/selected-class-route";

test("selected student class is represented by a canonical URL", () => {
  assert.equal(buildStudentsHref("class 6C1"), "/students?class=class+6C1");
  assert.equal(buildStudentsHref(""), "/students");
  assert.equal(normalizeSelectedStudentClassId("  class-id  "), "class-id");
});

test("selected student class query preserves unrelated route state", () => {
  const initial = new URLSearchParams("view=compact&class=old-class");

  assert.equal(getSelectedStudentClassFromSearchParams(initial), "old-class");
  assert.equal(
    replaceSelectedStudentClassInSearchParams(initial, "new-class"),
    "/students?view=compact&class=new-class",
  );
  assert.equal(
    replaceSelectedStudentClassInSearchParams(initial, null),
    "/students?view=compact",
  );
});

test("remembered student class is scoped to a user and cleared at logout", () => {
  const values = new Map<string, string>();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });

  try {
    rememberStudentClass("user-a", "class-6c1");
    rememberStudentClass("user-b", "class-7c1");

    assert.equal(readRememberedStudentClass("user-a"), "class-6c1");
    assert.equal(readRememberedStudentClass("user-b"), "class-7c1");

    forgetRememberedStudentClass("user-a");

    assert.equal(readRememberedStudentClass("user-a"), "");
    assert.equal(readRememberedStudentClass("user-b"), "class-7c1");
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
