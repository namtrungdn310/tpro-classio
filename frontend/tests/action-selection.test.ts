import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_CONTINUATION_DISTANCE_PX,
  ACTION_CONTINUATION_WINDOW_MS,
  isActionContinuation,
  type PointerGestureSnapshot,
} from "../src/lib/ui/action-selection";

const anchor: PointerGestureSnapshot = {
  at: 1_000,
  pointerType: "mouse",
  x: 240,
  y: 180,
};

test("recognizes a rapid follow-up gesture even when a portal replaced the target", () => {
  assert.equal(
    isActionContinuation(anchor, {
      ...anchor,
      at: anchor.at + ACTION_CONTINUATION_WINDOW_MS - 1,
      x: anchor.x + ACTION_CONTINUATION_DISTANCE_PX,
    }),
    true,
  );
});

test("does not suppress a deliberate later interaction", () => {
  assert.equal(
    isActionContinuation(anchor, {
      ...anchor,
      at: anchor.at + ACTION_CONTINUATION_WINDOW_MS + 1,
    }),
    false,
  );
});

test("does not suppress an interaction outside the click-through area", () => {
  assert.equal(
    isActionContinuation(anchor, {
      ...anchor,
      at: anchor.at + 100,
      x: anchor.x + ACTION_CONTINUATION_DISTANCE_PX + 1,
    }),
    false,
  );
});

test("does not mix mouse and touch gesture sequences", () => {
  assert.equal(
    isActionContinuation(anchor, {
      ...anchor,
      at: anchor.at + 100,
      pointerType: "touch",
    }),
    false,
  );
});
