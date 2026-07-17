import { useEffect, useRef } from "react";
import { CheckIcon, CloseIcon } from "../../components/Icons";
import { providerById, type ModelInfo } from "../../config/modelRegistry";

interface ModelSelectorProps {
  title: string;
  description?: string;
  models: ModelInfo[];
  selectedId: string | null;
  emptyMessage?: string;
  onSelect: (modelId: string | null) => void;
  onClose: () => void;
  allowNone?: boolean;
}

export function ModelSelector({
  title,
  description,
  models,
  selectedId,
  emptyMessage = "No compatible models for this role.",
  onSelect,
  onClose,
  allowNone = true,
}: ModelSelectorProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  return (
    <div className="models-selector-backdrop" role="presentation">
      <div
        ref={panelRef}
        className="models-selector"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="models-selector-head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="models-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </header>
        <ul className="models-selector-list">
          {allowNone ? (
            <li>
              <button
                type="button"
                className={!selectedId ? "selected" : undefined}
                onClick={() => onSelect(null)}
              >
                <span className="models-selector-meta">
                  <span className="models-selector-name">Not assigned</span>
                  <span className="models-selector-desc">Clear this role</span>
                </span>
                {!selectedId ? <CheckIcon size={14} /> : null}
              </button>
            </li>
          ) : null}
          {models.map((model) => {
            const provider = providerById(model.provider);
            const selected = selectedId === model.id;
            return (
              <li key={model.id}>
                <button
                  type="button"
                  className={selected ? "selected" : undefined}
                  onClick={() => onSelect(model.id)}
                >
                  <span className="models-card-logo" aria-hidden="true">
                    <img src={model.logo} alt="" width={22} height={22} draggable={false} />
                  </span>
                  <span className="models-selector-meta">
                    <span className="models-selector-name">{model.displayName}</span>
                    <span className="models-selector-desc">
                      {provider.name} · {model.locality === "local" ? "Local" : "Cloud"}
                    </span>
                  </span>
                  {selected ? <CheckIcon size={14} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {models.length === 0 ? (
          <p className="models-empty-note" role="status">
            {emptyMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
