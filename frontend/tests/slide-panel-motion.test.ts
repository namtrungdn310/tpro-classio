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

test("slide panels travel at a shared bounded speed based on their actual width", () => {
  assert.equal(getSlidePanelDuration(0), 320);
  assert.equal(getSlidePanelDuration(340), 320);
  assert.equal(getSlidePanelDuration(960), 447);
  assert.equal(getSlidePanelDuration(2_000), 520);
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
