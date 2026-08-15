import assert from "node:assert/strict";
import test from "node:test";
import {
  canRevealSlidePanel,
  getSlideBackdropStyle,
  getSlidePanelDuration,
  getSlidePanelStyle,
  getSlidePanelUnmountDelay,
  SLIDE_PANEL_EASING,
} from "../src/lib/ui/slide-panel-motion";
import { readFileSync } from "node:fs";

test("slide panels travel at a shared bounded speed based on their actual width", () => {
  assert.equal(getSlidePanelDuration(0), 290);
  assert.equal(getSlidePanelDuration(340), 290);
  assert.equal(getSlidePanelDuration(960), 409);
  assert.equal(getSlidePanelDuration(2_000), 480);
  assert.ok(getSlidePanelDuration(960) > getSlidePanelDuration(340));
});

test("slide panel and backdrop share one coordinated duration", () => {
  assert.deepEqual(getSlidePanelStyle(447), {
    transitionDuration: "447ms",
    transitionTimingFunction: SLIDE_PANEL_EASING,
  });
  assert.deepEqual(getSlideBackdropStyle(447), {
    transitionDuration: "447ms",
    transitionTimingFunction: "ease-out",
  });
});

test("a newly mounted slide waits for measurement before its first reveal", () => {
  assert.equal(
    canRevealSlidePanel({ isOpen: true, isRendered: true, isReady: false }),
    false,
  );
  assert.equal(
    canRevealSlidePanel({ isOpen: true, isRendered: true, isReady: true }),
    true,
  );
  assert.equal(
    canRevealSlidePanel({ isOpen: false, isRendered: true, isReady: true }),
    false,
  );
});

test("reduced motion unmounts immediately while regular motion waits for exit", () => {
  assert.equal(getSlidePanelUnmountDelay(447, false), 447);
  assert.equal(getSlidePanelUnmountDelay(447, true), 0);
});

test("date picker closes after a complete backdrop gesture even above its trigger", () => {
  const source = readFileSync(
    new URL("../src/components/layout/date-picker-slide.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /backdropPointerDownRef/);
  assert.match(source, /backdropPointerDownRef\.current = event\.target === event\.currentTarget/);
  assert.doesNotMatch(source, /!event\.defaultPrevented/);
  assert.match(source, /onPointerCancel=\{\(\) => \{/);
  assert.doesNotMatch(source, /onClick=\{onClose\}[\s\S]{0,80}\/\>\s*\{\/\* Panel/);
});
