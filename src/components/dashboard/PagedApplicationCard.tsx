import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ArrowRightIcon } from "../Icons";
import { useRowPager } from "./useRowPager";

/**
 * The dashboard's application-list card, as one component.
 *
 * Applications and Running Apps sit side by side in the same rail. Built
 * separately they drifted every time either was touched — different top
 * spacing, a subtitle the list rode up over, a chevron half out of the card —
 * and each fix restored the resemblance without removing the cause. There is
 * one card now: the frame, the header, the subtitle, the two-row viewport, the
 * pager and both chevron slots all live here, and the two callers differ only
 * in their rows.
 *
 * Nothing in this file sets a colour, a radius, a padding or a height. Those
 * come from `card` / `sonare-card` / `tools-card` in `cards.css`, which is why
 * the two cards cannot disagree about them.
 */

/** Two. Both cards, one constant, no way to set it per card. */
export const VISIBLE_ROWS = 2;

export function PagedApplicationCard<T>(props: {
  /** Header label, left. */
  label: string;
  /** The one-line `card-lede` under the header. */
  description: string;
  /** Distinguishes the two cards for styling hooks only. */
  variant: "applications-card" | "opened-apps-card";
  /** Accessible name for the list. */
  listLabel: string;
  items: T[];
  keyOf: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  /** The header's `All →` action. */
  onAll: () => void;
  /** Shown instead of the list when there is nothing to page through. */
  empty?: ReactNode;
  /**
   * Changes that should send the window back to the top.
   *
   * Running Apps passes its active set: activating an application reorders the
   * list, and the row the user just chose has to be one of the two on screen.
   * Applications passes nothing — its order does not move under the reader.
   */
  resetKey?: string;
}) {
  const { visible, canPageUp, canPageDown, hasMore, pageBy } = useRowPager(
    props.items,
    VISIBLE_ROWS,
    props.resetKey,
  );

  return (
    <section
      className={`card sonare-card tools-card tools-card-stretch ${props.variant}`}
    >
      <div className="tools-section-head">
        <span className="card-label">{props.label}</span>
        <button type="button" className="tools-section-link" onClick={props.onAll}>
          All
          <ArrowRightIcon size={12} />
        </button>
      </div>
      <p className="card-lede">{props.description}</p>

      {props.items.length === 0 && props.empty ? (
        props.empty
      ) : (
        <div className="opened-apps-list-wrap opened-apps-paged applications-paged">
          {/* The up slot is always occupied — by the chevron or by a spacer of
              the same height — so the list never moves up over the subtitle
              when the window is at the top. */}
          {canPageUp ? (
            <button
              type="button"
              className="opened-apps-page-btn opened-apps-page-up"
              aria-label="Show previous applications"
              onClick={() => pageBy(-1)}
            >
              <ChevronUp size={14} strokeWidth={2.25} />
            </button>
          ) : (
            <span className="opened-apps-page-spacer" aria-hidden="true" />
          )}

          <ul
            className="tools-list tools-list-opened tools-list-opened-snap"
            aria-label={props.listLabel}
          >
            {visible.map((item) => (
              <li key={props.keyOf(item)} className="paged-card-row">
                {props.renderRow(item)}
              </li>
            ))}
          </ul>

          {canPageDown ? (
            <button
              type="button"
              className="opened-apps-page-btn opened-apps-page-down"
              aria-label="Show more applications"
              onClick={() => pageBy(1)}
            >
              <ChevronDown size={14} strokeWidth={2.25} />
            </button>
          ) : hasMore ? (
            <span className="opened-apps-page-spacer" aria-hidden="true" />
          ) : null}
        </div>
      )}
    </section>
  );
}
