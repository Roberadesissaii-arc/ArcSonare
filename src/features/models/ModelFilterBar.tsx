import { LayoutIcon, ListIcon, SearchIcon } from "../../components/Icons";
import { Dropdown } from "../../components/settings/Dropdown";
import { FILTERS, SORTS } from "./modelHelpers";
import type { ModelFilterId, ModelSortId, ModelViewMode } from "./modelTypes";

interface ModelFilterBarProps {
  filter: ModelFilterId;
  sort: ModelSortId;
  view: ModelViewMode;
  search: string;
  onFilter: (id: ModelFilterId) => void;
  onSort: (id: ModelSortId) => void;
  onView: (view: ModelViewMode) => void;
  onSearch: (value: string) => void;
}

export function ModelFilterBar({
  filter,
  sort,
  view,
  search,
  onFilter,
  onSort,
  onView,
  onSearch,
}: ModelFilterBarProps) {
  return (
    <div className="models-filter-bar">
      <div className="models-filter-left">
        <label className="models-search">
          <SearchIcon size={14} />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search models..."
            aria-label="Search models"
          />
        </label>
        <div className="models-filter-capsules" role="tablist" aria-label="Model filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`models-filter-cap${filter === item.id ? " selected" : ""}`}
              onClick={() => onFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="models-filter-right">
        <Dropdown
          options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
          value={sort}
          onChange={(v) => onSort(v as ModelSortId)}
          ariaLabel="Sort models"
        />
        <div className="models-view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={view === "grid" ? "selected" : undefined}
            aria-pressed={view === "grid"}
            aria-label="Grid view"
            title="Grid view"
            onClick={() => onView("grid")}
          >
            <LayoutIcon size={14} />
          </button>
          <button
            type="button"
            className={view === "list" ? "selected" : undefined}
            aria-pressed={view === "list"}
            aria-label="List view"
            title="List view"
            onClick={() => onView("list")}
          >
            <ListIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
