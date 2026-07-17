import { FolderIcon } from "../../components/Icons";

export function CaptureHistoryEmptyState() {
  return (
    <div className="screen-context-history-empty">
      <span className="screen-context-history-empty-icon" aria-hidden="true">
        <FolderIcon size={28} />
      </span>
      <p className="screen-context-history-empty-title">You&apos;re all caught up</p>
      <p className="screen-context-history-empty-desc">
        New captures appear here when history saving is on.
      </p>
    </div>
  );
}
