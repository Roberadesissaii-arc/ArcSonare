/**
 * Frontend executors for connected Google services (Gmail / Calendar / Drive).
 * Used by chat tools and OpenAI Realtime voice tools.
 */
import type { ToolResult, ToolResultStatus } from "./capabilityTypes";
import {
  calendarCreateEvent,
  calendarDeleteEvent,
  calendarListEvents,
  calendarUpdateEvent,
  docsAppend,
  docsCreate,
  docsList,
  driveListFiles,
  endOfTodayIso,
  gmailCreateDraft,
  gmailListDrafts,
  gmailListMessages,
  gmailReadMessage,
  gmailReplyMessage,
  gmailSendMessage,
  gmailUpdateDraft,
} from "../../services/GoogleWorkspaceService";
import {
  getConnectedIntegrationIds,
  syncConnectionBrokerFromIntegrations,
} from "../../services/integrationStatusService";

function nowIso(): string {
  return new Date().toISOString();
}

function result(
  capabilityId: string,
  startedAt: string,
  status: ToolResultStatus,
  summary: string,
  extras: Partial<ToolResult> = {},
): ToolResult {
  const completedAt = nowIso();
  return {
    callId: `gcall-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    capabilityId,
    status,
    summary,
    evidence: extras.evidence ?? { verified: true, method: "return-code" },
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    ...extras,
  };
}

async function ensureBrokerSynced(): Promise<void> {
  await syncConnectionBrokerFromIntegrations().catch(() => undefined);
}

async function isGoogleConnected(
  kind: "gmail" | "googleCalendar" | "googleDrive",
): Promise<boolean> {
  await ensureBrokerSynced();
  const ids = await getConnectedIntegrationIds().catch(() => new Set());
  return ids.has(kind);
}

export async function executeGoogleWorkspaceCapability(
  capabilityId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const startedAt = nowIso();

  switch (capabilityId) {
    case "email.get_connection_status": {
      const ok = await isGoogleConnected("gmail");
      return result(
        capabilityId,
        startedAt,
        "success",
        ok
          ? "Yes — Gmail is connected to ArcSonare."
          : "No — Gmail isn’t connected. Open Connect and sign in with Google.",
        { data: { connected: ok, service: "gmail" } },
      );
    }
    case "calendar.get_connection_status": {
      const ok = await isGoogleConnected("googleCalendar");
      return result(
        capabilityId,
        startedAt,
        "success",
        ok
          ? "Yes — Google Calendar is connected to ArcSonare."
          : "No — Google Calendar isn’t connected. Open Connect and sign in with Google.",
        { data: { connected: ok, service: "calendar" } },
      );
    }
    case "drive.get_connection_status": {
      const ok = await isGoogleConnected("googleDrive");
      return result(
        capabilityId,
        startedAt,
        "success",
        ok
          ? "Yes — Google Drive is connected to ArcSonare."
          : "No — Google Drive isn’t connected. Open Connect and sign in with Google.",
        { data: { connected: ok, service: "drive" } },
      );
    }
    case "email.send_message": {
      const to = String(args.to ?? "").trim();
      const subject = String(args.subject ?? "").trim();
      const body = String(args.body ?? "");
      if (!to) {
        return result(capabilityId, startedAt, "error", "Who should I send it to?", {
          error: { code: "invalid-arguments", message: "to is required", recoverable: true },
        });
      }
      const res = await gmailSendMessage({
        to,
        subject,
        body,
        cc: typeof args.cc === "string" ? args.cc : undefined,
      });
      return result(capabilityId, startedAt, res.ok ? "success" : "error", res.text, {
        data: { to, subject },
        evidence: { verified: res.ok, method: "gmail-api" },
      });
    }
    case "email.create_draft": {
      const draft = await gmailCreateDraft({
        to: String(args.to ?? "").trim(),
        subject: String(args.subject ?? "").trim(),
        body: String(args.body ?? ""),
        cc: typeof args.cc === "string" ? args.cc : undefined,
      });
      return result(capabilityId, startedAt, "success", draft.summary, {
        data: draft,
        evidence: { verified: true, method: "gmail-api" },
      });
    }
    case "email.update_draft": {
      const updated = await gmailUpdateDraft({
        draftId: String(args.draft_id ?? ""),
        to: String(args.to ?? "").trim(),
        subject: String(args.subject ?? "").trim(),
        body: String(args.body ?? ""),
        cc: typeof args.cc === "string" ? args.cc : undefined,
      });
      return result(capabilityId, startedAt, "success", updated.summary, {
        data: updated,
        evidence: { verified: true, method: "gmail-api" },
      });
    }
    case "email.list_drafts": {
      const drafts = await gmailListDrafts(
        typeof args.max_results === "number" ? args.max_results : 20,
      );
      const summary = drafts.count
        ? `You have ${drafts.count} draft${drafts.count === 1 ? "" : "s"}.`
        : "You have no drafts.";
      return result(capabilityId, startedAt, "success", summary, {
        data: drafts,
        evidence: { verified: true, method: "gmail-api" },
      });
    }
    case "email.reply": {
      const res = await gmailReplyMessage({
        messageId: String(args.message_id ?? ""),
        body: String(args.body ?? ""),
        replyAll: args.reply_all === true,
      });
      return result(capabilityId, startedAt, res.ok ? "success" : "error", res.text, {
        evidence: { verified: res.ok, method: "gmail-api" },
      });
    }
    case "calendar.update_event": {
      const res = await calendarUpdateEvent({
        eventId: String(args.event_id ?? ""),
        summary: typeof args.summary === "string" ? args.summary : undefined,
        start: typeof args.start === "string" ? args.start : undefined,
        end: typeof args.end === "string" ? args.end : undefined,
        description: typeof args.description === "string" ? args.description : undefined,
      });
      return result(capabilityId, startedAt, res.ok ? "success" : "error", res.text, {
        evidence: { verified: res.ok, method: "calendar-api" },
      });
    }
    case "calendar.delete_event": {
      const res = await calendarDeleteEvent(String(args.event_id ?? ""));
      return result(capabilityId, startedAt, res.ok ? "success" : "error", res.text, {
        evidence: { verified: res.ok, method: "calendar-api" },
      });
    }
    case "docs.create": {
      const doc = await docsCreate({
        title: String(args.title ?? "").trim(),
        markdown: String(args.markdown ?? ""),
      });
      return result(
        capabilityId,
        startedAt,
        "success",
        `Created "${doc.title}" in Google Docs.`,
        { data: doc, evidence: { verified: true, method: "docs-api" } },
      );
    }
    case "docs.append": {
      const doc = await docsAppend({
        documentId: String(args.document_id ?? ""),
        markdown: String(args.markdown ?? ""),
      });
      return result(capabilityId, startedAt, "success", "Added that to the document.", {
        data: doc,
        evidence: { verified: true, method: "docs-api" },
      });
    }
    case "docs.list": {
      const listed = await docsList(
        typeof args.max_results === "number" ? args.max_results : 20,
      );
      const files = listed.files ?? [];
      return result(
        capabilityId,
        startedAt,
        "success",
        files.length ? `You have ${files.length} recent documents.` : "No documents found.",
        { data: { files }, evidence: { verified: true, method: "drive-api" } },
      );
    }
    case "email.list_messages": {
      if (!(await isGoogleConnected("gmail"))) {
        return result(
          capabilityId,
          startedAt,
          "denied",
          "Gmail isn’t connected, so I can’t read your mail. Open Connect and sign in with Google.",
          {
            error: {
              code: "not-connected",
              message: "Gmail not connected",
              recoverable: true,
              userAction: "Connect Gmail in Connect",
            },
          },
        );
      }
      const maxResults =
        typeof args.max_results === "number" ? args.max_results : 8;
      const query =
        typeof args.query === "string" && args.query.trim()
          ? args.query.trim()
          : undefined;
      const res = await gmailListMessages({ maxResults, query });
      if (!res.ok) {
        return result(capabilityId, startedAt, "error", res.text, {
          error: {
            code: "gmail-read-failed",
            message: res.text,
            recoverable: true,
          },
        });
      }
      return result(capabilityId, startedAt, "success", res.text, {
        data: { count: res.count, text: res.text },
        evidence: { verified: true, method: "return-code" },
      });
    }
    case "email.read_message": {
      if (!(await isGoogleConnected("gmail"))) {
        return result(
          capabilityId,
          startedAt,
          "denied",
          "Gmail isn’t connected, so I can’t open that message.",
        );
      }
      const messageId = String(args.message_id ?? "").trim();
      if (!messageId) {
        return result(capabilityId, startedAt, "error", "message_id is required.", {
          error: {
            code: "invalid-arguments",
            message: "message_id required",
            recoverable: true,
          },
        });
      }
      const res = await gmailReadMessage(messageId);
      if (!res.ok) {
        return result(capabilityId, startedAt, "error", res.text, {
          error: {
            code: "gmail-read-failed",
            message: res.text,
            recoverable: true,
          },
        });
      }
      return result(capabilityId, startedAt, "success", res.text, {
        data: { text: res.text },
      });
    }
    case "calendar.list_events": {
      if (!(await isGoogleConnected("googleCalendar"))) {
        return result(
          capabilityId,
          startedAt,
          "denied",
          "Google Calendar isn’t connected, so I can’t read your schedule. Open Connect and sign in with Google.",
        );
      }
      const maxResults =
        typeof args.max_results === "number" ? args.max_results : 10;
      const timeMin =
        typeof args.time_min === "string" ? args.time_min : undefined;
      const timeMax =
        typeof args.time_max === "string"
          ? args.time_max
          : // Default: through end of today when no range given
            undefined;
      const rangeLabel =
        typeof args.range_label === "string" ? args.range_label : undefined;
      // If user didn't pass a range, still give a sensible window (now → end of day).
      const res = await calendarListEvents({
        maxResults,
        timeMin,
        timeMax: timeMax ?? (!timeMin ? endOfTodayIso() : undefined),
        rangeLabel: rangeLabel ?? (!timeMin ? "today" : undefined),
      });
      if (!res.ok) {
        return result(capabilityId, startedAt, "error", res.text, {
          error: {
            code: "calendar-read-failed",
            message: res.text,
            recoverable: true,
          },
        });
      }
      return result(capabilityId, startedAt, "success", res.text, {
        data: { count: res.count, text: res.text },
      });
    }
    case "calendar.create_event": {
      if (!(await isGoogleConnected("googleCalendar"))) {
        return result(
          capabilityId,
          startedAt,
          "denied",
          "Google Calendar isn’t connected, so I can’t create an event.",
        );
      }
      const summary = String(args.summary ?? "").trim();
      const start = String(args.start ?? "").trim();
      const end = String(args.end ?? "").trim();
      const description =
        typeof args.description === "string" ? args.description : undefined;
      if (!summary || !start || !end) {
        return result(
          capabilityId,
          startedAt,
          "error",
          "I need a title, start time, and end time to create a calendar event.",
          {
            error: {
              code: "invalid-arguments",
              message: "summary, start, end required",
              recoverable: true,
            },
          },
        );
      }
      const res = await calendarCreateEvent({
        summary,
        start,
        end,
        description,
      });
      if (!res.ok) {
        return result(capabilityId, startedAt, "error", res.text, {
          error: {
            code: "calendar-create-failed",
            message: res.text,
            recoverable: true,
          },
        });
      }
      return result(capabilityId, startedAt, "success", res.text, {
        data: { text: res.text },
      });
    }
    case "drive.list_files": {
      if (!(await isGoogleConnected("googleDrive"))) {
        return result(
          capabilityId,
          startedAt,
          "denied",
          "Google Drive isn’t connected, so I can’t list your files.",
        );
      }
      const maxResults =
        typeof args.max_results === "number" ? args.max_results : 10;
      const query =
        typeof args.query === "string" && args.query.trim()
          ? args.query.trim()
          : undefined;
      const res = await driveListFiles({ maxResults, query });
      if (!res.ok) {
        return result(capabilityId, startedAt, "error", res.text, {
          error: {
            code: "drive-read-failed",
            message: res.text,
            recoverable: true,
          },
        });
      }
      return result(capabilityId, startedAt, "success", res.text, {
        data: { count: res.count, text: res.text },
      });
    }
    default:
      return result(
        capabilityId,
        startedAt,
        "error",
        `"${capabilityId}" is not a Google workspace tool.`,
        {
          error: {
            code: "unknown-capability",
            message: capabilityId,
            recoverable: false,
          },
        },
      );
  }
}

export function isGoogleWorkspaceCapability(id: string): boolean {
  return (
    id.startsWith("email.") ||
    id.startsWith("calendar.") ||
    id.startsWith("drive.")
  );
}
