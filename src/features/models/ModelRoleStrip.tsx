import { modelById, providerById } from "../../config/modelRegistry";
import type { ModelRole } from "../../config/prefs";
import { STRIP_ROLES } from "./modelHelpers";
import type { StripRoleId } from "./modelTypes";
import type { OllamaStatus } from "../../services/OllamaService";

interface ModelRoleStripProps {
  roles: Record<ModelRole, string | null>;
  ollamaModel: string;
  ollama: OllamaStatus | null;
  onSelectRole: (role: StripRoleId) => void;
}

export function ModelRoleStrip({
  roles,
  ollamaModel,
  ollama,
  onSelectRole,
}: ModelRoleStripProps) {
  return (
    <section className="models-role-strip" aria-label="Model role assignments">
      {STRIP_ROLES.map((role) => {
        const isLocal = role.id === "local";
        const localModel = modelById("ollama-local");
        const assignedId = isLocal ? "ollama-local" : roles[role.prefsRole!];
        const model = isLocal ? localModel : assignedId ? modelById(assignedId) : undefined;
        const logo = model?.logo;
        const name = isLocal
          ? ollamaModel.trim() || (ollama?.available ? "Ollama" : "Not detected")
          : model?.displayName || "Not assigned";
        const providerName = isLocal
          ? "Ollama"
          : model
            ? providerById(model.provider).name
            : "Unassigned";
        const activeLocal = isLocal && Boolean(ollama?.available && ollamaModel.trim());

        return (
          <button
            key={role.id}
            type="button"
            className={`models-role-tile${activeLocal ? " is-active" : ""}`}
            onClick={() => onSelectRole(role.id)}
            aria-label={`${role.label}: ${name}. Change assignment.`}
          >
            <span className="models-role-logo" aria-hidden="true">
              {logo ? (
                <img src={logo} alt="" width={22} height={22} draggable={false} />
              ) : (
                <span className="models-role-logo-empty" />
              )}
            </span>
            <span className="models-role-meta">
              <span className="models-role-label">{role.label}</span>
              <span className="models-role-model">
                {name}
                {activeLocal ? (
                  <span className="models-status-dot running" title="Active" />
                ) : null}
              </span>
              <span className="models-role-provider">{providerName}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
