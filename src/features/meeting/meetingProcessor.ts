/**
 * Meeting processor — AI-powered summary, decision, and action item extraction.
 *
 * Called after a meeting ends (or periodically during for live notes).
 * Uses the Gemini API (already configured in the project) to generate structured
 * notes from the transcript.
 *
 * Owned by Agent 3.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  MeetingSession,
  MeetingTranscriptSegment,
  MeetingSummary,
  MeetingActionItem,
  MeetingDecision,
} from "./meetingTypes";

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

function buildExtractionPrompt(
  session: MeetingSession,
  segments: MeetingTranscriptSegment[],
): string {
  const transcript = segments.map((s) => {
    const speaker = s.speakerLabel ? `${s.speakerLabel}: ` : "";
    return `${speaker}${s.text}`;
  }).join("\n");

  const platform = session.sourceApplication;
  const title = session.meetingTitle ?? "Untitled Meeting";
  const duration = Math.round(
    (new Date(session.endedAt ?? new Date().toISOString()).getTime() -
      new Date(session.startedAt).getTime()) / 60_000,
  );

  return `You are a meeting notes AI. Analyze the following ${platform} meeting transcript and extract structured information.

Meeting: ${title}
Duration: ${duration} minutes

TRANSCRIPT:
${transcript || "(No transcript available — generate notes from context only)"}

Extract and return a JSON object with EXACTLY this structure:
{
  "title": "Short descriptive meeting title",
  "overview": "2-3 sentence executive summary of what was discussed and decided",
  "decisions": [
    { "text": "Decision made in the meeting", "uncertain": false }
  ],
  "actionItems": [
    { "text": "Specific action item", "owner": "Person name or null", "dueDate": "YYYY-MM-DD or null" }
  ],
  "questions": [
    { "text": "Question raised", "answeredInMeeting": true }
  ],
  "followUps": ["Topic that needs follow-up after meeting"],
  "risks": ["Risk or concern mentioned"],
  "topics": ["Main topic discussed"],
  "mentionedPeople": ["Names mentioned"],
  "mentionedProjects": ["Project or product names"]
}

Rules:
- Be specific and concrete, not generic.
- Only include items that were actually discussed.
- If the transcript is empty, generate minimal useful notes based on the meeting title.
- Return ONLY valid JSON, no markdown.`;
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processMeeting(
  session: MeetingSession,
  segments: MeetingTranscriptSegment[],
): Promise<MeetingSummary | null> {
  const prompt = buildExtractionPrompt(session, segments);

  try {
    // Use Gemini (already configured in ArcSonare).
    const responseText = await invoke<string>("gemini_chat", {
      messages: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: null,
      model: null,
    });

    return parseSummaryResponse(responseText, session.id, segments);
  } catch (err) {
    console.error("[ArcSonare] Meeting processing failed:", err);

    // Return a minimal summary when AI is unavailable.
    return buildFallbackSummary(session);
  }
}

function parseSummaryResponse(
  responseText: string,
  meetingId: string,
  segments: MeetingTranscriptSegment[],
): MeetingSummary {
  // Strip markdown fences if present.
  const clean = responseText
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  type RawSummary = {
    title?: string;
    overview?: string;
    decisions?: Array<{ text?: string; uncertain?: boolean }>;
    actionItems?: Array<{ text?: string; owner?: string; dueDate?: string }>;
    questions?: Array<{ text?: string; answeredInMeeting?: boolean }>;
    followUps?: string[];
    risks?: string[];
    topics?: string[];
    mentionedPeople?: string[];
    mentionedProjects?: string[];
  };

  let raw: RawSummary = {};
  try {
    raw = JSON.parse(clean) as RawSummary;
  } catch {
    raw = {};
  }

  const segIds = segments.map((s) => s.id);

  const decisions: MeetingDecision[] = (raw.decisions ?? []).map((d, i) => ({
    id: `decision-${meetingId}-${i}`,
    meetingId,
    text: d.text ?? "",
    confidence: 0.85,
    sourceSegmentIds: segIds,
    uncertain: d.uncertain ?? false,
  }));

  const actionItems: MeetingActionItem[] = (raw.actionItems ?? []).map((a, i) => ({
    id: `action-${meetingId}-${i}`,
    meetingId,
    text: a.text ?? "",
    owner: a.owner ?? undefined,
    dueDate: a.dueDate ?? undefined,
    confidence: 0.8,
    sourceSegmentIds: segIds,
    status: "pending",
  }));

  return {
    meetingId,
    title: raw.title ?? "Meeting Notes",
    overview: raw.overview ?? "",
    decisions,
    actionItems,
    questions: (raw.questions ?? []).map((q, i) => ({
      id: `q-${meetingId}-${i}`,
      meetingId,
      text: q.text ?? "",
      answeredInMeeting: q.answeredInMeeting ?? false,
    })),
    followUps: raw.followUps ?? [],
    risks: raw.risks ?? [],
    topics: raw.topics ?? [],
    mentionedPeople: raw.mentionedPeople ?? [],
    mentionedProjects: raw.mentionedProjects ?? [],
    generatedAt: new Date().toISOString(),
    modelProvenance: "gemini",
  };
}

function buildFallbackSummary(session: MeetingSession): MeetingSummary {
  return {
    meetingId: session.id,
    title: session.meetingTitle ?? `${session.sourceApplication} Meeting`,
    overview: `${session.sourceApplication} meeting${session.meetingTitle ? ` — ${session.meetingTitle}` : ""}. Notes could not be generated automatically.`,
    decisions: [],
    actionItems: [],
    questions: [],
    followUps: [],
    risks: [],
    topics: [],
    mentionedPeople: [],
    mentionedProjects: [],
    generatedAt: new Date().toISOString(),
    modelProvenance: "fallback",
  };
}

// ---------------------------------------------------------------------------
// Action item → Task conversion
// ---------------------------------------------------------------------------

export async function convertActionItemToTask(
  actionItem: MeetingActionItem,
  meetingTitle?: string,
): Promise<string | null> {
  try {
    // Import task creation dynamically to avoid circular deps.
    const { addTask } = await import("../../stores/taskStore");
    const task = addTask({
      title: actionItem.text,
      note: meetingTitle
        ? `From meeting: ${meetingTitle}`
        : "Extracted from meeting notes",
      priority: "medium",
      urgent: false,
      dueBucket: "upcoming",
    });
    return task.id;
  } catch (err) {
    console.error("[ArcSonare] Failed to create task from action item:", err);
    return null;
  }
}
