import { useAppState } from "../stores/appStore";
import { FocusCard } from "../components/dashboard/FocusCard";
import { VoiceActionCard } from "../components/voice/VoiceActionCard";
import { ConnectedToolsCard } from "../components/dashboard/ConnectedToolsCard";
import { OrbitalCommandMap } from "../components/dashboard/OrbitalCommandMap";
import { UpNextCard } from "../components/dashboard/UpNextCard";
import { UrgentCard } from "../components/dashboard/UrgentCard";
import { RecentActivityCard } from "../components/dashboard/RecentActivityCard";
import { CommandComposer } from "../components/dashboard/CommandComposer";
import {
  clearCenterWork,
  setCenterView,
  useCenterStage,
  type CenterStageView,
} from "../stores/centerStageStore";
import { navigateSettings } from "../stores/appStore";

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface DashboardPageProps {
  onCreateTask: () => void;
}

const VIEW_META: { id: CenterStageView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "active-work", label: "Active Work" },
  { id: "review", label: "Review" },
];

export function DashboardPage(_props: DashboardPageProps) {
  const { profileName, activity } = useAppState();
  const { view, work } = useCenterStage();
  const urgentCount = activity.filter((a) => a.source === "task").length;

  let title = `${greetingForNow()}, ${profileName}`;
  let subtitle = "Here’s what’s moving. Want me to take the lead?";

  if (view === "active-work" && work) {
    title = "ArcSonare is working";
    subtitle = work.step || work.status;
  } else if (view === "review" && work) {
    title = work.configRequired ? "Configuration needed" : "Your draft is ready";
    subtitle = work.configRequired
      ? work.configMessage ?? "Review the requirements before continuing."
      : "Review it before anything is sent.";
  } else if (urgentCount >= 3) {
    subtitle = "Three items need attention. Want me to prioritize them?";
  }

  return (
    <div className="dashboard">
      <div className="dashboard-col side-column dashboard-left">
        <FocusCard />
        <VoiceActionCard />
        <ConnectedToolsCard />
      </div>

      <div className="dashboard-center">
        <div
          className="orbital-stage-wrap"
          style={{
            flex: 1,
            minHeight: 0,
            width: "100%",
            position: "relative",
            opacity: view !== "overview" ? 0.25 : 1,
            transition: "opacity 240ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <OrbitalCommandMap />
        </div>

        {view === "active-work" && work ? (
          <div className="center-work-panel card sonare-card">
            <span className="card-label">Active Work</span>
            <h2 className="card-title">{work.title}</h2>
            <p className="card-text">{work.status}</p>
            <p className="card-text">{work.step}</p>
            <div className="focus-track" style={{ marginTop: 12 }} aria-hidden="true">
              <span className="focus-line" style={{ width: `${work.progress}%` }} />
            </div>
            <p className="card-text" style={{ marginTop: 10 }}>
              {work.contextNote}
            </p>
            <div className="card-actions">
              <button type="button" className="text-action" onClick={clearCenterWork}>
                Cancel
              </button>
              <button type="button" className="text-action" onClick={() => setCenterView("overview")}>
                Minimize to orbit
              </button>
            </div>
          </div>
        ) : null}

        {view === "review" && work ? (
          <div className="center-work-panel card sonare-card">
            <span className="card-label">Review</span>
            <h2 className="card-title">{work.title}</h2>
            {work.configRequired ? (
              <>
                <p className="card-text">{work.configMessage}</p>
                <div className="card-actions">
                  <button
                    type="button"
                    className="btn-pill"
                    onClick={() => navigateSettings("models")}
                  >
                    Open Models Settings
                  </button>
                  <button type="button" className="text-action" onClick={clearCenterWork}>
                    Cancel
                  </button>
                </div>
              </>
            ) : work.draft ? (
              <>
                <p className="card-text">
                  <strong>To</strong> {work.draft.to}
                </p>
                <p className="card-text">
                  <strong>Subject</strong> {work.draft.subject}
                </p>
                <p className="card-text" style={{ whiteSpace: "pre-wrap" }}>
                  {work.draft.body}
                </p>
                <p className="card-text">Tone: {work.draft.tone}</p>
                <div className="card-actions">
                  <button type="button" className="btn-pill" disabled title="Requires email provider">
                    Send (requires confirmation)
                  </button>
                  <button type="button" className="text-action" onClick={clearCenterWork}>
                    Close
                  </button>
                </div>
                <p className="card-text" style={{ marginTop: 8, fontSize: 11 }}>
                  Email is not sent unless a connected provider confirms it.
                </p>
              </>
            ) : (
              <>
                <p className="card-text">{work.status}</p>
                <button type="button" className="text-action" onClick={clearCenterWork}>
                  Back to Overview
                </button>
              </>
            )}
          </div>
        ) : null}

        <div className="dashboard-greeting">
          <h1 className="greeting-title">{title}</h1>
          <p className="greeting-sub">{subtitle}</p>
          <div className="greeting-indicator" role="tablist" aria-label="Center stage views">
            {VIEW_META.map((item) => {
              const disabled =
                (item.id === "active-work" && !work) ||
                (item.id === "review" && !work?.resultReady && !work?.configRequired);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={view === item.id}
                  aria-label={item.label}
                  title={item.label}
                  disabled={disabled}
                  className={view === item.id ? "violet" : undefined}
                  onClick={() => setCenterView(item.id)}
                />
              );
            })}
          </div>
        </div>
        <CommandComposer />
      </div>

      <div className="dashboard-col side-column dashboard-right">
        <UpNextCard />
        <UrgentCard />
        <RecentActivityCard />
      </div>
    </div>
  );
}
