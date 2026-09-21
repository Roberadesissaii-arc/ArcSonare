import { watchAppVisual } from "../../features/watch/watchAppIcon";
import type { WatchedSourceRef } from "../../stores/chatStore";

/**
 * The watched-source line on a chat message.
 *
 * Informational only. It names which application the turn used and stops there
 * — no toggles, no settings, no duplicate of the composer's context control.
 * A previous version put a whole Watch interface under every reply, which is
 * both noise and the wrong place for it: the composer owns the context, and
 * this only reports it.
 */
export function WatchSourceBadge(props: {
  sources: WatchedSourceRef[];
  variant: "sent" | "answered";
}) {
  const { sources, variant } = props;
  if (sources.length === 0) return null;

  const first = watchAppVisual(sources[0].appCatalogId, sources[0].displayName);
  const names =
    sources.length === 1
      ? sources[0].displayName
      : sources.map((s) => s.displayName).join(" + ");
  const detail =
    sources.length === 1 && sources[0].detail ? ` · ${sources[0].detail}` : "";

  return (
    <div
      className="watch-source-badge"
      title={
        variant === "sent"
          ? `Sent with context from ${names}`
          : `Answered using ${names}`
      }
    >
      {first.iconSrc ? (
        <img src={first.iconSrc} alt="" width={13} height={13} />
      ) : null}
      <span>
        {variant === "sent"
          ? `${names} context`
          : `Controlled through ${names}${detail}`}
      </span>
    </div>
  );
}
