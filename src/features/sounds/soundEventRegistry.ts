import type { ReactNode } from "react";
import type { SoundEvent } from "../../config/prefs";

export interface SoundEventUiDef {
  id: SoundEvent;
  displayName: string;
  description: string;
  column: "left" | "right";
}

/** Primary Events Sounds grid (two columns). Other events still play via SoundService. */
export const EVENT_SOUND_UI: SoundEventUiDef[] = [
  {
    id: "overlay-open",
    displayName: "Voice open",
    description: "Soft rising glass tone when the overlay appears.",
    column: "left",
  },
  {
    id: "overlay-close",
    displayName: "Voice close",
    description: "Gentle descending counterpart when the overlay dismisses.",
    column: "left",
  },
  {
    id: "listening",
    displayName: "Listening",
    description: "Short violet shimmer when listening starts.",
    column: "left",
  },
  {
    id: "thinking",
    displayName: "Thinking",
    description: "Quiet rounded pulse while ArcSonare reasons.",
    column: "left",
  },
  {
    id: "responding",
    displayName: "Response",
    description: "Smooth opening tone as a reply starts.",
    column: "left",
  },
  {
    id: "task-completed",
    displayName: "Task done",
    description: "Warm confirmation when a task finishes.",
    column: "left",
  },
  {
    id: "confirmation",
    displayName: "Confirm",
    description: "Two gentle notes when approval is needed.",
    column: "right",
  },
  {
    id: "error",
    displayName: "Error",
    description: "Muted descending tone — never a harsh alarm.",
    column: "right",
  },
  {
    id: "notification",
    displayName: "Notification",
    description: "Clean neutral chime for new notifications.",
    column: "right",
  },
  {
    id: "screen-context-start",
    displayName: "Screen start",
    description: "Soft widening tone when Screen Context starts.",
    column: "right",
  },
  {
    id: "screen-context-stop",
    displayName: "Screen stop",
    description: "Gentle narrowing tone when Screen Context ends.",
    column: "right",
  },
  {
    id: "wake-word",
    displayName: "Wake word",
    description: "Bright shimmer when a wake word is recognized.",
    column: "right",
  },
];

export type EventIconMap = Record<SoundEvent, ReactNode>;
