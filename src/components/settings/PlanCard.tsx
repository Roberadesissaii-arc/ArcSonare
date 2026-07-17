import { SparkleIcon } from "../Icons";

export type PlanKind = "local" | "preview" | "pro";

interface PlanCardProps {
  kind?: PlanKind;
  onAction?: () => void;
}

const COPY: Record<
  PlanKind,
  { title: string; body: string; action: string | null }
> = {
  local: {
    title: "ArcSonare Local",
    body: "Running on this device. No paid plan is active.",
    action: null,
  },
  preview: {
    title: "ArcSonare Preview",
    body: "Early access build. Paid plans are not available yet.",
    action: null,
  },
  pro: {
    title: "ArcSonare Pro",
    body: "Unlock advanced models, higher limits, and more.",
    action: "Upgrade →",
  },
};

/**
 * Honest plan/status card for the Settings sidebar.
 * Defaults to Local — do not claim Pro unless a real plan exists.
 */
export function PlanCard({ kind = "local", onAction }: PlanCardProps) {
  const copy = COPY[kind];
  return (
    <aside className="settings-plan-card" aria-label="Plan information">
      <div className="settings-plan-icon" aria-hidden="true">
        <SparkleIcon size={16} />
      </div>
      <div className="settings-plan-copy">
        <div className="settings-plan-title">{copy.title}</div>
        <p className="settings-plan-body">{copy.body}</p>
      </div>
      {copy.action && onAction ? (
        <button type="button" className="settings-plan-action" onClick={onAction}>
          {copy.action}
        </button>
      ) : null}
    </aside>
  );
}
