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
    <section className="card tools-card">
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
          >
            <span className="tool-tile">
              <img
                src={integrationIcons[tool.id]}
                alt=""
                width={26}
                height={26}
                draggable={false}
              />
            </span>
            <span className="tool-name">{tool.name}</span>
            <span className="tool-purpose">{tool.purpose}</span>
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
          <span className="tool-purpose">View all</span>
        </button>
      </div>
    </section>
  );
}
