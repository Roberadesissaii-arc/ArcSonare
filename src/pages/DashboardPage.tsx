import { useState } from "react";
import { useAppState } from "../stores/appStore";
import { FocusCard } from "../components/dashboard/FocusCard";
import { VoiceActionCard } from "../components/voice/VoiceActionCard";
import { ConnectedToolsCard } from "../components/dashboard/ConnectedToolsCard";
import { OrbitalCommandMap } from "../components/dashboard/OrbitalCommandMap";
import { UpNextCard } from "../components/dashboard/UpNextCard";
import { UrgentCard } from "../components/dashboard/UrgentCard";
import { CommandComposer } from "../components/dashboard/CommandComposer";
import {
  clearCenterWork,
  setCenterView,
  useCenterStage,
  type CenterStageView,
} from "../stores/centerStageStore";
import { navigateSettings } from "../stores/appStore";
import {
  markAssistantMessagePending,
  resolveAssistantMessage,
  useChatMessages,
  type ChatMessage,
} from "../stores/chatStore";
import { askAssistant } from "../services/AssistantService";
import { speakWithPocketTts } from "../services/PocketTtsService";
import { getPrefs } from "../stores/settingsStore";
import { characterById } from "../features/voice-settings/voiceCharacters";
import {
  CopyIcon,
  RefreshIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  VolumeIcon,
} from "../components/Icons";

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
  { id: "chat", label: "Chat" },
];

export function DashboardPage(_props: DashboardPageProps) {
  const { profileName, activity } = useAppState();
  const { view, work } = useCenterStage();
  const chatMessages = useChatMessages();
  const urgentCount = activity.filter((a) => a.source === "task").length;

  const greeting = greetingForNow();
  let title = `${greeting}, ${profileName}`;
  let subtitle = "Here’s what’s moving. Want me to take the lead?";

  if (view === "overview") {
    title = `${greeting}, ${profileName}`;
    subtitle =
      urgentCount >= 3
        ? "Three items need attention. Want me to prioritize them?"
        : "Here’s what’s moving. Want me to take the lead?";
  } else if (view === "active-work") {
    if (work) {
      title = "ArcSonare is working";
      subtitle = work.step || work.status;
    } else {
      title = "Active Work";
      subtitle = "Nothing is running right now. Ask ArcSonare to take the lead.";
    }
  } else if (view === "review") {
    if (work?.configRequired) {
      title = "Configuration needed";
      subtitle = work.configMessage ?? "Review the requirements before continuing.";
    } else if (work?.resultReady) {
      title = "Your draft is ready";
      subtitle = "Review it before anything is sent.";
    } else {
      title = "Review";
      subtitle = "Finished drafts and results will show up here for confirmation.";
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-col side-column dashboard-left">
        <FocusCard />
        <VoiceActionCard />
        <ConnectedToolsCard />
      </div>

      <div className="dashboard-center">
        <div className="orbital-zone">
          <div
            className="orbital-stage-wrap"
            role={view !== "overview" && work ? "button" : undefined}
            tabIndex={view !== "overview" && work ? 0 : undefined}
            aria-label={
              view !== "overview" && work
                ? "Dismiss result and return to overview"
                : undefined
            }
            onClick={() => {
              if (view !== "overview" && work) clearCenterWork();
            }}
            onKeyDown={(event) => {
              if (
                view !== "overview" &&
                work &&
                (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                clearCenterWork();
              }
            }}
            style={{
              flex: 1,
              minHeight: 0,
              width: "100%",
              position: "relative",
              opacity: view !== "overview" ? 0.25 : 1,
              transition: "opacity 240ms cubic-bezier(0.22, 1, 0.36, 1)",
              cursor: view !== "overview" && work ? "pointer" : undefined,
            }}
          >
            <OrbitalCommandMap />
          </div>

          {view === "chat" ? (
            <div className="chat-overlay">
              <div className="chat-bubble-list">
                {chatMessages.map((m, i) => (
                  <ChatBubble
                    key={m.id}
                    message={m}
                    precedingUserText={
                      m.role === "assistant"
                        ? (chatMessages
                            .slice(0, i)
                            .reverse()
                            .find((prev) => prev.role === "user")?.text ?? null)
                        : null
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div
          className={`dashboard-greeting${view === "chat" ? " dashboard-greeting-compact" : ""}`}
          onClick={() => {
            if (view !== "overview" && work) clearCenterWork();
          }}
          style={{
            cursor: view !== "overview" && work ? "pointer" : undefined,
          }}
        >
          {view === "chat" ? null : (
            <>
              <h1 className="greeting-title">{title}</h1>
              <p className="greeting-sub">{subtitle}</p>
            </>
          )}
          <div className="greeting-indicator" role="tablist" aria-label="Center stage views">
            {VIEW_META.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                aria-label={item.label}
                title={item.label}
                className={view === item.id ? "violet" : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  setCenterView(item.id);
                }}
              />
            ))}
          </div>
        </div>

        <div
          className="composer-stage"
          onClick={(event) => {
            if (
              view !== "overview" &&
              work &&
              event.target === event.currentTarget
            ) {
              clearCenterWork();
            }
          }}
        >
          {view === "active-work" && work ? (
            <div
              className="center-work-panel card sonare-card"
              onClick={(event) => event.stopPropagation()}
            >
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
            <div
              className="center-work-panel card sonare-card"
              onClick={(event) => event.stopPropagation()}
            >
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
                  {work.step ? (
                    <p className="card-text" style={{ fontSize: 11, marginBottom: 6 }}>
                      {work.step}
                    </p>
                  ) : null}
                  <p className="card-text" style={{ whiteSpace: "pre-wrap" }}>
                    {work.status}
                  </p>
                  {work.contextNote ? (
                    <p className="card-text" style={{ marginTop: 8, fontSize: 11 }}>
                      {work.contextNote}
                    </p>
                  ) : null}
                  <div className="card-actions">
                    <button type="button" className="text-action" onClick={clearCenterWork}>
                      Back to Overview
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          <div onClick={(event) => event.stopPropagation()}>
            <CommandComposer />
          </div>
        </div>
      </div>

      <div className="dashboard-col side-column dashboard-right">
        <UpNextCard />
        <UrgentCard />
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  precedingUserText,
}: {
  message: ChatMessage;
  precedingUserText: string | null;
}) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(message.text);
  };

  const speak = () => {
    const voice = characterById(getPrefs().voice.voiceId).preferredProviderVoiceId;
    void speakWithPocketTts(message.text, { voice });
  };

  const regenerate = () => {
    if (!precedingUserText || busy) return;
    setBusy(true);
    markAssistantMessagePending(message.id);
    void askAssistant(precedingUserText)
      .then((reply) => resolveAssistantMessage(message.id, reply.text))
      .catch(() =>
        resolveAssistantMessage(message.id, "Sorry, I couldn't regenerate that reply."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="chat-bubble-wrap">
      <div className={`chat-bubble chat-bubble-${message.role}`}>
        {message.pending ? (
          <span className="chat-bubble-typing">
            <i />
            <i />
            <i />
          </span>
        ) : (
          message.text
        )}
      </div>
      {message.role === "assistant" && !message.pending ? (
        <div className="chat-bubble-actions">
          <button
            type="button"
            className={feedback === "up" ? "active" : undefined}
            onClick={() => setFeedback((f) => (f === "up" ? null : "up"))}
            aria-label="Good reply"
            title="Good reply"
          >
            <ThumbsUpIcon size={12} />
          </button>
          <button
            type="button"
            className={feedback === "down" ? "active" : undefined}
            onClick={() => setFeedback((f) => (f === "down" ? null : "down"))}
            aria-label="Bad reply"
            title="Bad reply"
          >
            <ThumbsDownIcon size={12} />
          </button>
          <button
            type="button"
            onClick={regenerate}
            disabled={!precedingUserText || busy}
            aria-label="Regenerate"
            title="Regenerate"
          >
            <RefreshIcon size={12} />
          </button>
          <button type="button" onClick={copy} aria-label="Copy" title="Copy">
            <CopyIcon size={12} />
          </button>
          <button type="button" onClick={speak} aria-label="Listen" title="Listen">
            <VolumeIcon size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
