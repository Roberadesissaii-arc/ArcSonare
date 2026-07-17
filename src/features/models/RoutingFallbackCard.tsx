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
    <section className="models-side-card">
      <h3 className="models-side-label">Routing & Fallbacks</h3>

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
        </span>
        <ChevronRightIcon size={14} />
      </button>

      <div className="models-side-row models-side-row-static">
        <span className="models-side-row-text">
          <span className="models-side-row-label">Auto routing</span>
          <span className="models-side-row-help">
            Routing rules configured; automatic execution is not connected yet.
          </span>
        </span>
        <Toggle checked={autoRouting} onChange={onAutoRouting} label="Auto routing preference" />
      </div>
    </section>
  );
}
