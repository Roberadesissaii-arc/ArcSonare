/**
 * Session-only chat history for the Dashboard's "Chat" center-stage view.
 * Cleared on restart — no persistence.
 */
import { useSyncExternalStore } from "react";
import type {
  ResponseAction,
  ResponseSource,
} from "../features/conversation/responsePlan";
import type { ResponseProvenance } from "../features/capabilities/executionTrace";
import type { ResultItem } from "../features/conversation/conversationContext";
import {
  reduceStatus,
  thoughtSteps,
  type StatusEvent,
} from "../features/chat/statusReducer";

/** One watched application credited on a message. */
export interface WatchedSourceRef {
  appCatalogId: string;
  displayName: string;
  /** Workspace or window, when it distinguishes this instance. */
  detail?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  /** Shown as a chip beside the bubble instead of being appended to `text`. */
  attachment?: { name: string; dataUrl?: string };
  /** Composer mode active when sent — rendered as a small labelled chip. */
  mode?: "search" | "browser" | "reasoning" | "watch";
  /**
   * Developer provenance: which model answered and which tool ran. Never
   * rendered in normal chat — `resultSource` is what the user sees.
   */
  source?: { label: string; tool?: string };
  /** Friendly footer: a local source icon and a plain-language result label. */
  resultSource?: ResponseSource;
  /**
   * Watched applications attached to this message.
   *
   * On a user message: the scope the message was sent with, captured at send
   * time so the badge stays true if the scope changes afterwards. On an
   * assistant message: the applications the answer actually came from — absent
   * when watched context did not contribute, so the badge keeps meaning
   * something.
   *
   * Structured metadata, deliberately never appended to `text`: it must not
   * reach the model as if the user had typed it.
   */
  watchedSources?: WatchedSourceRef[];
  /** At most two one-click follow-ups, each bound to a real capability. */
  actions?: ResponseAction[];
  /** Screenshot to render inline, so "here's the screenshot" is truthful. */
  captureId?: string;
  /**
   * Browser-mode extracted images (YouTube thumbnails, og:image, etc.).
   * Remote https URLs or data URLs — shown under the bubble text.
   */
  images?: string[];
  /**
   * The single live progress line while pending. One line, never a history —
   * an accumulating list of "Thinking / Working" reads as a debug console.
   */
  status?: string;
  /** Raw events, kept so the reduction can be recomputed as they arrive. */
  statusEvents?: StatusEvent[];
  /**
   * What this turn actually did, past tense, for the collapsed Thought row.
   * Survives the transition to the final answer — the same message shows both.
   */
  thought?: string[];
  /** Developer-only answer provenance. Never rendered in a release build. */
  diagnostics?: ResponseProvenance;
  /** Structured results shown inline, so the browser is not the answer. */
  results?: ResultItem[];
}

let messages: ChatMessage[] = [];

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pushUserMessage(
  text: string,
  extras?: Pick<ChatMessage, "attachment" | "mode" | "watchedSources">,
): string {
  const id = nextId();
  messages = [...messages, { id, role: "user", text, ...extras }];
  notify();
  return id;
}

export function pushPendingAssistantMessage(): string {
  const id = nextId();
  messages = [...messages, { id, role: "assistant", text: "", pending: true }];
  notify();
  return id;
}

export function resolveAssistantMessage(
  id: string,
  text: string,
  extras?: Pick<
    ChatMessage,
    | "source"
    | "resultSource"
    | "actions"
    | "captureId"
    | "images"
    | "diagnostics"
    | "results"
    | "watchedSources"
  >,
) {
  messages = messages.map((m) =>
    m.id === id
      ? {
          ...m,
          text,
          pending: false,
          status: undefined,
          // The Thinking row becomes a Thought row in the same message rather
          // than vanishing, so the user sees that the thinking became this.
          thought: thoughtSteps(reduceStatus(m.statusEvents ?? []).steps),
          source: extras?.source ?? m.source,
          resultSource: extras?.resultSource ?? m.resultSource,
          actions: extras?.actions ?? m.actions,
          captureId: extras?.captureId ?? m.captureId,
          images: extras?.images ?? m.images,
          diagnostics: extras?.diagnostics ?? m.diagnostics,
          results: extras?.results ?? m.results,
          // Accepted in `extras` but never copied here, so the earned badge
          // could not render at all: the only Watch badge the user ever saw was
          // the one the composer stamped on the *question* from standing scope,
          // which is exactly the one that turned up on unrelated file requests.
          watchedSources: extras?.watchedSources ?? m.watchedSources,
        }
      : m,
  );
  notify();
}

/**
 * Record a progress event and re-derive what the bubble shows.
 *
 * Events accumulate; the *view* does not. Repeats collapse, generic waiting
 * never becomes a step, and only the current line is live.
 */
export function setAssistantMessageStatus(
  id: string,
  status: string,
  capabilityId?: string,
) {
  messages = messages.map((m) => {
    if (m.id !== id) return m;
    const statusEvents = [...(m.statusEvents ?? []), { message: status, capabilityId }];
    const reduced = reduceStatus(statusEvents);
    return { ...m, statusEvents, status: reduced.current };
  });
  notify();
}

/** Puts an already-resolved assistant bubble back into the typing state — used by regenerate. */
export function markAssistantMessagePending(id: string) {
  messages = messages.map((m) => (m.id === id ? { ...m, text: "", pending: true } : m));
  notify();
}

/** Appends a streamed chunk, switching the bubble out of the typing-dots state. */
export function appendAssistantMessageChunk(id: string, delta: string) {
  messages = messages.map((m) =>
    m.id === id ? { ...m, text: m.text + delta, pending: false } : m,
  );
  notify();
}

export function clearChatHistory() {
  messages = [];
  notify();
}

export function getChatMessages(): ChatMessage[] {
  return messages;
}

export function useChatMessages(): ChatMessage[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => messages,
  );
}
