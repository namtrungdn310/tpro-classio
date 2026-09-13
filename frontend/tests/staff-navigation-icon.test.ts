import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tabNavSource = readFileSync(
  new URL("../src/components/layout/tab-nav.tsx", import.meta.url),
  "utf8",
);
const navigationIconsSource = readFileSync(
  new URL("../src/components/layout/navigation-icons.tsx", import.meta.url),
  "utf8",
);

test("staff navigation uses an employee identity icon distinct from students", () => {
  assert.match(
    navigationIconsSource,
    /href:\s*"\/staff",[\s\S]*?label:\s*"Nhân sự",[\s\S]*?icon:\s*RiIdCardLine,[\s\S]*?opticalSize:\s*19/,
  );
  assert.match(
    navigationIconsSource,
    /href:\s*"\/students",\s*label:\s*"Học viên",\s*icon:\s*RiTeamLine/,
  );
  assert.doesNotMatch(navigationIconsSource, /icon:\s*UserRoundCog/);
});

test("all sidebar icons use one shared Remix Icon renderer", () => {
  assert.match(
    tabNavSource,
    /<NavigationIcon icon=\{Icon\} opticalSize=\{tab\.opticalSize\} \/>/,
  );
  assert.doesNotMatch(tabNavSource, /<Icon className=/);
  assert.match(navigationIconsSource, /opticalSize = 18/);
  assert.match(navigationIconsSource, /size=\{opticalSize\}/);
  assert.match(navigationIconsSource, /from "react-icons"/);
  assert.match(navigationIconsSource, /className=\{`icon-system shrink-0/);
});
