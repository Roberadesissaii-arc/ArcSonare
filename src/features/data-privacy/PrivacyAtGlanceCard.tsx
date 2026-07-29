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
    <DataPrivacyCard title="Privacy at a glance" className="privacy-glance-card">
      <div className="privacy-glance-body">
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
        <div className="privacy-glance-tips">
          <h3>On this device</h3>
          <p>
            Screen captures, voice data, and local model files stay under your
            ArcSonare data folder unless you explicitly export or enable cloud
            processing.
          </p>
          <p>
            API keys and sign-in sessions use Windows Credential Manager — they
            are never included in normal data exports.
          </p>
        </div>
        <button type="button" className="btn data-manage-all" onClick={onManageAll}>
          <FolderIcon size={14} />
          Manage all data
        </button>
      </div>
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
          description:
            "Cloud providers are blocked. Local models like Ollama still work.",
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
    dp.storeTranscripts
      ? {
          title: "Voice transcripts kept locally",
          description: "Saved transcripts follow your retention window.",
          tone: "info",
        }
      : {
          title: "Voice transcripts not stored",
          description: "Transcripts are discarded after processing.",
          tone: "ok",
        },
    dp.storeCaptures
      ? {
          title: "Screen Context history on",
          description: "Confirmed captures stay in your local history.",
          tone: "info",
        }
      : {
          title: "Screen Context history off",
          description: "Captures are not kept after the session.",
          tone: "ok",
        },
  ];
}
