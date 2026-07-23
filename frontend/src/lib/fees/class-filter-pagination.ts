export const FEE_CLASS_FILTER_ROWS = 3;
export const DEFAULT_FEE_CLASS_CARDS_PER_ROW = 5;

const MIN_CARD_WIDTH_PX = 160;
const GRID_GAP_PX = 6;
const GRID_HORIZONTAL_PADDING_PX = 16;
const MAX_CARDS_PER_ROW = 6;

const CLASS_NAME_LEADING_SPACE_PX = 34;
const CLASS_NAME_CHARACTER_WIDTH_PX = 7;

function getClassNameWidthUnits(className: string): number {
  return Array.from(className.trim()).reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.55;
    if (/[ilI1|]/.test(character)) return total + 0.55;
    if (/[mwMW]/.test(character)) return total + 1.35;
    return total + 1;
  }, 0);
}

/**
 * Keeps the complete class name on one line by reserving enough room for the
 * leading colour marker and the widest name in the filter. The pagination can
 * then reduce its column count instead of shortening or clipping a class name.
 */
export function getFeeClassMinimumCardWidth(
  classNames: readonly string[],
): number {
  const widestNameUnits = classNames.reduce(
    (widest, className) => Math.max(widest, getClassNameWidthUnits(className)),
    0,
  );

  return Math.max(
    MIN_CARD_WIDTH_PX,
    Math.ceil(
      CLASS_NAME_LEADING_SPACE_PX +
        widestNameUnits * CLASS_NAME_CHARACTER_WIDTH_PX,
    ),
  );
}

export function getFeeClassCardsPerRow(
  containerWidth: number,
  minimumCardWidth = MIN_CARD_WIDTH_PX,
): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return DEFAULT_FEE_CLASS_CARDS_PER_ROW;
  }

  const availableWidth = Math.max(0, containerWidth - GRID_HORIZONTAL_PADDING_PX);
  const safeMinimumCardWidth = Math.max(
    MIN_CARD_WIDTH_PX,
    Number.isFinite(minimumCardWidth) ? minimumCardWidth : MIN_CARD_WIDTH_PX,
  );
  const fittingCards = Math.floor(
    (availableWidth + GRID_GAP_PX) / (safeMinimumCardWidth + GRID_GAP_PX),
  );
  return Math.max(1, Math.min(MAX_CARDS_PER_ROW, fittingCards));
}

export function getFeeClassPageSize(cardsPerRow: number): number {
  return Math.max(1, Math.floor(cardsPerRow)) * FEE_CLASS_FILTER_ROWS;
}

export function getFeeClassPageCount(itemCount: number, cardsPerRow: number): number {
  return Math.max(1, Math.ceil(Math.max(0, itemCount) / getFeeClassPageSize(cardsPerRow)));
}

export function getFeeClassPageIndex(
  itemIndex: number,
  cardsPerRow: number,
): number {
  return Math.max(0, Math.floor(itemIndex / getFeeClassPageSize(cardsPerRow)));
}

export function getFeeClassPageItems<T>(
  items: readonly T[],
  pageIndex: number,
  cardsPerRow: number,
): T[] {
  const pageSize = getFeeClassPageSize(cardsPerRow);
  const safePageIndex = Math.max(0, Math.min(Math.floor(pageIndex), getFeeClassPageCount(items.length, cardsPerRow) - 1));
  const start = safePageIndex * pageSize;
  return items.slice(start, start + pageSize);
}

export function getFeeClassPageColumnCount(
  pageItemCount: number,
  cardsPerRow: number,
): number {
  if (pageItemCount <= 0) {
    return 1;
  }

  return Math.min(
    Math.max(1, Math.floor(cardsPerRow)),
    Math.ceil(pageItemCount / FEE_CLASS_FILTER_ROWS),
  );
}
