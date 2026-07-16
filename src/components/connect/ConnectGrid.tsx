import { INTEGRATIONS } from "../../data/demoData";
import { integrationIcons } from "../../config/iconRegistry";

/**
 * The integration grid, shared by the Command Center Connect page and the
 * Settings Connect page. Official icons come from the local ICO library;
 * no OAuth exists yet, so every card is honestly "Not connected".
 */
export function ConnectGrid() {
  return (
    <div className="connect-grid">
      {INTEGRATIONS.map((integration) => (
        <div key={integration.id} className="connect-card">
          <img
            className="connect-icon"
            src={integrationIcons[integration.id]}
            alt=""
            width={40}
            height={40}
            draggable={false}
          />
          <div className="connect-meta">
            <span className="connect-name">{integration.name}</span>
            <span className="connect-category">{integration.category}</span>
            <span className="connect-status">Not connected</span>
          </div>
          <div className="connect-action">
            <button type="button" className="btn btn-small" disabled>
              Connect
            </button>
            <span className="connect-soon">Coming soon</span>
          </div>
        </div>
      ))}
    </div>
  );
}
