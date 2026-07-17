import { providerById } from "../../config/modelRegistry";
import type { ProviderRuntimeStatus } from "./modelTypes";

interface ProviderStatusCardProps {
  statuses: ProviderRuntimeStatus[];
  onOpenProvider: (providerId: string) => void;
}

export function ProviderStatusCard({ statuses, onOpenProvider }: ProviderStatusCardProps) {
  return (
    <section className="models-side-card">
      <h3 className="models-side-label">Provider Status</h3>
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
                <span className="models-provider-status-name">
                  {provider.name}
                  {provider.configuration === "local-runtime" ? " (Local)" : ""}
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
