import { ConnectGrid } from "../../components/connect/ConnectGrid";

/** Integration management inside Settings (same grid as the Connect page). */
export function IntegrationsSettingsPage() {
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Integrations</h1>
        <p className="page-subtitle">
          Connect your tools to ArcSonare. OAuth flows arrive with the service
          backend — every integration is honestly “Not connected” until then.
        </p>
      </header>
      <div className="settings-connect">
        <ConnectGrid />
      </div>
    </div>
  );
}
