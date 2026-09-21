import {
  type ModelInfo,
  type ProviderInfo,
} from "../../config/modelRegistry";
import type { ModelStatusKind } from "./modelTypes";
import {
  CHAT_WIRED_PROVIDERS,
  isChatDefaultCandidate,
  isVoiceSpecialty,
  modelRoleLabel,
} from "./providerDefaults";

export type ProviderFilterId = "all" | "connected" | "available";

function contextLabel(m: ModelInfo): string {
  if (m.contextType === "realtime") return "Realtime";
  if (m.contextType === "long") return "Long context";
  return "Standard context";
}

function keyFacts(m: ModelInfo): string[] {
  return [...new Set([...m.capabilities, contextLabel(m), m.locality === "local" ? "Local" : "Cloud"])];
}

interface ProviderCompanyCardProps {
  provider: ProviderInfo;
  models: ModelInfo[];
  statusKind: ModelStatusKind;
  statusLabel: string;
  isDefaultCompany: boolean;
  defaultModelId: string | null;
  activeVariantHint?: string;
  onConfigure: () => void;
}

/**
 * One company · one API key · full model catalog with descriptions.
 * No per-model “Use model” — connecting the key auto-assigns chat/voice roles.
 */
export function ProviderCompanyCard({
  provider,
  models,
  statusKind,
  statusLabel,
  isDefaultCompany,
  defaultModelId,
  activeVariantHint,
  onConfigure,
}: ProviderCompanyCardProps) {
  const ready =
    statusKind === "configured" ||
    statusKind === "connected" ||
    statusKind === "running";
  const chatWired = CHAT_WIRED_PROVIDERS.has(provider.id);

  return (
    <section
      className={`models-catalog-section agent-surface${ready ? " is-ready" : ""}${
        isDefaultCompany ? " is-default-company" : ""
      }`}
      aria-labelledby={`provider-${provider.id}-title`}
    >
      <header className="models-catalog-section-head">
        <div className="models-catalog-section-identity">
          <span className="models-card-logo" aria-hidden="true">
            <img src={provider.logo} alt="" width={28} height={28} draggable={false} />
          </span>
          <div className="models-catalog-section-titles">
            <div className="models-catalog-section-title-row">
              <h3 id={`provider-${provider.id}-title`} className="models-catalog-section-title">
                {provider.name}
              </h3>
              {isDefaultCompany ? (
                <span className="models-default-badge">CHAT DEFAULT</span>
              ) : null}
              <span className={`models-status models-status-${statusKind}`}>
                <span className="models-status-dot" aria-hidden="true" />
                {statusLabel}
              </span>
            </div>
            <p className="models-catalog-section-desc">{provider.description}</p>
            <p className="models-catalog-section-hint">
              {ready
                ? chatWired
                  ? "Connected — one key unlocks every model below. Chat default is chosen automatically."
                  : "Connected — this key powers specialty features listed below (for example voice realtime)."
                : "Connect once with your API key. Models under this company share that key."}
              {activeVariantHint ? ` · Active: ${activeVariantHint}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-small${ready ? "" : " models-connect-btn"}`}
          onClick={onConfigure}
        >
          {ready ? "Manage key" : "Connect"}
        </button>
      </header>

      <div className="models-catalog-list" role="list">
        {models.map((m) => {
          const isChatDefault = defaultModelId === m.id;
          const facts = keyFacts(m);
          const role = modelRoleLabel(m);
          return (
            <article
              key={m.id}
              className={`models-catalog-item${isChatDefault ? " is-default" : ""}`}
              role="listitem"
            >
              <div className="models-catalog-item-main">
                <div className="models-catalog-item-title-row">
                  <h4 className="models-catalog-item-name">{m.displayName}</h4>
                  {isChatDefault ? <span className="models-default-badge">ACTIVE CHAT</span> : null}
                  <span
                    className={`models-catalog-pill${
                      isVoiceSpecialty(m) ? "" : isChatDefaultCandidate(m) && chatWired ? " models-catalog-pill-chat" : ""
                    }`}
                  >
                    {role}
                  </span>
                </div>
                <code className="models-catalog-item-id">{m.modelName}</code>
                <p className="models-catalog-item-desc">{m.description}</p>
                <dl className="models-catalog-facts">
                  {facts.map((fact) => (
                    <div key={fact} className="models-catalog-fact">
                      <dt className="sr-only">Detail</dt>
                      <dd>{fact}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
