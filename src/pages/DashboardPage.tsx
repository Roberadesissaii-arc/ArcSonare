import { useEffect, useRef, useState } from "react";
import { useAppState } from "../stores/appStore";
import { FocusCard } from "../components/dashboard/FocusCard";
import { ConnectedToolsCard } from "../components/dashboard/ConnectedToolsCard";
import { RunningAppsCard } from "../components/dashboard/RunningAppsCard";
import { WatchSourceBadge } from "../components/watch/WatchSourceBadge";
import { OrbitalCommandMap } from "../components/dashboard/OrbitalCommandMap";
import { UpNextCard } from "../components/dashboard/UpNextCard";
import { MeetingIntelligenceCard } from "../components/meeting/MeetingIntelligenceCard";
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
  pushPendingAssistantMessage,
  resolveAssistantMessage,
  useChatMessages,
  type ChatMessage,
} from "../stores/chatStore";
import { askAssistant } from "../services/AssistantService";
import { speak as speakText } from "../services/SpeechService";
import { filterTasks, useTasks } from "../stores/taskStore";
import { FormattedReply } from "../components/chat/FormattedReply";
import { CaptureImage } from "../components/chat/CaptureImage";
import { SourceIcon } from "../components/chat/SourceIcon";
import { ThinkingRow, ThoughtRow } from "../components/chat/ThinkingTool";
import { ResponseDiagnostics } from "../components/chat/ResponseDiagnostics";
import { ResultList } from "../components/chat/ResultList";
import type { ResponseAction } from "../features/conversation/responsePlan";
import { getPrefs } from "../stores/settingsStore";
import { characterById } from "../features/voice-settings/voiceCharacters";
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  GlobeIcon,
  LayersIcon,
  PaperclipIcon,
  RefreshIcon,
  SearchIcon,
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

/**
 * The overview line describes what is actually on the board.
 *
 * It used to always read "Here's what's moving" — including on a fresh install
 * with nothing to move, which reads as filler the moment you notice it.
 */
function overviewSubtitle(counts: {
  urgent: number;
  open: number;
  dueToday: number;
}): string {
  const { urgent, open, dueToday } = counts;
  if (open === 0) {
    return "Nothing on your plate right now. Ask me to start something.";
  }
  if (urgent >= 3) {
    return `${urgent} items need attention. Want me to prioritize them?`;
  }
  if (urgent === 1) return "One item is urgent. Want me to start there?";
  if (urgent === 2) return "Two items are urgent. Want me to prioritize them?";
  if (dueToday > 0) {
    return dueToday === 1
      ? "One thing is due today. Want me to take it?"
      : `${dueToday} things are due today. Want me to take the lead?`;
  }
  return open === 1
    ? "One task is open. Want me to take the lead?"
    : `${open} tasks are open. Want me to take the lead?`;
}

/** "Good evening, Robera" — or just "Good evening" when we have no name yet. */
function greetingTitle(greeting: string, name: string): string {
  const trimmed = name.trim();
  return trimmed ? `${greeting}, ${trimmed}` : greeting;
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
  const { profileName } = useAppState();
  const { view, work } = useCenterStage();
  const chatMessages = useChatMessages();
  // Counts come from the task store, not the activity feed: the feed lists
  // things that happened, which is not the same as what is still open.
  const tasks = useTasks();
  const urgentCount = filterTasks(tasks, "urgent").length;
  const openCount = filterTasks(tasks, "open").length;
  const todayCount = filterTasks(tasks, "today").length;
  const chatListRef = useRef<HTMLDivElement>(null);
  const chatTrackRef = useRef<HTMLDivElement>(null);
  /**
   * Whether the view is pinned to the newest message.
   *
   * Tracked continuously from the scroll event rather than measured when a
   * message arrives: effects run after the DOM updates, so by then
   * scrollHeight already includes the new content and the "were they at the
   * bottom?" question can no longer be answered — which is why the previous
   * attempt silently never scrolled for any reply taller than the threshold.
   */
  const stickToBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newContentBelow, setNewContentBelow] = useState(false);

  const scrollChatToBottom = (smooth = false) => {
    const list = chatListRef.current;
    if (!list) return;
    // Instant by default: streaming updates fire many times a second and
    // competing smooth animations end up stalling short of the bottom.
    list.scrollTo({
      top: list.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    stickToBottomRef.current = true;
    setAtBottom(true);
    setNewContentBelow(false);
  };

  const onChatScroll = () => {
    const list = chatListRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    const near = distance < 72;
    stickToBottomRef.current = near;
    setAtBottom(near);
    if (near) setNewContentBelow(false);
  };

  /**
   * Follow late layout, not just new messages.
   *
   * A reply is not finished growing when its text arrives: images decode,
   * result previews mount, and the feedback row appears underneath. Watching
   * the track's size catches all of it — the message-count effect alone left
   * the last few rows below the fold, which is the reported bug.
   */
  useEffect(() => {
    const track = chatTrackRef.current;
    if (!track || view !== "chat") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        scrollChatToBottom();
      } else {
        // Grew while the user was reading further up — say so instead of
        // yanking the viewport away from them.
        setNewContentBelow(true);
      }
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [view]);

  const lastMessage = chatMessages[chatMessages.length - 1];
  useEffect(() => {
    if (view !== "chat") return;
    if (!stickToBottomRef.current) {
      setNewContentBelow(true);
      return;
    }
    scrollChatToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, lastMessage?.text, lastMessage?.pending, view]);

  const greeting = greetingForNow();
  let title = greetingTitle(greeting, profileName);
  let subtitle = "Here’s what’s moving. Want me to take the lead?";

  if (view === "overview") {
    title = greetingTitle(greeting, profileName);
    subtitle = overviewSubtitle({
      urgent: urgentCount,
      open: openCount,
      dueToday: todayCount,
    });
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
    <div className="dashboard" data-page="dashboard">
      <div className="dashboard-col side-column dashboard-left dashboard-left-stretch">
        <FocusCard />
        <MeetingIntelligenceCard />
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
              <div
                className="chat-bubble-list"
                ref={chatListRef}
                onScroll={onChatScroll}
              >
                <div className="chat-bubble-track" ref={chatTrackRef}>
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
                  {/* Sentinel below every part of the last message — text,
                      images, chips and the feedback row — so "scrolled to the
                      bottom" means the whole reply is visible. */}
                  <div className="chat-bottom-sentinel" aria-hidden="true" />
                </div>
              </div>
              {!atBottom && newContentBelow ? (
                <button
                  type="button"
                  className="chat-jump-latest"
                  onClick={() => scrollChatToBottom(true)}
                >
                  Jump to latest
                </button>
              ) : null}
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
                      onClick={() => navigateSettings("voice")}
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

      <div className="dashboard-col side-column dashboard-right dashboard-right-stretch">
        <UpNextCard />
        <UrgentCard />
        <RunningAppsCard />
      </div>
    </div>
  );
}

/**
 * A suggested follow-up.
 *
 * The chip carries the capability and its arguments, and calls the executor
 * directly. Sending "Open folder" back through the model as if the user had
 * typed it would hand the choice back to tool selection — and the whole point
 * of a chip is that the choice is already made.
 */
function ActionChip({ action }: { action: ResponseAction }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const run = () => {
    if (busy || done) return;
    setBusy(true);
    const pendingId = pushPendingAssistantMessage();
    void import("../features/capabilities/capabilityEngine")
      .then(({ executeCapabilityById }) =>
        executeCapabilityById(
          action.capabilityId,
          action.args,
          action.label,
          { origin: "chat" },
        ),
      )
      .then(async (outcome) => {
        const facts = outcome.responseText || outcome.result?.summary || "Done.";
        if (!outcome.result) {
          resolveAssistantMessage(pendingId, facts);
          return;
        }
        const { buildResponsePlan } = await import(
          "../features/conversation/responsePlan"
        );
        const plan = buildResponsePlan({
          capabilityId: action.capabilityId,
          result: outcome.result,
          facts,
        });
        resolveAssistantMessage(pendingId, facts, {
          resultSource: plan.source,
          actions: plan.actions,
        });
        setDone(true);
      })
      .catch((err: unknown) => {
        resolveAssistantMessage(
          pendingId,
          err instanceof Error ? err.message : "That action didn't run.",
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <button
      type="button"
      className="chat-suggestion"
      onClick={run}
      disabled={busy || done}
    >
      {action.label}
    </button>
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
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Clear the "copied" tick if the bubble unmounts before the timer fires.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard
      .writeText(message.text)
      .then(() => setCopied(true))
      .catch((err) => console.error("[ArcSonare] copy failed:", err));
  };

  const speak = () => {
    if (speaking) return;
    const voice = characterById(getPrefs().voice.voiceId).preferredProviderVoiceId;
    setSpeaking(true);
    void speakText(message.text, { voice })
      .catch((err) => console.error("[ArcSonare] playback failed:", err))
      .finally(() => setSpeaking(false));
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
      {/* Attachment and mode are chips above the bubble — they used to be
          glued onto the message text, which made the bubble read oddly. */}
      {/* No badge on the question. It was stamped from whatever was active at
          send time — before the prompt existed — so "open the nft folder"
          carried a "Spotify context" badge that nothing had earned. Only the
          reply is credited, and only from that turn's provenance. */}
      {message.attachment || message.mode ? (
        <div className="chat-bubble-chips">
          {message.attachment ? (
            <span className="chat-chip chat-chip-file" title={message.attachment.name}>
              {message.attachment.dataUrl ? (
                <img src={message.attachment.dataUrl} alt="" />
              ) : (
                <PaperclipIcon size={11} />
              )}
              <span>{message.attachment.name}</span>
            </span>
          ) : null}
          {message.mode ? (
            <span className={`chat-chip chat-chip-mode mode-${message.mode}`}>
              {message.mode === "search" ? (
                <SearchIcon size={11} />
              ) : message.mode === "browser" ? (
                <GlobeIcon size={11} />
              ) : message.mode === "reasoning" ? (
                <LayersIcon size={11} />
              ) : (
                <EyeIcon size={11} />
              )}
              <span>
                {message.mode === "search"
                  ? "Search"
                  : message.mode === "browser"
                    ? "Browser"
                    : message.mode === "reasoning"
                      ? "Reasoning"
                      : "Watch"}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={`chat-bubble chat-bubble-${message.role}`}>
        {message.pending ? (
          <ThinkingRow status={message.status} />
        ) : message.role === "assistant" ? (
          <>
            {/* The same shell that was thinking now holds the answer, with the
                record of what it did collapsed above it. */}
            <ThoughtRow steps={message.thought} />
            {message.text ? <FormattedReply text={message.text} /> : null}
            {message.results?.length ? (
              <ResultList
                items={message.results}
                onOpen={(item) =>
                  void import("../features/capabilities/capabilityEngine").then(
                    ({ executeCapabilityById }) =>
                      executeCapabilityById(
                        "youtube.open_result",
                        { result_item_id: item.id },
                        `Open ${item.title}`,
                        { origin: "chat" },
                      ),
                  )
                }
              />
            ) : null}
            {message.captureId ? (
              <CaptureImage captureId={message.captureId} />
            ) : null}
            {message.images && message.images.length > 0 ? (
              <div className="chat-bubble-images">
                {message.images.map((src) => (
                  <a
                    key={src}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="chat-bubble-image-link"
                  >
                    <img src={src} alt="" className="chat-bubble-image" loading="lazy" />
                  </a>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          message.text
        )}
      </div>
      {/* What happened, in the user's terms: a bundled source icon and a plain
          label. The model name, provider and capability id live in the
          developer trace (`window.__arcsonareTrace`), never here. */}
      {/* Shown only when the answer actually used the watched application —
          not merely because something was being watched at the time. */}
      {message.role === "assistant" && !message.pending && message.watchedSources?.length ? (
        <WatchSourceBadge sources={message.watchedSources} variant="answered" />
      ) : null}
      {message.role === "assistant" && !message.pending && message.resultSource ? (
        <div className="chat-bubble-source">
          <SourceIcon iconKey={message.resultSource.iconKey} />
          <span className="chat-source-result">{message.resultSource.label}</span>
        </div>
      ) : null}
      {message.role === "assistant" && !message.pending && message.actions?.length ? (
        <div className="chat-bubble-suggestions">
          {message.actions.slice(0, 2).map((action) => (
            <ActionChip key={action.id} action={action} />
          ))}
        </div>
      ) : null}
      {message.role === "assistant" && !message.pending ? (
        <ResponseDiagnostics provenance={message.diagnostics} />
      ) : null}
      {message.role === "assistant" && !message.pending ? (
        <div className="chat-bubble-actions">
          <button
            type="button"
            className={feedback === "up" ? "active" : undefined}
            onClick={() => setFeedback((f) => (f === "up" ? null : "up"))}
            aria-label="Good reply"
            title="Good reply"
          >
            <ThumbsUpIcon size={14} />
          </button>
          <button
            type="button"
            className={feedback === "down" ? "active" : undefined}
            onClick={() => setFeedback((f) => (f === "down" ? null : "down"))}
            aria-label="Bad reply"
            title="Bad reply"
          >
            <ThumbsDownIcon size={14} />
          </button>
          <button
            type="button"
            onClick={regenerate}
            disabled={!precedingUserText || busy}
            aria-label="Regenerate"
            title="Regenerate"
          >
            <RefreshIcon size={14} />
          </button>
          <button
            type="button"
            className={copied ? "is-copied" : undefined}
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy"}
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
          <button
            type="button"
            className={speaking ? "is-speaking" : undefined}
            onClick={speak}
            aria-label={speaking ? "Playing" : "Listen"}
            title={speaking ? "Playing" : "Listen"}
          >
            <VolumeIcon size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
