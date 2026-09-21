import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The Applications card's row pager, extracted so there is exactly one of it.
 *
 * This is lifted verbatim from `ConnectedToolsCard` — same window start, same
 * one-row step, same clamping — because the Running Apps card sits beside it in
 * the same rail and a second, subtly different pager is what produced a card
 * that grew to three rows and clipped the last one. Two cards that page
 * differently read as a bug even when neither is wrong on its own.
 *
 * The window advances by ONE ROW, not one page. With [A, B, C] the sequence is
 * [A,B] → [B,C]; `maxStart` is `length - visibleRows`, so the last window is
 * always full and no row is ever half-drawn.
 */
export interface RowPager<T> {
  /** Exactly `visibleRows` items, unless there are fewer items than that. */
  visible: T[];
  canPageUp: boolean;
  canPageDown: boolean;
  /** True when the list is longer than the window, so a spacer is needed. */
  hasMore: boolean;
  /** Step the window. `+1` moves down one row, `-1` moves up one row. */
  pageBy: (delta: number) => void;
  windowStart: number;
}

export function useRowPager<T>(
  items: T[],
  visibleRows: number,
  /**
   * Changes that mean "the order you were looking at no longer applies".
   *
   * Activating an application moves it to the top of the list; leaving the
   * window where it was would show the user two rows that are no longer the
   * important ones — the application they just chose would be behind a chevron.
   * The Applications card passes nothing and keeps its position, which is right
   * there: its order does not move under the user.
   */
  resetKey?: string,
): RowPager<T> {
  const [windowStart, setWindowStart] = useState(0);

  useEffect(() => {
    if (resetKey === undefined) return;
    setWindowStart(0);
  }, [resetKey]);

  const maxStart = Math.max(0, items.length - visibleRows);

  const visible = useMemo(
    () => items.slice(windowStart, windowStart + visibleRows),
    [items, windowStart, visibleRows],
  );

  // The list shrinks when an application closes. Without this the window would
  // sit past the end and the card would render empty rather than the rows that
  // are still there.
  useEffect(() => {
    setWindowStart((start) => Math.min(start, maxStart));
  }, [maxStart]);

  const pageBy = useCallback(
    (delta: number) => {
      setWindowStart((start) => Math.min(maxStart, Math.max(0, start + delta)));
    },
    [maxStart],
  );

  return {
    visible,
    canPageUp: windowStart > 0,
    canPageDown: windowStart < maxStart,
    hasMore: items.length > visibleRows,
    pageBy,
    windowStart,
  };
}
