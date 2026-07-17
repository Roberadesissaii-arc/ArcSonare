import { useMemo, useState } from "react";
import { INTEGRATIONS } from "../../data/demoData";
import { integrationIcons } from "../../config/iconRegistry";
import { SearchIcon } from "../Icons";

const ALL = "All";

/**
 * The integration grid, shared by the Command Center Connect page and the
 * Settings Connect page. Official icons come from the local ICO library;
 * no OAuth exists yet, so every card is honestly "Not connected".
 */
export function ConnectGrid() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);

  const categories = useMemo(() => {
    const set = new Set(INTEGRATIONS.map((i) => i.category));
    return [ALL, ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return INTEGRATIONS.filter((integration) => {
      if (category !== ALL && integration.category !== category) return false;
      if (!q) return true;
      return (
        integration.name.toLowerCase().includes(q) ||
        integration.category.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  return (
    <div className="connect-workspace">
      <div className="connect-toolbar">
        <label className="connect-search">
          <SearchIcon size={14} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search integrations…"
            aria-label="Search integrations"
          />
        </label>
        <span className="connect-count">
          {filtered.length} of {INTEGRATIONS.length}
        </span>
      </div>

      <div className="connect-filters" role="tablist" aria-label="Filter by category">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            role="tab"
            aria-selected={category === cat}
            className={`connect-filter${category === cat ? " active" : ""}`}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="connect-empty">
          No integrations match “{query.trim() || category}”.
        </p>
      ) : (
        <div className="connect-grid">
          {filtered.map((integration) => (
            <article key={integration.id} className="connect-card">
              <div className="connect-card-top">
                <img
                  className="connect-icon"
                  src={integrationIcons[integration.id]}
                  alt=""
                  width={40}
                  height={40}
                  draggable={false}
                />
                <span className="connect-status-pill">Not connected</span>
              </div>
              <div className="connect-meta">
                <span className="connect-name">{integration.name}</span>
                <span className="connect-category">{integration.category}</span>
              </div>
              <div className="connect-action">
                <button type="button" className="btn btn-small" disabled>
                  Connect
                </button>
                <span className="connect-soon">Coming soon</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
