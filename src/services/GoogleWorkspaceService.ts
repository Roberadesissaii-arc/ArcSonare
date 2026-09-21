/**
 * Google Workspace reads (Gmail / Calendar / Drive).
 *
 * Thin bridge to the Rust commands in `google_api.rs`, which own the tokens and
 * the refresh cycle. Everything here returns text that is safe to show or speak
 * verbatim — callers must never fabricate content when `ok` is false.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * Native commands must not be able to hold the chat in "Thinking" forever.
 * This is deliberately longer than the Rust HTTP deadline so a normal token
 * refresh plus API read still has time to finish.
 */
const GOOGLE_COMMAND_TIMEOUT_MS = 30_000;

export interface GoogleReadResult {
  /** false = not connected or session expired. */
  ok: boolean;
  /** Human-readable summary, ready to display. */
  text: string;
  count: number;
}

/** Turn a thrown Tauri error into the same shape as a handled failure. */
function asFailure(err: unknown, fallback: string): GoogleReadResult {
  const message = err instanceof Error ? err.message : String(err ?? fallback);
  console.error("[ArcSonare] Google API call failed:", err);
  return { ok: false, text: message || fallback, count: 0 };
}

async function invokeGoogle(
  command: string,
  args: Record<string, unknown>,
  fallback: string,
): Promise<GoogleReadResult> {
  const startedAt = performance.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      invoke<GoogleReadResult>(command, args),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                "Google is taking too long to respond. Check your connection, then try again.",
              ),
            ),
          GOOGLE_COMMAND_TIMEOUT_MS,
        );
      }),
    ]);
    console.info(
      `[ArcSonare] ${command} completed in ${Math.round(performance.now() - startedAt)}ms`,
    );
    return result;
  } catch (err) {
    return asFailure(err, fallback);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function gmailListMessages(options?: {
  maxResults?: number;
  query?: string;
}): Promise<GoogleReadResult> {
  return invokeGoogle(
    "gmail_list_messages",
    {
      maxResults: options?.maxResults ?? null,
      query: options?.query ?? null,
    },
    "Could not read your Gmail.",
  );
}

export async function gmailReadMessage(messageId: string): Promise<GoogleReadResult> {
  return invokeGoogle(
    "gmail_read_message",
    { messageId },
    "Could not open that email.",
  );
}

export async function calendarListEvents(options?: {
  maxResults?: number;
  /** Inclusive start (RFC3339). Defaults to "now" on the Rust side if omitted. */
  timeMin?: string;
  timeMax?: string;
  /** Human label for empty copy, e.g. "August 8, 2026". */
  rangeLabel?: string;
}): Promise<GoogleReadResult> {
  return invokeGoogle(
    "calendar_list_events",
    {
      maxResults: options?.maxResults ?? null,
      timeMin: options?.timeMin ?? null,
      timeMax: options?.timeMax ?? null,
      rangeLabel: options?.rangeLabel ?? null,
    },
    "Could not read your calendar.",
  );
}

export async function calendarCreateEvent(input: {
  summary: string;
  start: string;
  end: string;
  description?: string;
}): Promise<GoogleReadResult> {
  return invokeGoogle(
    "calendar_create_event",
    {
      summary: input.summary,
      start: input.start,
      end: input.end,
      description: input.description ?? null,
    },
    "Could not add that to your calendar.",
  );
}

export async function driveListFiles(options?: {
  maxResults?: number;
  query?: string;
}): Promise<GoogleReadResult> {
  return invokeGoogle(
    "drive_list_files",
    {
      maxResults: options?.maxResults ?? null,
      query: options?.query ?? null,
    },
    "Could not read your Drive.",
  );
}

/** End of today, RFC3339 — for "what's on my calendar today". */
export function endOfTodayIso(): string {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

/** End of tomorrow, RFC3339. */
export function endOfTomorrowIso(): string {
  const end = new Date();
  end.setDate(end.getDate() + 1);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

// ------------------------------------------------------------ writing

export async function gmailSendMessage(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
}): Promise<GoogleReadResult> {
  return invoke<GoogleReadResult>("gmail_send_message", {
    to: input.to,
    subject: input.subject,
    body: input.body,
    cc: input.cc ?? null,
  });
}

export async function gmailCreateDraft(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
}): Promise<{ draft_id: string; summary: string }> {
  return invoke("gmail_create_draft", {
    to: input.to,
    subject: input.subject,
    body: input.body,
    cc: input.cc ?? null,
  });
}

export async function gmailUpdateDraft(input: {
  draftId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
}): Promise<{ draft_id: string; summary: string }> {
  return invoke("gmail_update_draft", {
    draftId: input.draftId,
    to: input.to,
    subject: input.subject,
    body: input.body,
    cc: input.cc ?? null,
  });
}

export async function gmailListDrafts(
  maxResults?: number,
): Promise<{ drafts: { draft_id: string; to: string; subject: string }[]; count: number }> {
  return invoke("gmail_list_drafts", { maxResults: maxResults ?? null });
}

export async function gmailReplyMessage(input: {
  messageId: string;
  body: string;
  replyAll?: boolean;
}): Promise<GoogleReadResult> {
  return invoke<GoogleReadResult>("gmail_reply_message", {
    messageId: input.messageId,
    body: input.body,
    replyAll: input.replyAll ?? false,
  });
}

export async function calendarUpdateEvent(input: {
  eventId: string;
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
}): Promise<GoogleReadResult> {
  return invoke<GoogleReadResult>("calendar_update_event", {
    eventId: input.eventId,
    summary: input.summary ?? null,
    start: input.start ?? null,
    end: input.end ?? null,
    description: input.description ?? null,
  });
}

export async function calendarDeleteEvent(eventId: string): Promise<GoogleReadResult> {
  return invoke<GoogleReadResult>("calendar_delete_event", { eventId });
}

export async function docsCreate(input: {
  title: string;
  markdown: string;
}): Promise<{ document_id: string; title: string; url: string; characters: number }> {
  return invoke("docs_create", { title: input.title, markdown: input.markdown });
}

export async function docsAppend(input: {
  documentId: string;
  markdown: string;
}): Promise<{ document_id: string; url: string; characters: number }> {
  return invoke("docs_append", {
    documentId: input.documentId,
    markdown: input.markdown,
  });
}

export async function docsList(
  maxResults?: number,
): Promise<{ files?: { id: string; name: string; webViewLink?: string }[] }> {
  return invoke("docs_list", { maxResults: maxResults ?? null });
}
