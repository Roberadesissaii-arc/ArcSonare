/**
 * Capability → Realtime tool schema.
 *
 * Kept separate from the dispatch side so the tool list can be built (and
 * tested) without pulling in the capability engine and everything it imports.
 */

import { capabilitiesForOrigin } from "../../features/capabilities/connectorRegistry";
import type { IntegrationId } from "../../config/iconRegistry";
import { toToolName } from "../../features/capabilities/providerToolAdapter";
import type { WatchedApplication } from "../../features/watch/watchTypes";

/** Realtime GA tool shape — flat, unlike Chat Completions' nested `function`. */
export interface RealtimeTool {
  type: "function";
  name: string;
  description: string;
  parameters: unknown;
}

/**
 * Capabilities the model may call. Only voice-capable, available ones — a tool
 * the model can see but not use is a tool it will try anyway.
 */
export function buildRealtimeTools(
  /**
   * Connectors with a live credential. Voice used to filter on its own inline
   * predicate that ignored this entirely, so it advertised Gmail tools with
   * Gmail disconnected — and then had to deny a tool it had just offered.
   */
  connectedConnectors: ReadonlySet<IntegrationId> = new Set(),
  /**
   * Watched applications that are live right now.
   *
   * Same gate, same reason: `spotify.play` offered with Spotify closed is a
   * tool the model will call and cannot succeed at. Defaults to none, so a
   * caller that forgets to pass this offers no watched-app tools rather than
   * offering all of them.
   */
  watchedApplications: WatchedApplication[] = [],
): RealtimeTool[] {
  // Forwarded, not re-filtered. A second filter here would be a second
  // allowlist, and two allowlists drift — which is how voice came to advertise
  // Gmail tools with Gmail disconnected.
  return capabilitiesForOrigin("voice", connectedConnectors, watchedApplications)
    .map((cap) => ({
      type: "function" as const,
      name: toToolName(cap.id),
      description: cap.description,
      parameters: cap.inputSchema,
    }));
}

/**
 * Voices the Realtime API accepts. An unknown voice makes the session request
 * fail outright, so character definitions are validated against this list
 * rather than trusted.
 */
export const REALTIME_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
]);

/** Falls back to the default voice rather than failing the whole session. */
export function resolveRealtimeVoice(voiceId: string | undefined): string {
  return voiceId && REALTIME_VOICES.has(voiceId) ? voiceId : "marin";
}
