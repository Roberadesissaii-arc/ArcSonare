import { modelById, providerById } from "../../config/modelRegistry";
import type { ModelRole } from "../../config/prefs";
import { STRIP_ROLES } from "./modelHelpers";
import type { StripRoleId } from "./modelTypes";

interface ModelRoleStripProps {
  roles: Record<ModelRole, string | null>;
  onSelectRole: (role: StripRoleId) => void;
}

export function ModelRoleStrip({ roles, onSelectRole }: ModelRoleStripProps) {
  return (
    <section className="models-role-strip" aria-label="Model role assignments">
      {STRIP_ROLES.filter((role) => role.id !== "local").map((role) => {
        const assignedId = role.prefsRole ? roles[role.prefsRole] : null;
        const model = assignedId ? modelById(assignedId) : undefined;
        const logo = model?.logo;
        const name = model?.displayName || "Not assigned";
        const providerName = model ? providerById(model.provider).name : "Unassigned";

        return (
          <button
            key={role.id}
            type="button"
            className="models-role-tile"
            onClick={() => onSelectRole(role.id)}
            aria-label={`${role.label}: ${name}. Change assignment.`}
          >
            <span
              className={`models-role-logo${logo ? "" : " is-empty"}`}
              aria-hidden="true"
            >
              {logo ? (
                <img src={logo} alt="" width={22} height={22} draggable={false} />
              ) : (
                <span className="models-role-logo-empty" />
              )}
            </span>
            <span className="models-role-meta">
              <span className="models-role-label">{role.label}</span>
              <span className="models-role-model">{name}</span>
              <span className="models-role-provider">{providerName}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
