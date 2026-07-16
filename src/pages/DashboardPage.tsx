import { useAppState } from "../stores/appStore";
import { FocusCard } from "../components/dashboard/FocusCard";
import { VoiceActionCard } from "../components/dashboard/VoiceActionCard";
import { ConnectedToolsCard } from "../components/dashboard/ConnectedToolsCard";
import { OrbitalCommandMap } from "../components/dashboard/OrbitalCommandMap";
import { UpNextCard } from "../components/dashboard/UpNextCard";
import { UrgentCard } from "../components/dashboard/UrgentCard";
import { InAppVoiceConsole } from "../components/voice/InAppVoiceConsole";
import { CommandComposer } from "../components/command/CommandComposer";

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface DashboardPageProps {
  onCreateTask: () => void;
}

export function DashboardPage(_props: DashboardPageProps) {
  const { profileName } = useAppState();

  return (
    <div className="dashboard">
      <div className="dashboard-col dashboard-left">
        <FocusCard />
        <VoiceActionCard />
        <ConnectedToolsCard />
      </div>

      <div className="dashboard-center">
        <InAppVoiceConsole />
        <OrbitalCommandMap />
        <div className="dashboard-greeting">
          <h1 className="greeting-title">
            {greetingForNow()}, {profileName}
          </h1>
          <p className="greeting-sub">
            Here’s what’s moving. Want me to take the lead?
          </p>
          <div className="greeting-indicator" aria-hidden="true">
            <span />
            <span className="violet" />
            <span />
          </div>
        </div>
        <CommandComposer />
      </div>

      <div className="dashboard-col dashboard-right">
        <UpNextCard />
        <UrgentCard />
      </div>
    </div>
  );
}
