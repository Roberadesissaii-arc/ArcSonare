/**
 * Session-only chat history for the Dashboard's "Chat" center-stage view.
 * Cleared on restart — no persistence.
 */
import { useSyncExternalStore } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
}

let messages: ChatMessage[] = [];

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pushUserMessage(text: string): string {
  const id = nextId();
  messages = [...messages, { id, role: "user", text }];
  notify();
  return id;
}

export function pushPendingAssistantMessage(): string {
  const id = nextId();
  messages = [...messages, { id, role: "assistant", text: "", pending: true }];
  notify();
  return id;
}

export function resolveAssistantMessage(id: string, text: string) {
  messages = messages.map((m) => (m.id === id ? { ...m, text, pending: false } : m));
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
