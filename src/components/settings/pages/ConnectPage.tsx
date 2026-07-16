import { PlugIcon } from "../../Icons";

/**
 * Integrations arrive with Sonare Connect in a later phase. This is a clean
 * informational empty state — no fake connected accounts.
 */
export function ConnectPage() {
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Connect</h1>
        <p className="page-subtitle">
          Link ArcSonare with the tools you already use.
        </p>
      </header>

      <div className="empty-state">
        <span className="empty-state-icon">
          <PlugIcon size={26} />
        </span>
        <h2 className="empty-state-title">No integrations yet</h2>
        <p className="empty-state-text">
          Sonare Connect arrives in a later ArcSonare phase. Mail, calendar and
          messaging integrations will appear here, each with its own
          permissions you control.
        </p>
      </div>
    </div>
  );
}
