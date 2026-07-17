/**
 * Structured / planner fallback when a model has no native tool calling.
 * Deterministic IntentClassifier is the primary path; this documents the
 * fallback contract for future lightweight planner models.
 */

import type { IntentContract } from "./IntentContract";
import { classifyIntent } from "./IntentClassifier";
import { mapIntentToCapability } from "./IntentCapabilityMap";

export type PlannerResult = {
  intent: IntentContract;
  requestedCapabilityId: string;
  arguments: Record<string, unknown>;
  confidence: number;
  source: "deterministic" | "structured-json" | "planner-model";
};

/** Always-available deterministic planner — no network. */
export function deterministicToolPlan(utterance: string): PlannerResult | null {
  const intent = classifyIntent(utterance);
  const capabilityId = mapIntentToCapability(intent);
  if (!capabilityId) return null;
  return {
    intent,
    requestedCapabilityId: capabilityId,
    arguments: {
      timeRange: intent.timeRange,
      filters: intent.filters,
      object: intent.object,
    },
    confidence: intent.confidence,
    source: "deterministic",
  };
}
