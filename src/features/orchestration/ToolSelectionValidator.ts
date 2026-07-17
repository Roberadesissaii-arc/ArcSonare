/**
 * Validates proposed tool calls against the IntentContract.
 */

import type { IntentContract } from "./IntentContract";
import {
  allowedCapabilitiesFor,
  getCapability,
  mapIntentToCapability,
} from "./IntentCapabilityMap";

export type ValidationResult =
  | { ok: true; capabilityId: string }
  | {
      ok: false;
      reason: string;
      correctedCapabilityId?: string;
      proposedTool: string;
    };

/**
 * Validate a model-proposed capability against the contract.
 * May suggest a deterministic correction (e.g. open_ui → list_events for reads).
 */
export function validateToolSelection(
  contract: IntentContract,
  proposedCapabilityId: string,
): ValidationResult {
  const proposed = getCapability(proposedCapabilityId);
  const expected = mapIntentToCapability(contract) ?? contract.capabilityId;
  const allowed = allowedCapabilitiesFor(contract).map((c) => c.id);

  if (!proposed) {
    return {
      ok: false,
      reason: `Unknown capability “${proposedCapabilityId}”.`,
      correctedCapabilityId: expected,
      proposedTool: proposedCapabilityId,
    };
  }

  if (proposed.domain !== contract.domain) {
    return {
      ok: false,
      reason: `Domain mismatch: intent is ${contract.domain}, tool is ${proposed.domain}.`,
      correctedCapabilityId: expected,
      proposedTool: proposedCapabilityId,
    };
  }

  // Read intent must never execute open_ui tools
  if (
    (contract.mode === "read" ||
      contract.mode === "search" ||
      contract.mode === "summarize") &&
    proposed.id.endsWith(".open_ui")
  ) {
    return {
      ok: false,
      reason: "Open UI tools are forbidden for read/search/summarize intents.",
      correctedCapabilityId: expected,
      proposedTool: proposedCapabilityId,
    };
  }

  // Draft must never become send
  if (contract.mode === "draft" && proposed.id.includes("send")) {
    return {
      ok: false,
      reason: "Send tools are forbidden for draft intents.",
      correctedCapabilityId: expected,
      proposedTool: proposedCapabilityId,
    };
  }

  // Open without explicitOpen for data domains is rejected when mode isn't open
  if (
    !contract.explicitOpen &&
    (proposed.id.endsWith(".open_ui") || proposed.id === "applications.open") &&
    contract.mode !== "open" &&
    contract.mode !== "navigate" &&
    contract.mode !== "focus"
  ) {
    return {
      ok: false,
      reason: "Explicit open verb required for open tools.",
      correctedCapabilityId: expected,
      proposedTool: proposedCapabilityId,
    };
  }

  // Specific-resource open: prefer open_event / open_message over generic open_ui
  if (
    (contract.object === "event" || contract.requestedData?.includes("next")) &&
    proposed.id === "calendar.open_ui"
  ) {
    return {
      ok: false,
      reason: "Use calendar.open_event for a specific meeting, not calendar.open_ui.",
      correctedCapabilityId: expected ?? "calendar.open_event",
      proposedTool: proposedCapabilityId,
    };
  }
  if (
    (contract.object === "message" || contract.requestedData?.includes("latest")) &&
    proposed.id === "email.open_inbox_ui" &&
    contract.mode === "open"
  ) {
    return {
      ok: false,
      reason: "Use email.open_message for a specific message, not email.open_inbox_ui.",
      correctedCapabilityId: expected ?? "email.open_message",
      proposedTool: proposedCapabilityId,
    };
  }

  if (!proposed.modes.includes(contract.mode) && !allowed.includes(proposed.id)) {
    return {
      ok: false,
      reason: `Capability ${proposed.id} does not support mode ${contract.mode}.`,
      correctedCapabilityId: expected,
      proposedTool: proposedCapabilityId,
    };
  }

  // Side-effect escalation
  if (
    (contract.sideEffect === "read-only" || contract.sideEffect === "none") &&
    (proposed.sideEffect === "external-write" ||
      proposed.sideEffect === "destructive" ||
      proposed.sideEffect === "privileged")
  ) {
    return {
      ok: false,
      reason: "Side-effect class escalation is not allowed.",
      correctedCapabilityId: expected,
      proposedTool: proposedCapabilityId,
    };
  }

  if (allowed.length && !allowed.includes(proposed.id) && proposed.id !== expected) {
    return {
      ok: false,
      reason: `Capability ${proposed.id} is not in the allowed set for this intent.`,
      correctedCapabilityId: expected,
      proposedTool: proposedCapabilityId,
    };
  }

  return { ok: true, capabilityId: proposed.id };
}

/** Apply local correction when validation fails but a corrected id is known. */
export function correctToolSelection(
  contract: IntentContract,
  proposedCapabilityId: string,
): { capabilityId: string; correction?: { proposedTool: string; correctedTool: string; reason: string } } {
  const result = validateToolSelection(contract, proposedCapabilityId);
  if (result.ok) return { capabilityId: result.capabilityId };
  const corrected =
    result.correctedCapabilityId ?? mapIntentToCapability(contract);
  if (!corrected) {
    return { capabilityId: proposedCapabilityId };
  }
  return {
    capabilityId: corrected,
    correction: {
      proposedTool: proposedCapabilityId,
      correctedTool: corrected,
      reason: result.reason,
    },
  };
}
