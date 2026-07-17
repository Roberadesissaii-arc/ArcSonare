import { TrashIcon } from "../../components/Icons";
import type { CaptureMeta } from "./types";

interface CaptureHistoryListProps {
  captures: CaptureMeta[];
  onOpen: (meta: CaptureMeta) => void;
  onDelete: (meta: CaptureMeta) => void;
}

export function CaptureHistoryList({
  captures,
  onOpen,
  onDelete,
}: CaptureHistoryListProps) {
  return (
    <ul className="screen-context-history-list">
      {captures.map((meta) => (
        <li key={meta.id} className="screen-context-history-row">
          <button
            type="button"
            className="screen-context-history-open"
            onClick={() => onOpen(meta)}
          >
            <span className="screen-context-history-title">
              {meta.source === "active-window"
                ? (meta.activeWindowTitle ?? "Active window")
                : `Monitor capture ${meta.width}×${meta.height}`}
              {meta.annotated ? " · annotated" : ""}
            </span>
            <span className="screen-context-history-time">
              {new Date(meta.createdAt * 1000).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className="screen-context-history-delete"
            aria-label="Delete capture"
            onClick={() => onDelete(meta)}
          >
            <TrashIcon size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
