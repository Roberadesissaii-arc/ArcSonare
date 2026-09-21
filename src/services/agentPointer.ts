/**
 * Taking the purple agent pointer off the screen.
 *
 * Showing it, gliding it and clicking with it now happen in Rust, inside
 * `display::visual_commands` — the frontend no longer knows desktop
 * coordinates, so it cannot animate towards one. What is left here is the
 * interrupt: when the user cancels or the overlay closes mid-action, the
 * pointer has to go away, and that needs no coordinates at all.
 */
import { invoke } from "@tauri-apps/api/core";

export async function hideAgentPointer(): Promise<void> {
  try {
    await invoke("clear_visual_overlay");
  } catch {
    // Nothing to clear, or the window is already gone.
  }
}
