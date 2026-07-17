import { providerById } from "../../config/modelRegistry";
import type { ProviderRuntimeStatus } from "./modelTypes";

interface ProviderStatusCardProps {
  statuses: ProviderRuntimeStatus[];
  onOpenProvider: (providerId: string) => void;
}

export function ProviderStatusCard({ statuses, onOpenProvider }: ProviderStatusCardProps) {
  const ready = statuses.filter(
    (s) =>
      s.kind === "connected" ||
      s.kind === "configured" ||
      s.kind === "running",
  ).length;
  const needsKey = statuses.filter((s) => s.kind === "not-configured").length;

  return (
    <section className="models-side-card models-side-card-providers">
      <header className="models-side-card-head">
        <h3 className="models-side-label">Provider Status</h3>
        <p className="models-side-subtitle">
          {ready} ready · {needsKey} need a key · {statuses.length} total
        </p>
      </header>
      <ul className="models-provider-status-list">
        {statuses.map((row) => {
          const provider = providerById(row.providerId);
          return (
            <li key={row.providerId}>
              <button
                type="button"
                className="models-provider-status-row"
                onClick={() => onOpenProvider(row.providerId)}
              >
                <span className="models-card-logo" aria-hidden="true">
                  <img src={provider.logo} alt="" width={18} height={18} draggable={false} />
                </span>
                <span className="models-provider-status-meta">
                  <span className="models-provider-status-name">
                    {provider.name}
                    {provider.configuration === "local-runtime" ? " (Local)" : ""}
                  </span>
                  <span className="models-provider-status-hint">
                    {provider.configuration === "local-runtime"
                      ? "Runs on this computer"
                      : "API key required for cloud chat"}
                  </span>
                </span>
                <span className={`models-status models-status-${row.kind}`}>
                  <span className="models-status-dot" aria-hidden="true" />
                  {row.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
