import { ShieldCheckIcon } from "../Icons";

/** Quiet bottom-right system status. */
export function SystemStatus() {
  return (
    <span className="system-status">
      <ShieldCheckIcon size={13} />
      All systems operational
      <span className="system-status-dot" aria-hidden="true" />
    </span>
  );
}
