import { ChevronRightIcon } from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import { modelById, providerById } from "../../config/modelRegistry";

interface RoutingFallbackCardProps {
  fallbackModelId: string | null;
  offlineFallbackModelId: string | null;
  autoRouting: boolean;
  onPickFallback: () => void;
  onPickOffline: () => void;
  onAutoRouting: (value: boolean) => void;
}

export function RoutingFallbackCard({
  fallbackModelId,
  offlineFallbackModelId,
  autoRouting,
  onPickFallback,
  onPickOffline,
  onAutoRouting,
}: RoutingFallbackCardProps) {
  const fallback = fallbackModelId ? modelById(fallbackModelId) : undefined;
  const offline = offlineFallbackModelId ? modelById(offlineFallbackModelId) : undefined;

  return (
    <section className="models-side-card models-side-card-routing">
      <header className="models-side-card-head">
        <h3 className="models-side-label">Routing & Fallbacks</h3>
        <p className="models-side-subtitle">
          Choose what ArcSonare uses when the primary model is busy, offline, or unavailable.
        </p>
      </header>

      <button type="button" className="models-side-row" onClick={onPickFallback}>
        <span className="models-side-row-text">
          <span className="models-side-row-label">Fallback model</span>
          <span className="models-side-row-value">
            {fallback ? (
              <>
                <img src={fallback.logo} alt="" width={16} height={16} draggable={false} />
                {fallback.displayName}
              </>
            ) : (
              "Not set"
            )}
          </span>
          <span className="models-side-row-help">
            Used when the default assistant model fails or rate-limits.
          </span>
        </span>
        <ChevronRightIcon size={14} />
      </button>

      <button type="button" className="models-side-row" onClick={onPickOffline}>
        <span className="models-side-row-text">
          <span className="models-side-row-label">Offline fallback</span>
          <span className="models-side-row-value">
            {offline ? (
              <>
                <img src={offline.logo} alt="" width={16} height={16} draggable={false} />
                {offline.displayName}
                {offline.locality === "local" ? "" : ` · ${providerById(offline.provider).name}`}
              </>
            ) : (
              "Not set"
            )}
          </span>
          <span className="models-side-row-help">
            Preferred when the machine has no network path to cloud providers.
          </span>
        </span>
        <ChevronRightIcon size={14} />
      </button>

      <div className="models-side-row models-side-row-static">
        <span className="models-side-row-text">
          <span className="models-side-row-label">Auto routing</span>
          <span className="models-side-row-help">
            Preference saved. Automatic role-based execution is not connected yet.
          </span>
        </span>
        <Toggle checked={autoRouting} onChange={onAutoRouting} label="Auto routing preference" />
      </div>

      <ul className="models-routing-notes" aria-label="Routing notes">
        <li>
          <strong>Priority</strong>
          <span>Default → fallback → offline</span>
        </li>
        <li>
          <strong>Local first</strong>
          <span>Offline fallback should usually be an Ollama model</span>
        </li>
        <li>
          <strong>Honesty</strong>
          <span>No silent cloud switch without your configured fallbacks</span>
        </li>
      </ul>
    </section>
  );
}
