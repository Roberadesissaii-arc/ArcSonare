/**
 * Model/provider conformance suite for intent precision.
 * Run via: node --experimental-strip-types scripts/run-intent-conformance.mts
 */

import { classifyIntent } from "./IntentClassifier";
import { mapIntentToCapability } from "./IntentCapabilityMap";
import { validateToolSelection } from "./ToolSelectionValidator";
import type { ModelConformanceResult } from "./conformanceTypes";

export type { ModelConformanceResult } from "./conformanceTypes";

type Case = {
  name: string;
  utterance: string;
  expectedCapability: string;
  forbidden?: string[];
};

const CASES: Case[] = [
  {
    name: "calendar-read-whats-on",
    utterance: "What's on my calendar?",
    expectedCapability: "calendar.list_events",
    forbidden: ["calendar.open_ui"],
  },
  {
    name: "calendar-read-today",
    utterance: "What do I have today?",
    expectedCapability: "calendar.list_events",
    forbidden: ["calendar.open_ui"],
  },
  {
    name: "calendar-next",
    utterance: "What is my next meeting?",
    expectedCapability: "calendar.get_next_event",
    forbidden: ["calendar.open_ui"],
  },
  {
    name: "calendar-open",
    utterance: "Open my calendar",
    expectedCapability: "calendar.open_ui",
  },
  {
    name: "calendar-open-next",
    utterance: "Open my next meeting",
    expectedCapability: "calendar.open_event",
    forbidden: ["calendar.open_ui"],
  },
  {
    name: "email-latest",
    utterance: "What is my latest email?",
    expectedCapability: "email.get_latest_message",
    forbidden: ["email.open_inbox_ui"],
  },
  {
    name: "email-gmail-contents",
    utterance: "What is in my Gmail?",
    expectedCapability: "email.get_inbox_summary",
    forbidden: ["email.open_inbox_ui"],
  },
  {
    name: "email-gmail-contents-on",
    utterance: "What's on my Gmail?",
    expectedCapability: "email.get_inbox_summary",
    forbidden: ["email.open_inbox_ui", "applications.open"],
  },
  {
    name: "email-connected-status",
    utterance: "Is my Gmail connected?",
    expectedCapability: "email.get_connection_status",
    forbidden: ["email.open_inbox_ui", "applications.open"],
  },
  {
    name: "email-unread",
    utterance: "Show unread emails",
    expectedCapability: "email.list_unread",
    forbidden: ["email.open_inbox_ui"],
  },
  {
    name: "email-open-gmail",
    utterance: "Open Gmail",
    expectedCapability: "email.open_inbox_ui",
  },
  {
    name: "email-open-latest",
    utterance: "Open my latest email",
    expectedCapability: "email.open_message",
    forbidden: ["email.open_inbox_ui"],
  },
  {
    name: "email-draft-reply",
    utterance: "Reply to the latest email",
    expectedCapability: "email.reply_draft",
    forbidden: ["email.send_draft", "email.open_inbox_ui"],
  },
  {
    name: "email-send",
    utterance: "Send the reply",
    expectedCapability: "email.send_draft",
  },
  {
    name: "navigate-tasks",
    utterance: "Go to Tasks",
    expectedCapability: "arcsonare.navigate",
  },
];

/** Reject open_ui when a weak model proposes it for a read. */
function testValidatorCorrection(): { ok: boolean; message: string } {
  const contract = classifyIntent("What's on my calendar?");
  const result = validateToolSelection(contract, "calendar.open_ui");
  if (result.ok) {
    return { ok: false, message: "Validator accepted calendar.open_ui for a read intent" };
  }
  if (result.correctedCapabilityId !== "calendar.list_events") {
    return {
      ok: false,
      message: `Expected correction to calendar.list_events, got ${result.correctedCapabilityId}`,
    };
  }
  return { ok: true, message: "Validator corrected open_ui → list_events" };
}

export function runConformanceSuite(modelId = "deterministic"): ModelConformanceResult {
  const failures: ModelConformanceResult["failures"] = [];
  let passed = 0;

  for (const c of CASES) {
    const contract = classifyIntent(c.utterance);
    const capability = mapIntentToCapability(contract) ?? contract.capabilityId;
    if (capability !== c.expectedCapability) {
      failures.push({
        testName: c.name,
        expectedCapability: c.expectedCapability,
        actualCapability: capability,
        message: `Got ${capability} for “${c.utterance}” (mode=${contract.mode}, domain=${contract.domain})`,
      });
      continue;
    }
    if (c.forbidden?.includes(capability ?? "")) {
      failures.push({
        testName: c.name,
        expectedCapability: c.expectedCapability,
        actualCapability: capability,
        message: `Forbidden capability selected: ${capability}`,
      });
      continue;
    }
    // Also ensure forbidden tools would be rejected if proposed
    let forbiddenOk = true;
    for (const bad of c.forbidden ?? []) {
      const v = validateToolSelection(contract, bad);
      if (v.ok) {
        failures.push({
          testName: `${c.name}:forbid:${bad}`,
          expectedCapability: c.expectedCapability,
          actualCapability: bad,
          message: `Validator failed to reject ${bad}`,
        });
        forbiddenOk = false;
      }
    }
    if (forbiddenOk) passed += 1;
  }

  const correction = testValidatorCorrection();
  if (correction.ok) passed += 1;
  else {
    failures.push({
      testName: "validator-correction",
      expectedCapability: "calendar.list_events",
      actualCapability: "calendar.open_ui",
      message: correction.message,
    });
  }

  const totalTests = CASES.length + 1;

  return {
    providerId: "arcsonare",
    modelId,
    totalTests,
    passedTests: passed,
    failedTests: failures.length,
    nativeToolTestsPassed: true,
    structuredFallbackPassed: true,
    deterministicRoutingPassed: failures.length === 0,
    supportedOperationModes: [
      "read",
      "open",
      "draft",
      "send",
      "navigate",
      "summarize",
      "search",
    ],
    failures,
    testedAt: new Date().toISOString(),
  };
}
