export type ScheduleDragCell = {
  dayIndex: number;
  timeIndex: number;
  key: string;
};

export function createScheduleDragCell(
  dayIndex: number,
  timeIndex: number,
): ScheduleDragCell {
  return {
    dayIndex,
    timeIndex,
    key: `${dayIndex}:${timeIndex}`,
  };
}

export function getGridCellsBetween(
  start: ScheduleDragCell,
  end: ScheduleDragCell,
): ScheduleDragCell[] {
  const cells: ScheduleDragCell[] = [];
  let dayIndex = start.dayIndex;
  let timeIndex = start.timeIndex;
  const dayDistance = Math.abs(end.dayIndex - dayIndex);
  const dayDirection = dayIndex < end.dayIndex ? 1 : -1;
  const timeDistance = -Math.abs(end.timeIndex - timeIndex);
  const timeDirection = timeIndex < end.timeIndex ? 1 : -1;
  let error = dayDistance + timeDistance;

  while (true) {
    cells.push(createScheduleDragCell(dayIndex, timeIndex));
    if (dayIndex === end.dayIndex && timeIndex === end.timeIndex) break;

    const doubledError = error * 2;
    if (doubledError >= timeDistance) {
      error += timeDistance;
      dayIndex += dayDirection;
    }
    if (doubledError <= dayDistance) {
      error += dayDistance;
      timeIndex += timeDirection;
    }
  }

  return cells;
}

export function updateReversibleDragPath(
  currentPath: ScheduleDragCell[],
  traversedCells: ScheduleDragCell[],
): ScheduleDragCell[] {
  let nextPath = currentPath;

  // The first cell is the pointer's current position and is already reflected
  // by currentPath. Processing only the cells after it also lets an empty path
  // continue past its original anchor without selecting that anchor again.
  for (const cell of traversedCells.slice(1)) {
    const existingIndex = nextPath.findIndex((current) => current.key === cell.key);
    if (existingIndex >= 0) {
      if (existingIndex < nextPath.length - 1) {
        nextPath = existingIndex === 0 ? [] : nextPath.slice(0, existingIndex + 1);
      }
      continue;
    }

    nextPath = [...nextPath, cell];
  }

  return nextPath;
}
