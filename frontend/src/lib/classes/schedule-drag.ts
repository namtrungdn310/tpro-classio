export type ScheduleDragMode = "painting" | "erasing";

export const SCHEDULE_BLOCK_MINUTES = 30;
export const MIN_SCHEDULE_SESSION_BLOCKS = 2;
export const MAX_SCHEDULE_SESSION_BOUNDARY = 29;
export const SCHEDULE_BLOCK_COUNT = 30;
export const SCHEDULE_BOUNDARY_COUNT = SCHEDULE_BLOCK_COUNT + 1;
export const SCHEDULE_GRID_START_MINUTES = 7 * 60;

export const scheduleBoundaryToMinutes = (boundaryIndex: number) =>
  SCHEDULE_GRID_START_MINUTES + boundaryIndex * SCHEDULE_BLOCK_MINUTES;

export type ScheduleDragInterval = {
  startBoundary: number;
  endBoundary: number;
};

export type ScheduleDragPreview = {
  dayIndex: number;
  mode: ScheduleDragMode;
  interval: ScheduleDragInterval | null;
  anchorBoundary: number;
  currentBoundary: number;
};

export type ScheduleDragSession = {
  pointerId: number;
  mode: ScheduleDragMode;
  /**
   * The exclusive end boundary is rendered as an interactive filled cell.
   * A drag starting there is directional: upward erases while downward paints.
   */
  startedFromEndpoint?: boolean;
  dayIndex: number;
  anchorBoundary: number;
  currentBoundary: number;
  baseBlocks: ReadonlySet<string>;
};

export type ScheduleClickAnchor = {
  dayIndex: number;
  blockIndex: number;
};

export type ScheduleClickReason =
  | "pending"
  | "pending-cancelled"
  | "pending-moved"
  | "created"
  | "extended"
  | "shrunk"
  | "minimum-duration"
  | "interior-cell"
  | "bridge-rejected"
  | "blocked"
  | "outside-range";

export type ScheduleClickResult = {
  blocks: Set<string>;
  pendingAnchor: ScheduleClickAnchor | null;
  changed: boolean;
  reason: ScheduleClickReason;
};

/**
 * Direct-click editing for a 30-minute schedule grid.
 *
 * Committed data is always valid: a first empty click is kept only as a
 * pending visual anchor; the adjacent click commits the two-block (60-minute)
 * minimum. Existing sessions can be extended one block at either edge and
 * shrunk only from an edge while at least two blocks remain.
 */
export function applyScheduleCellClick({
  baseBlocks,
  pendingAnchor,
  dayIndex,
  blockIndex,
  getBlockKey,
  isBlocked = () => false,
}: {
  baseBlocks: ReadonlySet<string>;
  pendingAnchor: ScheduleClickAnchor | null;
  dayIndex: number;
  blockIndex: number;
  getBlockKey: (dayIndex: number, blockIndex: number) => string;
  isBlocked?: (dayIndex: number, blockIndex: number) => boolean;
}): ScheduleClickResult {
  const blocks = new Set(baseBlocks);
  if (
    dayIndex < 0 ||
    blockIndex < 0 ||
    blockIndex > MAX_SCHEDULE_SESSION_BOUNDARY
  ) {
    return {
      blocks,
      pendingAnchor,
      changed: false,
      reason: "outside-range",
    };
  }

  const key = getBlockKey(dayIndex, blockIndex);
  const selected = blocks.has(key);
  const joinsPrevious =
    blockIndex > 0 && blocks.has(getBlockKey(dayIndex, blockIndex - 1));
  const joinsNext =
    blockIndex + 1 < MAX_SCHEDULE_SESSION_BOUNDARY &&
    blocks.has(getBlockKey(dayIndex, blockIndex + 1));

  // The UI renders the exclusive end boundary as a filled cell. It must act
  // like the visible end edge rather than an empty block: clicking it shrinks
  // the preceding session by 30 minutes while the persisted interval remains
  // half-open [start, end).
  if (!selected && joinsPrevious) {
    if (joinsNext) {
      return {
        blocks,
        pendingAnchor: null,
        changed: false,
        reason: "bridge-rejected",
      };
    }
    let start = blockIndex - 1;
    while (start > 0 && blocks.has(getBlockKey(dayIndex, start - 1))) {
      start -= 1;
    }
    if (blockIndex - start <= MIN_SCHEDULE_SESSION_BLOCKS) {
      return {
        blocks,
        pendingAnchor: null,
        changed: false,
        reason: "minimum-duration",
      };
    }
    blocks.delete(getBlockKey(dayIndex, blockIndex - 1));
    return {
      blocks,
      pendingAnchor: null,
      changed: true,
      reason: "shrunk",
    };
  }

  if (selected) {
    let start = blockIndex;
    let end = blockIndex + 1;
    while (start > 0 && blocks.has(getBlockKey(dayIndex, start - 1))) {
      start -= 1;
    }
    while (
      end < MAX_SCHEDULE_SESSION_BOUNDARY &&
      blocks.has(getBlockKey(dayIndex, end))
    ) {
      end += 1;
    }

    // The end edge is represented by the separate visual endpoint above.
    // Therefore only the first persisted block is an editable edge; treating
    // end - 1 as an edge would make the penultimate visible cell removable.
    if (blockIndex !== start) {
      return {
        blocks,
        pendingAnchor: null,
        changed: false,
        reason: "interior-cell",
      };
    }
    if (end - start <= MIN_SCHEDULE_SESSION_BLOCKS) {
      return {
        blocks,
        pendingAnchor: null,
        changed: false,
        reason: "minimum-duration",
      };
    }

    blocks.delete(key);
    return {
      blocks,
      pendingAnchor: null,
      changed: true,
      reason: "shrunk",
    };
  }

  // Clicking the first white cell after a visual endpoint extends that
  // endpoint by one 30-minute block. This preserves click-to-add after the
  // endpoint itself was given click-to-remove semantics.
  const extendsPastVisualEndpoint =
    blockIndex > 1 &&
    !blocks.has(getBlockKey(dayIndex, blockIndex - 1)) &&
    blocks.has(getBlockKey(dayIndex, blockIndex - 2));
  if (extendsPastVisualEndpoint) {
    if (joinsNext) {
      return {
        blocks,
        pendingAnchor: null,
        changed: false,
        reason: "bridge-rejected",
      };
    }
    const nextDataBlockIndex = blockIndex - 1;
    if (isBlocked(dayIndex, nextDataBlockIndex)) {
      return {
        blocks,
        pendingAnchor,
        changed: false,
        reason: "blocked",
      };
    }
    blocks.add(getBlockKey(dayIndex, nextDataBlockIndex));
    return {
      blocks,
      pendingAnchor: null,
      changed: true,
      reason: "extended",
    };
  }

  // Boundary 29 (21:30) may be the visible endpoint of a valid session or
  // extend a session ending at 21:00. It cannot start an additional block,
  // because that would persist a forbidden 21:30-22:00 interval.
  if (blockIndex >= MAX_SCHEDULE_SESSION_BOUNDARY) {
    return {
      blocks,
      pendingAnchor,
      changed: false,
      reason: "outside-range",
    };
  }

  if (isBlocked(dayIndex, blockIndex)) {
    return {
      blocks,
      pendingAnchor,
      changed: false,
      reason: "blocked",
    };
  }

  if (joinsPrevious && joinsNext) {
    return {
      blocks,
      pendingAnchor: null,
      changed: false,
      reason: "bridge-rejected",
    };
  }
  if (joinsPrevious || joinsNext) {
    blocks.add(key);
    return {
      blocks,
      pendingAnchor: null,
      changed: true,
      reason: "extended",
    };
  }

  if (pendingAnchor) {
    if (
      pendingAnchor.dayIndex === dayIndex &&
      pendingAnchor.blockIndex === blockIndex
    ) {
      return {
        blocks,
        pendingAnchor: null,
        changed: false,
        reason: "pending-cancelled",
      };
    }
    const isAdjacent =
      pendingAnchor.dayIndex === dayIndex &&
      Math.abs(pendingAnchor.blockIndex - blockIndex) === 1;
    if (isAdjacent && !isBlocked(dayIndex, pendingAnchor.blockIndex)) {
      blocks.add(getBlockKey(dayIndex, pendingAnchor.blockIndex));
      blocks.add(key);
      return {
        blocks,
        pendingAnchor: null,
        changed: true,
        reason: "created",
      };
    }
    return {
      blocks,
      pendingAnchor: { dayIndex, blockIndex },
      changed: false,
      reason: "pending-moved",
    };
  }

  return {
    blocks,
    pendingAnchor: { dayIndex, blockIndex },
    changed: false,
    reason: "pending",
  };
}

// ---------------------------------------------------------------------------
// Canonical 31-boundary geometry
// ---------------------------------------------------------------------------

export type ScheduleGridGeometry = {
  gridTop: number;
  gridBottom: number;
  gridLeft: number;
  gridWidth: number;
  boundaryY: readonly number[];
  dayLeft: readonly number[];
  dayWidth: readonly number[];
  version: number;
};

export function buildScheduleGridGeometry(
  grid: { top: number; bottom: number; left: number; right?: number },
  rows: readonly { top: number; bottom: number }[],
  days: readonly { left: number; right: number }[],
  version: number,
): ScheduleGridGeometry | null {
  if (rows.length !== SCHEDULE_BLOCK_COUNT || days.length < 1) return null;

  const finiteGridValues = [grid.top, grid.bottom, grid.left, grid.right ?? grid.left];
  if (
    finiteGridValues.some((value) => !Number.isFinite(value)) ||
    !(grid.bottom > grid.top) ||
    rows.some(
      (row) =>
        !Number.isFinite(row.top) ||
        !Number.isFinite(row.bottom) ||
        !(row.bottom > row.top),
    ) ||
    days.some(
      (day) =>
        !Number.isFinite(day.left) ||
        !Number.isFinite(day.right) ||
        !(day.right > day.left),
    )
  ) {
    return null;
  }

  const boundaryY = new Array<number>(SCHEDULE_BOUNDARY_COUNT);
  boundaryY[0] = rows[0].top;
  for (let i = 1; i < rows.length; i += 1) {
    boundaryY[i] = (rows[i - 1].bottom + rows[i].top) / 2;
  }
  boundaryY[SCHEDULE_BLOCK_COUNT] = rows[rows.length - 1].bottom;

  for (let i = 1; i < boundaryY.length; i += 1) {
    if (!(boundaryY[i] > boundaryY[i - 1])) return null;
  }

  return {
    gridTop: grid.top,
    gridBottom: grid.bottom,
    gridLeft: grid.left,
    gridWidth: Math.max(0, (grid.right ?? grid.left) - grid.left),
    boundaryY,
    dayLeft: days.map((d) => d.left - grid.left),
    dayWidth: days.map((d) => d.right - d.left),
    version,
  };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function resolveScheduleBoundary(
  clientY: number,
  geometry: ScheduleGridGeometry,
): number {
  const boundaries = geometry.boundaryY;
  let lo = 0;
  let hi = boundaries.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (boundaries[mid] <= clientY) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Session & interval
// ---------------------------------------------------------------------------

export function updateScheduleDragSession(
  session: ScheduleDragSession,
  currentBoundary: number,
): ScheduleDragSession {
  const mode = session.startedFromEndpoint
    ? currentBoundary > session.anchorBoundary
      ? "painting"
      : "erasing"
    : session.mode;
  return { ...session, mode, currentBoundary };
}

/**
 * Boundary-end semantics: the pointer's row is the exclusive endpoint.
 *
 * - Click without movement: null (paint needs ≥ 2 blocks, erase needs ≥ 1).
 * - Paint: rejected if `|anchor - current| < 2`.
 * - Erase: rejected if `current === anchor`.
 * - Both: rejected if `end > MAX_SCHEDULE_SESSION_BOUNDARY` (21:30).
 */
export function getScheduleDragInterval(
  anchorBoundary: number,
  currentBoundary: number,
  mode: ScheduleDragMode = "painting",
): ScheduleDragInterval | null {
  if (currentBoundary === anchorBoundary) return null;
  const start = Math.min(anchorBoundary, currentBoundary);
  const end = Math.max(anchorBoundary, currentBoundary);
  if (end > MAX_SCHEDULE_SESSION_BOUNDARY) return null;
  if (mode === "painting" && end - start < 1) return null;
  // Erase is inclusive: the pointer's cell is always removed so the user
  // never sees two orphaned cells at the bottom of a reversed drag.
  return mode === "erasing"
    ? { startBoundary: start, endBoundary: end + 1 }
    : { startBoundary: start, endBoundary: end };
}

/**
 * Blocks inside an interval are indexed by their start boundary.
 * Direction controls whether iteration starts from `startBoundary`
 * (forward / drag-down) or `endBoundary - 1` (backward / drag-up) so
 * the stop-at-blocked rule halts at the first blocked block encountered
 * from the anchor side.
 */
export function getScheduleDragIntervalBlocks(
  interval: ScheduleDragInterval,
  direction: "forward" | "backward" = "forward",
  isBlocked: (blockIndex: number) => boolean = () => false,
): number[] {
  const blocks: number[] = [];
  if (direction === "backward") {
    for (
      let blockIndex = interval.endBoundary - 1;
      blockIndex >= interval.startBoundary;
      blockIndex -= 1
    ) {
      if (isBlocked(blockIndex)) break;
      blocks.push(blockIndex);
    }
    return blocks.sort((left, right) => left - right);
  }

  for (let blockIndex = interval.startBoundary; blockIndex < interval.endBoundary; blockIndex += 1) {
    if (isBlocked(blockIndex)) break;
    blocks.push(blockIndex);
  }
  return blocks;
}

export function createScheduleDragPreview(
  session: ScheduleDragSession,
): ScheduleDragPreview | null {
  const interval = getScheduleDragInterval(
    session.anchorBoundary,
    session.currentBoundary,
    session.mode,
  );
  if (!interval) return null;
  return {
    dayIndex: session.dayIndex,
    mode: session.mode,
    interval,
    anchorBoundary: session.anchorBoundary,
    currentBoundary: session.currentBoundary,
  };
}

/**
 * Merge a preview interval into committed base blocks. Painting stops at the
 * first blocked block encountered from the anchor side. Erasing is never
 * blocked — users must always be able to remove conflicting old data.
 */
export function applyScheduleDragPreview(
  baseBlocks: ReadonlySet<string>,
  preview: ScheduleDragPreview | null,
  getBlockKey: (dayIndex: number, blockIndex: number) => string,
  isBlocked: (blockIndex: number) => boolean = () => false,
): Set<string> {
  const nextBlocks = new Set(baseBlocks);
  if (!preview?.interval) return nextBlocks;

  const direction =
    preview.currentBoundary < preview.anchorBoundary ? "backward" : "forward";
  const blockIndices = getScheduleDragIntervalBlocks(
    preview.interval,
    direction,
    preview.mode === "painting" ? isBlocked : () => false,
  );
  for (const blockIndex of blockIndices) {
    const blockKey = getBlockKey(preview.dayIndex, blockIndex);
    if (preview.mode === "painting") {
      nextBlocks.add(blockKey);
    } else {
      nextBlocks.delete(blockKey);
    }
  }
  return nextBlocks;
}
