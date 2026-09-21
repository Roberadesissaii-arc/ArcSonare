/**
 * MeetingIntelligenceCard — Dashboard card for meeting intelligence.
 *
 * Shows:
 * - Active meeting status (recording indicator, platform, duration)
 * - Pending consent prompts
 * - Recent completed meetings (last 3)
 * - Supported platforms row
 *
 * Placed in the left column of the Dashboard, before TodayGlanceCard.
 *
 * Owned by Agent 3.
 */

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, ChevronRight, Clock, Brain, CheckCircle } from "lucide-react";
import {
  useActiveMeeting,
  usePendingCandidates,
  useRecentMeetings,
  useMeetingBackendAvailable,
  meetingStart,
  meetingIgnore,
  meetingEnd,
  meetingPauseRecording,
} from "../../features/meeting/meetingStore";
import { resumeAudioCapture } from "../../features/meeting/meetingAudioCapture";

import type { MeetingCandidate, MeetingSession, MeetingSourceId } from "../../features/meeting/meetingTypes";
import { MEETING_PLATFORMS } from "../../features/meeting/meetingTypes";
import { formatMeetingDuration, relativeMeetingTime, meetingSourceDisplayName } from "../../features/meeting/meetingUtils";
import { MeetingPlatformIcon } from "./MeetingPlatformIcon";

// ---------------------------------------------------------------------------
// Duration counter
// ---------------------------------------------------------------------------

function useLiveDuration(startedAt: string | null): string {
  const [dur, setDur] = useState("00:00");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setDur("00:00");
      return;
    }
    const update = () => {
      const ms = Date.now() - new Date(startedAt).getTime();
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if (h > 0) {
        setDur(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      } else {
        setDur(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      }
    };
    update();
    timerRef.current = setInterval(update, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startedAt]);

  return dur;
}

// ---------------------------------------------------------------------------
// Active meeting panel
// ---------------------------------------------------------------------------

function ActiveMeetingPanel({ meeting }: { meeting: MeetingSession }) {
  const isRecording = meeting.state === "recording-active";
  const isPaused = meeting.state === "paused";
  const isProcessing = meeting.state === "processing";
  const duration = useLiveDuration(meeting.startedAt);

  return (
    <div className="mi-active-panel">
      <div className="mi-active-header">
        <span className={`mi-recording-dot ${isRecording ? "is-recording" : isPaused ? "is-paused" : "is-notes"}`} aria-label={isRecording ? "Recording" : "Taking notes"} />
        <span className="mi-active-platform">
          <MeetingPlatformIcon source={meeting.source} size={14} />
          {meetingSourceDisplayName(meeting.source)}
        </span>
        <span className="mi-active-duration">
          <Clock size={11} aria-hidden="true" />
          {duration}
        </span>
      </div>

      {meeting.meetingTitle ? (
        <p className="mi-active-title">{meeting.meetingTitle}</p>
      ) : null}

      <div className="mi-active-state-row">
        {isRecording ? (
          <span className="mi-state-badge is-recording">Recording</span>
        ) : isPaused ? (
          <span className="mi-state-badge is-paused">Paused</span>
        ) : isProcessing ? (
          <span className="mi-state-badge is-processing">Processing notes…</span>
        ) : (
          <span className="mi-state-badge is-notes">Taking notes</span>
        )}
      </div>

      <div className="mi-active-actions">
        {isPaused ? (
          <button
            type="button"
            className="mi-action-btn is-resume"
            onClick={() => void resumeAudioCapture()}
          >
            <Mic size={13} aria-hidden="true" />
            Resume
          </button>
        ) : isRecording ? (
          <button
            type="button"
            className="mi-action-btn is-pause"
            onClick={() => void meetingPauseRecording(meeting.id)}
          >
            <MicOff size={13} aria-hidden="true" />
            Pause
          </button>
        ) : null}
        <button
          type="button"
          className="mi-action-btn is-end"
          onClick={() => void meetingEnd(meeting.id)}
        >
          End
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Consent prompt card
// ---------------------------------------------------------------------------

function ConsentPrompt({ candidate }: { candidate: MeetingCandidate }) {
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    await meetingStart(candidate.id);
    setBusy(false);
  };

  const dismiss = async () => {
    await meetingIgnore(candidate.id);
  };

  return (
    <div className="mi-consent-card">
      <div className="mi-consent-header">
        <span className="mi-consent-icon">
          <Brain size={15} aria-hidden="true" />
        </span>
        <div className="mi-consent-info">
          <span className="mi-consent-platform">
            <MeetingPlatformIcon source={candidate.source} size={12} />
            {meetingSourceDisplayName(candidate.source)} detected
          </span>
          {candidate.meetingTitle ? (
            <span className="mi-consent-title">{candidate.meetingTitle}</span>
          ) : null}
        </div>
      </div>

      <p className="mi-consent-body">
        Take notes for this meeting?
      </p>

      <div className="mi-consent-actions">
        <button
          type="button"
          className="mi-btn-accept"
          disabled={busy}
          onClick={() => void accept()}
        >
          Take Notes
        </button>
        <button
          type="button"
          className="mi-btn-dismiss"
          onClick={() => void dismiss()}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent meeting row
// ---------------------------------------------------------------------------

function RecentMeetingRow({ meeting }: { meeting: MeetingSession }) {
  return (
    <div className="mi-recent-row">
      <span className="mi-recent-icon">
        <MeetingPlatformIcon source={meeting.source} size={12} />
      </span>
      <div className="mi-recent-info">
        <span className="mi-recent-name">
          {meeting.meetingTitle ?? meetingSourceDisplayName(meeting.source)}
        </span>
        <span className="mi-recent-meta">
          {relativeMeetingTime(meeting.startedAt)}
          {meeting.endedAt ? ` · ${formatMeetingDuration(meeting.startedAt, meeting.endedAt)}` : ""}
          {meeting.summaryId ? (
            <>
              {" · "}
              <span className="mi-recent-has-notes">
                <CheckCircle size={10} aria-hidden="true" />
                Notes ready
              </span>
            </>
          ) : null}
        </span>
      </div>
      <button
        type="button"
        className="mi-recent-chevron"
        aria-label="View meeting notes"
        title="View meeting notes"
      >
        <ChevronRight size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform support row
// ---------------------------------------------------------------------------

/**
 * The supported platforms, always all of them.
 *
 * A detected platform gets a ring; the others are left alone. Hiding the rest
 * would make the header change shape whenever a call started, and which
 * platforms ArcSonare supports does not depend on which one is in use.
 */
function PlatformSupportRow({ detected }: { detected?: MeetingSourceId }) {
  const dashboardPlatforms = MEETING_PLATFORMS.filter((p) => p.showOnDashboard);
  return (
    <div className="mi-platform-row" aria-label="Supported meeting platforms">
      {dashboardPlatforms.map((platform) => {
        const isDetected = platform.id === detected;
        return (
          <span
            key={platform.id}
            className={`mi-platform-chip ${
              isDetected
                ? "is-detected"
                : platform.detectionAvailable
                  ? "is-active"
                  : "is-inactive"
            }`}
            title={
              isDetected
                ? `${platform.displayName} — meeting detected`
                : `${platform.displayName}${platform.detectionAvailable ? " — Detection active" : " — Coming soon"}`
            }
          >
            <MeetingPlatformIcon source={platform.id} size={20} />
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export function MeetingIntelligenceCard() {
  const activeMeeting = useActiveMeeting();
  const pendingCandidates = usePendingCandidates();
  const recentMeetings = useRecentMeetings(3);
  const backendAvailable = useMeetingBackendAvailable();

  // Show nothing (collapsed) if no backend and no recent meetings.
  if (!backendAvailable && recentMeetings.length === 0 && pendingCandidates.length === 0) {
    // Still show the card but in idle/setup state so the user knows the feature exists.
  }

  return (
    <section
      className="card sonare-card mi-card"
      aria-label="Meeting Intelligence"
      id="meeting-intelligence-card"
    >
      <div className="mi-card-header">
        <span className="card-label">Meeting Intelligence</span>
        {/* The detected platform is ringed; the rest stay put. */}
        <PlatformSupportRow
          detected={activeMeeting?.source ?? pendingCandidates[0]?.source}
        />
      </div>

      {/* Active meeting */}
      {activeMeeting && (
        <ActiveMeetingPanel meeting={activeMeeting} />
      )}

      {/* Consent prompts */}
      {pendingCandidates.length > 0 && (
        <div className="mi-consent-list">
          {pendingCandidates.map((candidate) => (
            <ConsentPrompt key={candidate.id} candidate={candidate} />
          ))}
        </div>
      )}

      {/* Recent meetings */}
      {recentMeetings.length > 0 ? (
        <div className="mi-recent-section">
          <span className="mi-recent-label">Recent meetings</span>
          <div className="mi-recent-list">
            {recentMeetings.map((m) => (
              <RecentMeetingRow key={m.id} meeting={m} />
            ))}
          </div>
        </div>
      ) : !activeMeeting && pendingCandidates.length === 0 ? (
        <div className="mi-idle-state">
          <Video size={20} className="mi-idle-icon" aria-hidden="true" />
          <p className="mi-idle-text">
            ArcSonare will ask before taking notes when a meeting is detected.
          </p>
        </div>
      ) : null}
    </section>
  );
}
