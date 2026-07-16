import { CONNECTED_TOOLS } from "../../data/demoData";
import { integrationIcons } from "../../config/iconRegistry";
import { navigate } from "../../stores/appStore";
import { ArrowRightIcon } from "../Icons";

/** Four demo-connected tools with their official icons. */
export function ConnectedToolsCard() {
  return (
    <section className="card tools-card">
      <div className="card-head">
        <span className="card-label">Connected Tools</span>
        <button
          type="button"
          className="icon-button"
          onClick={() => navigate("connect")}
          aria-label="View all connections"
          title="View all"
        >
          <ArrowRightIcon size={15} />
        </button>
      </div>
      <div className="tools-grid">
        {CONNECTED_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="tool-item"
            onClick={() => navigate("connect")}
            aria-label={`${tool.name} — open Connect`}
          >
            <img
              className="tool-icon"
              src={integrationIcons[tool.id]}
              alt=""
              width={38}
              height={38}
              draggable={false}
            />
            <span className="tool-name">{tool.name}</span>
            <span className="tool-purpose">{tool.purpose}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
