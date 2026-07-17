import { CheckIcon, FolderIcon, ShieldIcon, WarningIcon } from "../../components/Icons";
import type { Prefs } from "../../config/prefs";
import { DataPrivacyCard } from "./DataPrivacyCard";
import { derivePrivacyRing } from "./dataPrivacyActions";
import type { PrivacyRingState } from "./dataPrivacyTypes";

interface PrivacyAtGlanceCardProps {
  dataPrivacy: Prefs["dataPrivacy"];
  folderReady: boolean;
  onManageAll: () => void;
}

export function PrivacyAtGlanceCard({
  dataPrivacy,
  folderReady,
  onManageAll,
}: PrivacyAtGlanceCardProps) {
  const ring = derivePrivacyRing(dataPrivacy, folderReady);
  const statements = buildStatements(dataPrivacy, folderReady);

  return (
    <DataPrivacyCard title="Privacy at a glance">
      <div className="privacy-ring-wrap">
        <PrivacyStatusRing state={ring.state} label={ring.label} />
      </div>
      <ul className="privacy-statements">
        {statements.map((s) => (
          <li key={s.title} className={`privacy-statement is-${s.tone}`}>
            <span className="privacy-statement-icon" aria-hidden="true">
              {s.tone === "ok" ? (
                <CheckIcon size={12} />
              ) : s.tone === "warn" ? (
                <WarningIcon size={12} />
              ) : (
                <ShieldIcon size={12} />
              )}
            </span>
            <div>
              <strong>{s.title}</strong>
              <p>{s.description}</p>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn data-manage-all" onClick={onManageAll}>
        <FolderIcon size={14} />
        Manage all data
      </button>
    </DataPrivacyCard>
  );
}

function PrivacyStatusRing({
  state,
  label,
}: {
  state: PrivacyRingState;
  label: string;
}) {
  return (
    <div
      className={`privacy-ring state-${state}`}
      role="img"
      aria-label={`Privacy status: ${label}`}
    >
      <div className="privacy-ring-center">
        <ShieldIcon size={22} />
        <span>{label}</span>
      </div>
    </div>
  );
}

function buildStatements(
  dp: Prefs["dataPrivacy"],
  folderReady: boolean,
): { title: string; description: string; tone: "ok" | "warn" | "info" }[] {
  return [
    folderReady
      ? {
          title: "All data stored locally",
          description:
            "Nothing leaves your device unless you allow cloud processing.",
          tone: "ok",
        }
      : {
          title: "Local storage unavailable",
          description: "ArcSonare cannot write to the data folder right now.",
          tone: "warn",
        },
    dp.allowCloud
      ? {
          title: "Cloud processing is enabled",
          description:
            "Content may be sent to configured providers after your consent rules are applied.",
          tone: "warn",
        }
      : {
          title: "Cloud processing is off",
          description: "No AI requests are sent to cloud providers.",
          tone: "ok",
        },
    dp.allowCloud && !dp.askBeforeCloud
      ? {
          title: "Approvals not required for cloud",
          description:
            "Enable “Ask before cloud processing” to review each external request.",
          tone: "warn",
        }
      : {
          title: "You review sensitive actions",
          description:
            "Approvals are required for protected actions and optional cloud sends.",
          tone: "ok",
        },
    {
      title: "Delete anytime",
      description: "Remove any or all local data whenever you choose.",
      tone: "ok",
    },
  ];
}
