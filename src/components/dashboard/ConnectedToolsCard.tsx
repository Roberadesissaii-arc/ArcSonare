import { CONNECTED_TOOLS } from "../../data/demoData";
import { integrationIcons } from "../../config/iconRegistry";
import { navigate } from "../../stores/appStore";
import { ArrowRightIcon } from "../Icons";

/**
 * One compact horizontal row: four connected tools (official icons in small
 * tiles) plus a circular "View all" action — never a stretched 2×2 grid.
 */
export function ConnectedToolsCard() {
  return (
    <section className="card sonare-card tools-card">
      <div className="card-head">
        <span className="card-label">Connected Tools</span>
      </div>
      <div className="tools-row">
        {CONNECTED_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="tool-item"
            onClick={() => navigate("connect")}
            aria-label={`${tool.name} — open Connect`}
            title={tool.name}
          >
            <span className="tool-tile">
              <img
                src={integrationIcons[tool.id]}
                alt=""
                width={30}
                height={30}
                draggable={false}
              />
            </span>
            <span className="tool-name">{tool.name}</span>
            <span className="tool-meta">Connected</span>
          </button>
        ))}
        <button
          type="button"
          className="tool-item tools-view-all"
          onClick={() => navigate("connect")}
          aria-label="View all connections"
        >
          <span className="tools-view-all-btn">
            <ArrowRightIcon size={15} />
          </span>
          <span className="tool-name">All</span>
          <span className="tool-meta">View</span>
        </button>
      </div>
    </section>
  );
}
