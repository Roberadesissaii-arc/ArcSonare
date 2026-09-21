/**
 * The compact result block shown inside an assistant reply.
 *
 * Deliberately a list, not a card per result: five stacked cards push the
 * answer and its controls off screen, which is the thing auto-scroll spent a
 * whole round of work fixing.
 *
 * Every action carries the structured `ResultItem` id. The visible title is
 * never sent back through natural-language matching — the user may paraphrase
 * it, two results may share it, and a near-match would open the wrong video.
 */

import { useState } from "react";
import type { ResultItem } from "../../features/conversation/conversationContext";

function hostLabel(item: ResultItem): string {
  if (item.type === "channel") return "Channel";
  if (item.type === "playlist") return "Playlist";
  return item.subtitle ?? "";
}

export function ResultList({
  items,
  onOpen,
}: {
  items: ResultItem[];
  onOpen: (item: ResultItem) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (items.length === 0) return null;

  return (
    <ol className="chat-result-list">
      {items.map((item) => (
        <li key={item.id} className="chat-result-item">
          <span className="chat-result-ordinal" aria-hidden="true">
            {item.ordinal}
          </span>
          {item.thumbnail ? (
            // Remote thumbnails come from ids YouTube returned, and are the one
            // place a network image is genuinely the content rather than chrome.
            <img
              className="chat-result-thumb"
              src={item.thumbnail}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="chat-result-thumb is-empty" aria-hidden="true" />
          )}
          <span className="chat-result-meta">
            <span className="chat-result-title">{item.title}</span>
            {hostLabel(item) ? (
              <span className="chat-result-sub">{hostLabel(item)}</span>
            ) : null}
          </span>
          <button
            type="button"
            className="chat-result-open"
            disabled={busyId === item.id}
            onClick={() => {
              setBusyId(item.id);
              onOpen(item);
            }}
          >
            Open
          </button>
        </li>
      ))}
    </ol>
  );
}
