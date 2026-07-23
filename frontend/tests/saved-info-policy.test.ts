import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import test from "node:test";
import {
  noSavedInfoFormProps,
  savedInfoAutocomplete,
} from "../src/lib/forms/saved-info-policy";

const sourceRoot = new URL("../src/", import.meta.url);

function getTsxFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return getTsxFiles(entryUrl);
    return extname(entry.name) === ".tsx" ? [entryUrl] : [];
  });
}

const sourceFiles = getTsxFiles(sourceRoot).map((url) => ({
  name: relative(new URL("..", sourceRoot).pathname, url.pathname).replaceAll("\\", "/"),
  source: readFileSync(url, "utf8"),
}));

function getOpeningTags(source: string, tagName: string) {
  return source.match(new RegExp(`<${tagName}\\b[\\s\\S]*?\\/>`, "g")) ?? [];
}

test("saved info policy exposes only the approved browser autocomplete tokens", () => {
  assert.deepEqual(savedInfoAutocomplete, {
    disabled: "off",
    loginIdentifier: "username",
    loginPassword: "current-password",
    otpEmail: "email",
    oneTimeCode: "one-time-code",
  });
  assert.deepEqual(noSavedInfoFormProps, { autoComplete: "off" });
});

test("every editable native control explicitly declares its autofill policy", () => {
  for (const file of sourceFiles) {
    for (const tag of getOpeningTags(file.source, "input")) {
      if (/type="(?:hidden|radio)"/.test(tag)) continue;
      assert.match(tag, /autoComplete=/, `${file.name} has an input without an autofill policy`);
    }

    for (const tag of getOpeningTags(file.source, "textarea")) {
      assert.match(tag, /autoComplete=/, `${file.name} has a textarea without an autofill policy`);
    }
  }
});

test("saved credentials and email autofill stay limited to the approved auth entry points", () => {
  const login = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
  const register = readFileSync(new URL("../src/app/register/page.tsx", import.meta.url), "utf8");
  const reset = readFileSync(
    new URL("../src/app/reset-password/page.tsx", import.meta.url),
    "utf8",
  );
  const otp = readFileSync(new URL("../src/app/otp/page.tsx", import.meta.url), "utf8");

  assert.match(login, /savedInfoAutocomplete\.loginIdentifier/);
  assert.match(login, /savedInfoAutocomplete\.loginPassword/);
  assert.match(register, /savedInfoAutocomplete\.otpEmail/);
  assert.match(reset, /savedInfoAutocomplete\.otpEmail/);
  assert.match(otp, /<OtpInput/);

  const loginIdentifierUsers = sourceFiles.filter((file) =>
    file.source.includes("savedInfoAutocomplete.loginIdentifier"),
  );
  const loginPasswordUsers = sourceFiles.filter((file) =>
    file.source.includes("savedInfoAutocomplete.loginPassword"),
  );
  const otpEmailUsers = sourceFiles
    .filter((file) => file.source.includes("savedInfoAutocomplete.otpEmail"))
    .map((file) => file.name)
    .sort();

  assert.equal(loginIdentifierUsers.length, 1);
  assert.ok(loginIdentifierUsers[0].name.endsWith("src/app/login/page.tsx"));
  assert.equal(loginPasswordUsers.length, 1);
  assert.ok(loginPasswordUsers[0].name.endsWith("src/app/login/page.tsx"));
  assert.deepEqual(
    otpEmailUsers.map((name) => name.replace(/^.*src\//, "src/")),
    ["src/app/register/page.tsx", "src/app/reset-password/page.tsx"],
  );

  const nonPolicySources = sourceFiles
    .filter((file) => !file.name.endsWith("lib/forms/saved-info-policy.tsx"))
    .map((file) => file.source)
    .join("\n");
  assert.doesNotMatch(nonPolicySources, /autoComplete="(?:email|username|current-password)"/);
});

test("management forms disable saved info at form level as well as field level", () => {
  const expectedFormPolicyCount = new Map([
    ["src/app/(dashboard)/students/page.tsx", 1],
    ["src/components/classes/class-form-dialog.tsx", 1],
    ["src/components/settings/account-settings-section.tsx", 1],
    ["src/components/settings/security-settings-section.tsx", 2],
    ["src/components/staff/staff-form-dialog.tsx", 1],
  ]);

  for (const [name, count] of expectedFormPolicyCount) {
    const file = sourceFiles.find((candidate) => candidate.name.endsWith(name));
    assert.ok(file, `Missing ${name}`);
    assert.equal(
      (file.source.match(/\.\.\.noSavedInfoFormProps/g) ?? []).length,
      count,
      `${name} must disable saved info on every management form`,
    );
  }
});

test("OTP and new-password controls keep purpose-specific tokens without saved personal info", () => {
  const otpInput = readFileSync(
    new URL("../src/components/ui/otp-input.tsx", import.meta.url),
    "utf8",
  );
  const passwordInput = readFileSync(
    new URL("../src/components/ui/password-input.tsx", import.meta.url),
    "utf8",
  );
  assert.match(otpInput, /savedInfoAutocomplete\.oneTimeCode/);
  assert.match(passwordInput, /autoComplete = savedInfoAutocomplete\.disabled/);
});
