import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getContactSuggestionQuery,
  handleContactSuggestionTab,
  lookupLocalContactSuggestion,
} from "../src/lib/forms/use-contact-pair-suggestion";

const studentPageSource = readFileSync(
  fileURLToPath(new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url)),
  "utf8",
);
const staffFormSource = readFileSync(
  fileURLToPath(
    new URL("../src/components/staff/staff-form-dialog.tsx", import.meta.url),
  ),
  "utf8",
);
const contactApiSource = readFileSync(
  fileURLToPath(
    new URL("../src/lib/api/contact-suggestions.ts", import.meta.url),
  ),
  "utf8",
);

test("uses a complete Vietnamese phone to suggest the missing Zalo name", () => {
  assert.deepEqual(getContactSuggestionQuery("", "0912 345 678"), {
    target: "zalo",
    phone: "0912345678",
  });
  assert.deepEqual(getContactSuggestionQuery("", "+84 912 345 678"), {
    target: "zalo",
    phone: "0912345678",
  });
});

test("uses a Zalo name to suggest the missing phone", () => {
  assert.deepEqual(getContactSuggestionQuery("  Mẹ An  ", ""), {
    target: "phone",
    zaloName: "Mẹ An",
  });
});

test("does not query while a phone is incomplete or both fields have values", () => {
  assert.equal(getContactSuggestionQuery("", "09123"), null);
  assert.equal(getContactSuggestionQuery("Mẹ An", "0912345678"), null);
  assert.equal(getContactSuggestionQuery("", ""), null);
});

test("renders an inline accessible suggestion accepted with Tab for both contact groups", () => {
  assert.match(studentPageSource, /aria-autocomplete=.*"inline"/);
  assert.match(studentPageSource, /aria-keyshortcuts=.*"Tab"/);
  assert.match(studentPageSource, /handleContactSuggestionTab/);
  assert.match(studentPageSource, /data-contact-part="zalo"/);
  assert.match(studentPageSource, /data-contact-part="phone"/);
  assert.match(studentPageSource, /owner: "student"/);
  assert.match(studentPageSource, /owner: "parent"/);
  assert.match(studentPageSource, /Nhấn Tab để điền nhanh/);
});

test("local contact suggestions are instant, owner-scoped and unambiguous", () => {
  const visibleSources = [
    {
      owner: "parent" as const,
      phone: "0912 345 678",
      zaloName: "Mẹ An",
    },
  ];

  assert.deepEqual(
    lookupLocalContactSuggestion(visibleSources, "parent", {
      target: "phone",
      zaloName: "mẹ an",
    }),
    { target: "phone", value: "0912 345 678" },
  );

  assert.deepEqual(
    lookupLocalContactSuggestion(visibleSources, "parent", {
      target: "zalo",
      phone: "0912345678",
    }),
    { target: "zalo", value: "Mẹ An" },
  );

  assert.equal(
    lookupLocalContactSuggestion(
      [
        {
          owner: "student",
          phone: "0912 345 678",
          zaloName: "Mẹ An",
        },
      ],
      "parent",
      { target: "phone", zaloName: "Mẹ An" },
    ),
    null,
  );
  assert.match(
    studentPageSource,
    /!isStudentFieldHidden\(student, "student_contact"\)/,
  );
  assert.match(
    studentPageSource,
    /!isStudentFieldHidden\(student, "parent_contact"\)/,
  );
  assert.match(
    studentPageSource,
    /student\.status !== "active" \|\| student\.active_enrollments\.length === 0/,
  );

  assert.equal(
    lookupLocalContactSuggestion(
      [
        ...visibleSources,
        {
          owner: "parent",
          phone: "0987 654 321",
          zaloName: "Mẹ An",
        },
      ],
      "parent",
      { target: "phone", zaloName: "Mẹ An" },
    ),
    null,
  );
});

test("staff contact fields use the same accessible Tab suggestion flow", () => {
  assert.match(staffFormSource, /owner: "staff"/);
  assert.match(staffFormSource, /aria-autocomplete=/);
  assert.match(staffFormSource, /aria-keyshortcuts=/);
  assert.doesNotMatch(staffFormSource, /Nhấn Tab để điền nhanh/);
  assert.doesNotMatch(staffFormSource, /contactSuggestionId/);
  assert.match(staffFormSource, /handleContactSuggestionTab/);
  assert.match(staffFormSource, /data-contact-part="zalo"/);
  assert.match(staffFormSource, /data-contact-part="phone"/);
});

test("one Tab accepts a suggestion from either half and focuses the filled field", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        requestAnimationFrame(callback: FrameRequestCallback) {
          callback(0);
          return 1;
        },
      },
    });

    for (const suggestion of [
      { target: "phone" as const, value: "0912345678" },
      { target: "zalo" as const, value: "Mẹ An" },
    ]) {
      let accepted = 0;
      let prevented = 0;
      let focused = 0;
      let selection: [number, number] | null = null;
      const targetInput = {
        disabled: false,
        value: "",
        focus() {
          focused += 1;
        },
        setSelectionRange(start: number, end: number) {
          selection = [start, end];
        },
      };
      const event = {
        key: "Tab",
        shiftKey: false,
        preventDefault() {
          prevented += 1;
        },
        currentTarget: {
          querySelector(selector: string) {
            assert.equal(
              selector,
              `input[data-contact-part="${suggestion.target}"]`,
            );
            return targetInput;
          },
        },
      };

      const handled = handleContactSuggestionTab(
        event as never,
        suggestion,
        () => {
          accepted += 1;
          targetInput.value = suggestion.value;
        },
      );

      assert.equal(handled, true);
      assert.equal(accepted, 1);
      assert.equal(prevented, 1);
      assert.equal(focused, 1);
      assert.deepEqual(selection, [
        suggestion.value.length,
        suggestion.value.length,
      ]);
    }
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("contact lookups keep personal data out of URL query strings", () => {
  assert.match(
    contactApiSource,
    /apiClient\.post<unknown>\("\/contact-suggestions\/lookup",/,
  );
  assert.doesNotMatch(contactApiSource, /params:/);
  assert.doesNotMatch(contactApiSource, /apiClient\.get/);
});

test("a remote suggestion cannot survive a refreshed or deleted local source set", () => {
  const hookSource = readFileSync(
    fileURLToPath(
      new URL(
        "../src/lib/forms/use-contact-pair-suggestion.ts",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  assert.match(hookSource, /sources: localSources/);
  assert.match(hookSource, /remoteState\.sources === localSources/);
});
