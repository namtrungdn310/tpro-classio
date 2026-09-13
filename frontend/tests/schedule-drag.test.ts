import assert from "node:assert/strict";
import test from "node:test";
import {
  applyScheduleCellClick,
  applyScheduleDragPreview,
  buildScheduleGridGeometry,
  createScheduleDragPreview,
  getScheduleDragInterval,
  getScheduleDragIntervalBlocks,
  MAX_SCHEDULE_SESSION_BOUNDARY,
  resolveScheduleBoundary,
  SCHEDULE_BLOCK_COUNT,
  SCHEDULE_BOUNDARY_COUNT,
  scheduleBoundaryToMinutes,
  updateScheduleDragSession,
  type ScheduleDragInterval,
  type ScheduleDragSession,
  type ScheduleGridGeometry,
} from "../src/lib/classes/schedule-drag";

const makeSession = (
  overrides: Partial<ScheduleDragSession> = {},
): ScheduleDragSession => ({
  pointerId: 1,
  mode: "painting",
  dayIndex: 0,
  anchorBoundary: 0,
  currentBoundary: 0,
  baseBlocks: new Set<string>(),
  ...overrides,
});

const blockKey = (dayIndex: number, blockIndex: number) => `${dayIndex}:${blockIndex}`;

const clickCell = (
  base: string[],
  blockIndex: number,
  pendingAnchor: { dayIndex: number; blockIndex: number } | null = null,
  isBlocked: (dayIndex: number, blockIndex: number) => boolean = () => false,
) =>
  applyScheduleCellClick({
    baseBlocks: new Set(base),
    pendingAnchor,
    dayIndex: 0,
    blockIndex,
    getBlockKey: blockKey,
    isBlocked,
  });

const blocksFor = (
  base: string[],
  session: ScheduleDragSession,
  isBlocked: (blockIndex: number) => boolean = () => false,
) => {
  const preview = createScheduleDragPreview(session);
  return [...applyScheduleDragPreview(new Set(base), preview, blockKey, isBlocked)]
    .map((key) => Number(key.split(":")[1]))
    .sort((left, right) => left - right)
    .map((blockIndex) => blockKey(0, blockIndex));
};

const makeGeometry = (
  rowTops: number[],
  rowBottom: number,
  gridTop = rowTops[0],
  gridBottom = rowBottom,
) => {
  if (rowTops.length < 2) throw new Error("Need at least 2 row tops");
  const rows = rowTops.map((top, i) => ({
    top,
    bottom: i < rowTops.length - 1 ? rowTops[i + 1] : rowBottom,
  }));
  return buildScheduleGridGeometry(
    { top: gridTop, bottom: gridBottom, left: 0 },
    rows,
    [{ left: 0, right: 100 }],
    1,
  );
};

const geo30 = (rowHeight: number, startY = 100) => {
  const tops = Array.from({ length: SCHEDULE_BLOCK_COUNT }, (_, i) => startY + i * rowHeight);
  const bottom = startY + SCHEDULE_BLOCK_COUNT * rowHeight;
  return makeGeometry(tops, bottom, startY, bottom)!;
};

test("boundary minutes cover the full 07:00-22:00 range in 30-minute steps", () => {
  assert.equal(scheduleBoundaryToMinutes(0), 7 * 60);
  assert.equal(scheduleBoundaryToMinutes(6), 10 * 60);
  assert.equal(scheduleBoundaryToMinutes(30), 22 * 60);
  assert.equal(scheduleBoundaryToMinutes(30) - scheduleBoundaryToMinutes(0), 30 * 30);
});

test("two adjacent clicks create the 60-minute minimum without committing a 30-minute orphan", () => {
  const first = clickCell([], 6);
  assert.equal(first.reason, "pending");
  assert.deepEqual([...first.blocks], []);
  assert.deepEqual(first.pendingAnchor, { dayIndex: 0, blockIndex: 6 });

  const second = clickCell(
    [],
    7,
    first.pendingAnchor,
  );
  assert.equal(second.reason, "created");
  assert.deepEqual([...second.blocks].sort(), ["0:6", "0:7"]);
  assert.equal(second.pendingAnchor, null);
});

test("click anchor can move or be cancelled before a valid session exists", () => {
  const first = clickCell([], 6);
  const moved = clickCell([], 10, first.pendingAnchor);
  assert.equal(moved.reason, "pending-moved");
  assert.deepEqual(moved.pendingAnchor, { dayIndex: 0, blockIndex: 10 });
  const cancelled = clickCell([], 10, moved.pendingAnchor);
  assert.equal(cancelled.reason, "pending-cancelled");
  assert.equal(cancelled.pendingAnchor, null);
  assert.deepEqual([...cancelled.blocks], []);
});

test("clicking outside a session extends one block at either visible edge", () => {
  const after = clickCell(["0:6", "0:7"], 9);
  assert.equal(after.reason, "extended");
  assert.deepEqual([...after.blocks].sort(), ["0:6", "0:7", "0:8"]);

  const before = clickCell(["0:6", "0:7"], 5);
  assert.equal(before.reason, "extended");
  assert.deepEqual([...before.blocks].sort(), ["0:5", "0:6", "0:7"]);
});

test("the visible endpoint shrinks a long session but never below 60 minutes", () => {
  const shrinkStart = clickCell(["0:6", "0:7", "0:8"], 6);
  assert.equal(shrinkStart.reason, "shrunk");
  assert.deepEqual([...shrinkStart.blocks].sort(), ["0:7", "0:8"]);

  const shrinkEnd = clickCell(["0:6", "0:7", "0:8"], 9);
  assert.equal(shrinkEnd.reason, "shrunk");
  assert.deepEqual([...shrinkEnd.blocks].sort(), ["0:6", "0:7"]);

  const minimum = clickCell(["0:6", "0:7"], 8);
  assert.equal(minimum.reason, "minimum-duration");
  assert.deepEqual([...minimum.blocks].sort(), ["0:6", "0:7"]);

  const penultimateVisualCell = clickCell(["0:6", "0:7", "0:8"], 8);
  assert.equal(penultimateVisualCell.reason, "interior-cell");
  assert.deepEqual([...penultimateVisualCell.blocks].sort(), ["0:6", "0:7", "0:8"]);

  const terminalEndpoint = clickCell(["0:26", "0:27", "0:28"], 29);
  assert.equal(terminalEndpoint.reason, "shrunk");
  assert.deepEqual([...terminalEndpoint.blocks].sort(), ["0:26", "0:27"]);
});

test("interior, bridge, blocked and terminal clicks cannot corrupt sessions", () => {
  const interior = clickCell(["0:6", "0:7", "0:8"], 7);
  assert.equal(interior.reason, "interior-cell");

  const bridge = clickCell(["0:6", "0:8"], 7);
  assert.equal(bridge.reason, "bridge-rejected");
  assert.deepEqual([...bridge.blocks].sort(), ["0:6", "0:8"]);

  const blocked = clickCell([], 6, null, (_, blockIndex) => blockIndex === 6);
  assert.equal(blocked.reason, "blocked");
  assert.equal(blocked.pendingAnchor, null);

  const terminal = clickCell([], MAX_SCHEDULE_SESSION_BOUNDARY);
  assert.equal(terminal.reason, "outside-range");
});

test("binary search resolver activates at leading edge and clamps outside the grid symmetrically", () => {
  const geometry: ScheduleGridGeometry = {
    gridTop: 20,
    gridBottom: 80.3,
    gridLeft: 0,
    gridWidth: 100,
    boundaryY: [20, 39.6, 60.15, 80.3],
    dayLeft: [0],
    dayWidth: [100],
    version: 1,
  };

  assert.equal(resolveScheduleBoundary(10, geometry), 0, "above grid → clamp 0");
  assert.equal(resolveScheduleBoundary(19.999, geometry), 0);
  assert.equal(resolveScheduleBoundary(20, geometry), 0, "leading edge inclusive: top activates row 0");
  assert.equal(resolveScheduleBoundary(29.8, geometry), 0);
  assert.equal(resolveScheduleBoundary(39.599, geometry), 0);
  assert.equal(
    resolveScheduleBoundary(39.6, geometry),
    1,
    "the exact rendered leading edge activates boundary 1",
  );
  assert.equal(resolveScheduleBoundary(39.61, geometry), 1);
  assert.equal(resolveScheduleBoundary(60.14, geometry), 1);
  assert.equal(
    resolveScheduleBoundary(60.15, geometry),
    2,
    "fractional boundaries do not require crossing the cell",
  );
  assert.equal(
    resolveScheduleBoundary(80.3, geometry),
    3,
    "the trailing edge of the final row resolves to the terminal boundary",
  );
  assert.equal(resolveScheduleBoundary(120, geometry), 3, "below grid → clamp to terminal boundary");
});

test("every row resolves all ten pointer positions correctly across the full grid", () => {
  const rowHeight = 30;
  const geometry = geo30(rowHeight);

  for (let row = 0; row < SCHEDULE_BLOCK_COUNT; row += 1) {
    const top = 100 + row * rowHeight;
    assert.equal(resolveScheduleBoundary(top - 0.5, geometry), row === 0 ? 0 : row - 1);
    assert.equal(resolveScheduleBoundary(top, geometry), row,       "top");
    assert.equal(resolveScheduleBoundary(top + 0.5, geometry), row,  "top + 0.5");
    assert.equal(resolveScheduleBoundary(top + 1, geometry), row,    "top + 1");
    assert.equal(resolveScheduleBoundary(top + rowHeight * 0.25, geometry), row, "25%");
    assert.equal(resolveScheduleBoundary(top + rowHeight / 2, geometry), row, "midpoint");
    assert.equal(resolveScheduleBoundary(top + rowHeight * 0.75, geometry), row, "75%");
    assert.equal(resolveScheduleBoundary(top + rowHeight - 1, geometry), row,   "bottom - 1");
    assert.equal(resolveScheduleBoundary(top + rowHeight - 0.5, geometry), row, "bottom - 0.5");
    assert.equal(
      resolveScheduleBoundary(top + rowHeight, geometry),
      row === SCHEDULE_BLOCK_COUNT - 1 ? SCHEDULE_BLOCK_COUNT : row + 1,
      "bottom",
    );
  }
});

test("the canonical geometry builder normalises alternating sub-pixel gaps and overlaps", () => {
  const tops = Array.from(
    { length: SCHEDULE_BLOCK_COUNT },
    (_, index) => 100.15 + index * 29.7,
  );
  const bottom = tops.at(-1)! + 29.7;
  const rows = tops.map((top, i) => ({
    top,
    bottom:
      i < tops.length - 1
        ? tops[i + 1] + (i % 2 === 0 ? -0.4 : 0.4)
        : bottom,
  }));
  const geometry = buildScheduleGridGeometry(
    { top: 100, bottom, left: 0 },
    rows,
    [{ left: 0, right: 100 }],
    1,
  );
  assert.ok(geometry, "geometry builds with overlaps");
  assert.equal(geometry!.boundaryY.length, SCHEDULE_BOUNDARY_COUNT);
  for (let i = 1; i < geometry!.boundaryY.length; i += 1) {
    const expectedBoundary =
      i === SCHEDULE_BLOCK_COUNT
        ? bottom
        : (rows[i - 1].bottom + rows[i].top) / 2;
    assert.equal(geometry!.boundaryY[i], expectedBoundary);
    assert.ok(
      geometry!.boundaryY[i] > geometry!.boundaryY[i - 1],
      `monotonic at index ${i}`,
    );
    assert.equal(resolveScheduleBoundary(expectedBoundary - 0.001, geometry!), i - 1);
    assert.equal(resolveScheduleBoundary(expectedBoundary, geometry!), i);
  }
});

test("the geometry builder rejects incomplete, collapsed, or non-finite measurements", () => {
  const validRows = Array.from({ length: SCHEDULE_BLOCK_COUNT }, (_, index) => ({
    top: 100 + index * 30,
    bottom: 130 + index * 30,
  }));
  const validDays = [{ left: 80, right: 180 }];

  assert.equal(
    buildScheduleGridGeometry(
      { top: 100, bottom: 1000, left: 0, right: 780 },
      validRows.slice(1),
      validDays,
      1,
    ),
    null,
  );
  assert.equal(
    buildScheduleGridGeometry(
      { top: 100, bottom: 100, left: 0, right: 780 },
      validRows,
      validDays,
      1,
    ),
    null,
  );
  assert.equal(
    buildScheduleGridGeometry(
      { top: 100, bottom: 1000, left: 0, right: 780 },
      validRows.map((row, index) =>
        index === 5 ? { top: Number.NaN, bottom: row.bottom } : row,
      ),
      validDays,
      1,
    ),
    null,
  );
});

test("a click stays inactive, but dragging to an adjacent row activates the minimum one-block interval", () => {
  const session = makeSession({ anchorBoundary: 6, currentBoundary: 6 });
  assert.equal(createScheduleDragPreview(session), null, "click without movement → null");

  const oneBlock = updateScheduleDragSession(session, 7);
  assert.deepEqual(
    createScheduleDragPreview(oneBlock)?.interval,
    { startBoundary: 6, endBoundary: 7 },
    "one block drag → accepted",
  );
  assert.deepEqual(blocksFor([], oneBlock), ["0:6"]);
});

test("returning to the anchor after moving cancels the gesture preview", () => {
  let session = makeSession({ anchorBoundary: 6, currentBoundary: 6 });
  session = updateScheduleDragSession(session, 10);
  session = updateScheduleDragSession(session, 6);

  assert.equal(createScheduleDragPreview(session), null);
  assert.deepEqual(
    getScheduleDragInterval(6, 6),
    null,
    "the interval is null at the anchor after movement",
  );
  assert.deepEqual(blocksFor(["0:6", "0:7"], session), ["0:6", "0:7"], "committed blocks stay untouched");
});

test("a drag that starts from the visual endpoint changes mode with its direction", () => {
  const baseBlocks = new Set(["0:6", "0:7", "0:8", "0:9"]);
  let session = makeSession({
    mode: "erasing",
    startedFromEndpoint: true,
    anchorBoundary: 10,
    currentBoundary: 10,
    baseBlocks,
  });

  session = updateScheduleDragSession(session, 11);
  assert.equal(session.mode, "painting", "dragging below the endpoint extends");
  assert.deepEqual(createScheduleDragPreview(session)?.interval, {
    startBoundary: 10,
    endBoundary: 11,
  });
  assert.deepEqual(blocksFor([...baseBlocks], session), [
    "0:6",
    "0:7",
    "0:8",
    "0:9",
    "0:10",
  ]);

  session = updateScheduleDragSession(session, 9);
  assert.equal(session.mode, "erasing", "dragging above the endpoint shortens");
  assert.deepEqual(blocksFor([...baseBlocks], session), ["0:6", "0:7", "0:8"]);
});

test("touching the 12:00 boundary while dragging from 10:00 previews 10:00-12:00 immediately", () => {
  const session = makeSession({ anchorBoundary: 6, currentBoundary: 10 });
  assert.deepEqual(
    createScheduleDragPreview(session)?.interval,
    { startBoundary: 6, endBoundary: 10 },
  );
  assert.deepEqual(blocksFor([], session), ["0:6", "0:7", "0:8", "0:9"]);
});

test("dragging upward normalizes to the smaller and larger boundary", () => {
  const session = makeSession({ anchorBoundary: 10, currentBoundary: 6 });
  assert.deepEqual(
    createScheduleDragPreview(session)?.interval,
    { startBoundary: 6, endBoundary: 10 },
  );
  assert.deepEqual(blocksFor(["0:6", "0:7", "0:8", "0:9"], session), ["0:6", "0:7", "0:8", "0:9"]);
});

test("reversal sequences produce exactly the final interval, never an extra block", () => {
  const sequences: Array<{
    anchor: number;
    steps: number[];
    expected: Array<{ startBoundary: number; endBoundary: number } | null>;
  }> = [
    { anchor: 6, steps: [11, 10], // 10:00 -> 12:30 -> 12:00
      expected: [null, { startBoundary: 6, endBoundary: 11 }, { startBoundary: 6, endBoundary: 10 }] },
    { anchor: 6, steps: [11, 9, 10], // 10:00 -> 12:30 -> 11:30 -> 12:00
      expected: [null, { startBoundary: 6, endBoundary: 11 }, { startBoundary: 6, endBoundary: 9 }, { startBoundary: 6, endBoundary: 10 }] },
    { anchor: 10, steps: [8, 9], // 12:00 -> 10:00 -> 10:30
      expected: [null, { startBoundary: 8, endBoundary: 10 }, { startBoundary: 9, endBoundary: 10 }] },
    { anchor: 6, steps: [10, 5], // 10:00 -> 12:00 -> 09:30
      expected: [null, { startBoundary: 6, endBoundary: 10 }, { startBoundary: 5, endBoundary: 6 }] },
    { anchor: 6, steps: [10, 6], // 10:00 -> 12:00 -> 10:00
      expected: [null, { startBoundary: 6, endBoundary: 10 }, null] },
    { anchor: 4, steps: [12, 11], // 09:00 -> 13:00 -> 12:30 (§6.4, §12.3)
      expected: [null, { startBoundary: 4, endBoundary: 12 }, { startBoundary: 4, endBoundary: 11 }] },
  ];

  for (const { anchor, steps, expected } of sequences) {
    const actual: Array<ScheduleDragInterval | null> = [];
    let session = makeSession({ anchorBoundary: anchor, currentBoundary: anchor });
    actual.push(createScheduleDragPreview(session)?.interval ?? null);
    for (const boundary of steps) {
      session = updateScheduleDragSession(session, boundary);
      actual.push(createScheduleDragPreview(session)?.interval ?? null);
    }
    assert.deepEqual(actual, expected);
  }
});

test("repeated reversals use only the final endpoint", () => {
  let session = makeSession({ anchorBoundary: 6, currentBoundary: 6 });
  for (const boundary of [11, 9, 13, 8, 4]) session = updateScheduleDragSession(session, boundary);
  assert.deepEqual(createScheduleDragPreview(session)?.interval, { startBoundary: 4, endBoundary: 6 });
});

test("fast drags across many rows never skip blocks in between", () => {
  const session = makeSession({ anchorBoundary: 6, currentBoundary: 20 });
  const blocks = blocksFor([], session);
  assert.equal(blocks.length, 14);
  assert.deepEqual(blocks, Array.from({ length: 14 }, (_, i) => blockKey(0, 6 + i)));
});

test("erasing removes only the interval blocks from the committed set", () => {
  const erasingSession = makeSession({ mode: "erasing", anchorBoundary: 6, currentBoundary: 10, baseBlocks: new Set(["0:6", "0:7", "0:8", "0:9"]) });
  assert.deepEqual(blocksFor(["0:6", "0:7", "0:8", "0:9"], erasingSession), []);
});

test("a partial erase with inclusive semantics removes the anchor cell too", () => {
  const session = makeSession({ mode: "erasing", anchorBoundary: 7, currentBoundary: 9, baseBlocks: new Set(["0:6", "0:7", "0:8", "0:9"]) });
  assert.deepEqual(blocksFor(["0:6", "0:7", "0:8", "0:9"], session), ["0:6"]);
});

test("painting stops at the first fully-booked block", () => {
  const session = makeSession({ anchorBoundary: 6, currentBoundary: 10 });
  const blocked = (blockIndex: number) => blockIndex === 8;
  assert.deepEqual(getScheduleDragIntervalBlocks({ startBoundary: 6, endBoundary: 10 }, "forward", blocked), [6, 7]);
  assert.deepEqual(blocksFor([], session, blocked), ["0:6", "0:7"]);
});

test("erasing ignores occupied blocks so an invalid old schedule can be removed", () => {
  const session = makeSession({ mode: "erasing", anchorBoundary: 6, currentBoundary: 10, baseBlocks: new Set(["0:6", "0:7", "0:8", "0:9"]) });
  assert.deepEqual(blocksFor(["0:6", "0:7", "0:8", "0:9"], session, (blockIndex) => blockIndex === 8), []);
});

test("painting upward stops at the first block encountered from the anchor", () => {
  const session = makeSession({ anchorBoundary: 10, currentBoundary: 6 });
  const blocked = (blockIndex: number) => blockIndex === 8;
  assert.deepEqual(getScheduleDragIntervalBlocks({ startBoundary: 6, endBoundary: 10 }, "backward", blocked), [9]);
  assert.deepEqual(blocksFor([], session, blocked), ["0:9"]);
});

test("the 22:00 terminal boundary is rejected per the 21:30 schedule limit", () => {
  assert.equal(
    getScheduleDragInterval(26, 30),
    null,
    "endBoundary 30 (22:00) must be rejected",
  );
  const valid = getScheduleDragInterval(26, 29);
  assert.deepEqual(valid, { startBoundary: 26, endBoundary: 29 });
  assert.deepEqual(blocksFor([], makeSession({ anchorBoundary: 26, currentBoundary: 29 })), ["0:26", "0:27", "0:28"]);
});

test("painting a single block is accepted, and erasing a single block is allowed", () => {
  assert.deepEqual(getScheduleDragInterval(6, 7, "painting"), { startBoundary: 6, endBoundary: 7 }, "paint 1 block → accepted");
  assert.deepEqual(getScheduleDragInterval(6, 7, "erasing"), { startBoundary: 6, endBoundary: 8 }, "erase 1 block → inclusive interval");
  assert.equal(getScheduleDragInterval(6, 6, "erasing"), null, "erase with no movement → still null");
  assert.deepEqual(
    blocksFor(["0:6"], makeSession({ mode: "erasing", anchorBoundary: 6, currentBoundary: 7, baseBlocks: new Set(["0:6"]) })),
    [],
    "erasing 1 block actually removes it",
  );
});

test("every pair of boundaries either stays below the one-hour minimum or produces an exact interval", () => {
  for (let anchor = 0; anchor < SCHEDULE_BLOCK_COUNT; anchor += 1) {
    for (let current = 0; current < SCHEDULE_BOUNDARY_COUNT; current += 1) {
      const interval = getScheduleDragInterval(anchor, current);
      const endsPastLimit = Math.max(anchor, current) > MAX_SCHEDULE_SESSION_BOUNDARY;
      if (current === anchor || endsPastLimit) {
        assert.equal(interval, null, `anchor ${anchor}, current ${current} must be rejected`);
        continue;
      }
      assert.ok(interval, `anchor ${anchor}, current ${current}`);
      assert.ok(interval.startBoundary < interval.endBoundary);
      assert.equal(scheduleBoundaryToMinutes(interval.endBoundary) - scheduleBoundaryToMinutes(interval.startBoundary), (interval.endBoundary - interval.startBoundary) * 30);
      const blocks = getScheduleDragIntervalBlocks(interval);
      assert.equal(blocks.length, interval.endBoundary - interval.startBoundary);
      assert.equal(new Set(blocks).size, blocks.length, "no duplicates");
      assert.ok(blocks.every((b) => b >= interval.startBoundary && b < interval.endBoundary), "no block outside");
    }
  }
});
