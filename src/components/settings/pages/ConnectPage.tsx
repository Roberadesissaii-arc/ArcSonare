import { ConnectGrid } from "../../connect/ConnectGrid";

/**
 * Settings-side Connect page. Shares the integration grid with the main
 * Command Center — real icons, honest "Not connected" states, no OAuth yet.
 */
export function ConnectPage() {
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Connect</h1>
        <p className="page-subtitle">
          Bring your favorite tools into ArcSonare.
        </p>
      </header>
      <div className="settings-connect">
        <ConnectGrid />
      </div>
    </div>
  );
}
