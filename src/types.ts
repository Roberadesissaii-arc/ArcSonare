/** UI animation phase of the overlay. */
export type OverlayPhase = "hidden" | "opening" | "visible" | "closing";

/** Emitted by Rust right after the native window is shown. */
export const EVENT_OPEN = "sonare:open";

/** Emitted by Rust when the overlay should animate out. */
export const EVENT_CLOSE = "sonare:close";
