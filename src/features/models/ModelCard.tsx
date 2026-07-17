import { CheckIcon, DotsIcon } from "../../components/Icons";
import { providerById, type ModelInfo } from "../../config/modelRegistry";
import type { ModelStatusKind } from "./modelTypes";

interface ModelCardProps {
  model: ModelInfo;
  selected: boolean;
  statusKind: ModelStatusKind;
  statusLabel: string;
  activeModelName?: string;
  roleBadge?: string | null;
  view: "grid" | "list";
  testing?: boolean;
  onOpen: () => void;
  onPrimary: () => void;
  onTest?: () => void;
  onMenu?: () => void;
}

export function ModelCard({
  model,
  selected,
  statusKind,
  statusLabel,
  activeModelName,
  roleBadge,
  view,
  testing,
  onOpen,
  onPrimary,
  onTest,
  onMenu,
}: ModelCardProps) {
  const provider = providerById(model.provider);
  const chips = [
    ...model.capabilities,
    model.locality === "local" ? "Local" : "Cloud",
  ];

  return (
    <article
      className={`models-card${selected ? " is-default" : ""} models-card-${view}`}
      tabIndex={0}
      role="button"
      aria-label={`${model.displayName} by ${provider.name}. ${statusLabel}. Open details.`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="models-card-head">
        <span className="models-card-logo" aria-hidden="true">
          <img src={model.logo} alt="" width={26} height={26} draggable={false} />
        </span>
        <span className="models-card-titles">
          <span className="models-card-provider">{provider.name}</span>
          <span className="models-card-name">
            {model.displayName}
            {activeModelName ? ` · ${activeModelName}` : ""}
          </span>
        </span>
        {selected ? <span className="models-default-badge">DEFAULT</span> : null}
        {roleBadge && !selected ? (
          <span className="models-role-badge">{roleBadge}</span>
        ) : null}
      </div>

      <p className="models-card-desc">{model.description}</p>

      <div className="models-card-chips" aria-label="Capabilities">
        {chips.map((cap) => (
          <span key={cap} className="models-chip">
            {cap}
          </span>
        ))}
      </div>

      <div className="models-card-foot">
        <span className={`models-status models-status-${statusKind}`}>
          <span className="models-status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
        <div className="models-card-actions" onClick={(e) => e.stopPropagation()}>
          {onTest ? (
            <button
              type="button"
              className="btn btn-small models-secondary-btn"
              disabled={testing}
              onClick={onTest}
            >
              {testing ? "Testing…" : "Test"}
            </button>
          ) : null}
          <button
            type="button"
            className={`btn btn-small models-primary-btn${selected ? " is-active" : ""}`}
            onClick={onPrimary}
          >
            {selected ? (
              <>
                Active <CheckIcon size={13} />
              </>
            ) : (
              "Set as default"
            )}
          </button>
          {onMenu ? (
            <button
              type="button"
              className="models-more-btn"
              aria-label="More model actions"
              title="More actions"
              onClick={onMenu}
            >
              <DotsIcon size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
