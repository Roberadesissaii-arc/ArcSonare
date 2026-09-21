/**
 * Several deletions the user named in one breath are one question.
 *
 * "Delete these three test tasks" reaches the engine as one assistant turn
 * containing three `tasks.delete` calls, and the engine confirmed per call — so
 * the user was asked three times about a batch they had already enumerated
 * themselves. Asking once per item is not extra safety here; it is the same
 * question three times, and a user who has to answer it three times stops
 * reading it.
 *
 * What makes one question honest is that every item is named in it. This module
 * builds that list. It deliberately does not decide anything about risk — a
 * batch of deletions is still destructive, still confirmed, and still executed
 * item by item against the plan the user saw (`approval_plan.rs`, which owns
 * the enumeration and the exactly-once guarantee).
 */

import { getCapability } from "./capabilityRegistry";
import { permissionFor } from "./permissionPolicy";
import type { ParsedToolCall } from "./capabilityTypes";

export interface BatchItem {
  /** The tool call this row came from, so results map back to it. */
  toolCallId: string;
  capabilityId: string;
  arguments: Record<string, unknown>;
  /** Stable identity of the thing being acted on — a task id, a path. */
  resource: string;
  /** What the user reads in the list. */
  label: string;
}

export interface DeletionBatch {
  capabilityId: string;
  items: BatchItem[];
  /** The one sentence above the list. */
  summary: string;
}

/**
 * Argument keys that identify *what* an action targets, in preference order.
 *
 * Matching on a fixed list rather than "the first string argument" because the
 * first argument is often a query or a title, and two rows that differ only by
 * title would collapse into one if the wrong key were used as identity.
 */
const RESOURCE_KEYS = [
  "task_id",
  "taskId",
  "id",
  "path",
  "source_path",
  "target_path",
  "event_id",
  "message_id",
  "window_id",
  // Last, and only because `tasks.delete` accepts it instead of an id: the
  // model names tasks by title far more often than by id, and a batch that
  // could not group those would be the common case falling through to one
  // prompt per item. A title is a weaker identity than an id, which is why the
  // per-item execution still resolves it and reports each result separately.
  "title_query",
];

function resourceOf(args: Record<string, unknown>): string | null {
  for (const key of RESOURCE_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * A row's human label. Falls back to the resource so a row is never blank —
 * an unnamed item in a deletion list is worse than an ugly one.
 */
function labelOf(args: Record<string, unknown>, resource: string): string {
  for (const key of ["title", "name", "label", "query"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return resource;
}

/**
 * Find one batch in an assistant turn's tool calls.
 *
 * Constrained on purpose:
 *
 *  - the same capability throughout, so the sentence can describe them all;
 *  - that capability must be `always`-confirm, because batching is only
 *    interesting where every item would otherwise ask;
 *  - two or more items, since one item is already one question;
 *  - every item must resolve to a distinct resource, so the confirmation can
 *    name what it is deleting and the plan can enforce exactly-once. A call
 *    whose target cannot be identified is left to the per-call path rather
 *    than folded into a list under a vague label.
 */
export function findDeletionBatch(calls: ParsedToolCall[]): DeletionBatch | null {
  if (calls.length < 2) return null;

  const capabilityId = calls[0].capabilityId;
  if (!calls.every((c) => c.capabilityId === capabilityId)) return null;
  if (permissionFor(capabilityId).tier !== "always") return null;

  const items: BatchItem[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    const args = (call.arguments ?? {}) as Record<string, unknown>;
    const resource = resourceOf(args);
    // No identity, or the same thing twice: not a list the user can check.
    if (!resource || seen.has(resource)) return null;
    seen.add(resource);
    items.push({
      toolCallId: call.id,
      capabilityId,
      arguments: args,
      resource,
      label: labelOf(args, resource),
    });
  }

  return { capabilityId, items, summary: summarize(capabilityId, items) };
}

function summarize(capabilityId: string, items: BatchItem[]): string {
  const noun = getCapability(capabilityId)?.category === "tasks" ? "task" : "item";
  const plural = items.length === 1 ? noun : `${noun}s`;
  const verb = capabilityId.endsWith(".delete") ? "Delete" : "Run this on";
  return `${verb} these ${items.length} ${plural}?`;
}

/**
 * The confirmation the user sees: one sentence, every row named.
 *
 * Returns the affected items in the same order as the tool calls, because the
 * user reads them in that order and the results are reported in it.
 */
export function describeBatch(batch: DeletionBatch): {
  title: string;
  affectedItems: Array<{ name: string }>;
  description: string;
} {
  return {
    title: batch.summary,
    affectedItems: batch.items.map((i) => ({ name: i.label })),
    description:
      batch.items.length > 1
        ? "Only these will be affected. Anything else needs a new confirmation."
        : "",
  };
}
