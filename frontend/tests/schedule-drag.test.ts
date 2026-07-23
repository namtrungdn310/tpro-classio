import assert from "node:assert/strict";
import test from "node:test";
import {
  createScheduleDragCell,
  getGridCellsBetween,
  updateReversibleDragPath,
} from "../src/lib/classes/schedule-drag";

test("schedule drag interpolation includes every vertical time cell", () => {
  const cells = getGridCellsBetween(
    createScheduleDragCell(1, 3),
    createScheduleDragCell(1, 6),
  );

  assert.deepEqual(
    cells.map((cell) => cell.key),
    ["1:3", "1:4", "1:5", "1:6"],
  );
});

test("schedule drag path shrinks when the pointer reverses while held", () => {
  const downwardPath = updateReversibleDragPath(
    [createScheduleDragCell(1, 3)],
    getGridCellsBetween(
      createScheduleDragCell(1, 3),
      createScheduleDragCell(1, 6),
    ),
  );
  assert.deepEqual(
    downwardPath.map((cell) => cell.key),
    ["1:3", "1:4", "1:5", "1:6"],
  );

  const reversedPath = updateReversibleDragPath(
    downwardPath,
    getGridCellsBetween(
      createScheduleDragCell(1, 6),
      createScheduleDragCell(1, 4),
    ),
  );
  assert.deepEqual(
    reversedPath.map((cell) => cell.key),
    ["1:3", "1:4"],
  );
});

test("schedule drag can continue in the opposite direction after returning to its anchor", () => {
  const initialPath = [
    createScheduleDragCell(1, 3),
    createScheduleDragCell(1, 4),
    createScheduleDragCell(1, 5),
  ];
  const backAtAnchor = updateReversibleDragPath(
    initialPath,
    getGridCellsBetween(
      createScheduleDragCell(1, 5),
      createScheduleDragCell(1, 3),
    ),
  );
  assert.deepEqual(backAtAnchor, []);

  const upwardPath = updateReversibleDragPath(
    backAtAnchor,
    getGridCellsBetween(
      createScheduleDragCell(1, 3),
      createScheduleDragCell(1, 1),
    ),
  );

  assert.deepEqual(
    upwardPath.map((cell) => cell.key),
    ["1:2", "1:1"],
  );
});

test("schedule drag removes its starting cell when reversing to the anchor", () => {
  const paintedPath = [
    createScheduleDragCell(2, 7),
    createScheduleDragCell(2, 8),
    createScheduleDragCell(2, 9),
  ];

  const reversedToAnchor = updateReversibleDragPath(
    paintedPath,
    getGridCellsBetween(
      createScheduleDragCell(2, 9),
      createScheduleDragCell(2, 7),
    ),
  );

  assert.deepEqual(reversedToAnchor, []);
});
