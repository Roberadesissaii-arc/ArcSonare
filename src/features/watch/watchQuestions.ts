/**
 * Direct answers to "what's running?" and "what's going on?".
 *
 * These bypass capability routing on purpose: routing "what's running?" to
 * `system.get_running_processes` returns a raw process dump that answers a
 * different question, and loses the watch state entirely.
 *
 * Everything below is composed from the reconciled snapshot, so a watched
 * application that has closed is *reported as closed* rather than omitted —
 * which is what made the old answer quietly wrong.
 */
import { isRunningAppsQuestion } from "../../services/runningAppsQuestions";
import { adapterFor } from "./adapters/adapterRegistry";
import { summarizeWatchedApplications } from "./watchContextBroker";
import { getWatchSnapshot, refreshWatchSnapshot } from "./watchStore";
import type { RunningAppInstance, WatchedApplication } from "./watchTypes";

/** "What is going on?" — a summary across everything watched. */
const SUMMARY_PATTERN =
  /^(?:so\s+)?(?:what(?:'s| is)\s+(?:going on|happening|up)|catch me up|status|summar(?:y|ise|ize)(?:\s+everything)?)\b/i;

export function isWatchSummaryQuestion(text: string): boolean {
  return SUMMARY_PATTERN.test(text.trim());
}

/**
 * One line describing an application's state, honestly.
 *
 * A watched application with no adapter says so rather than presenting its
 * window title as understanding.
 */
function describeWatched(
  application: WatchedApplication,
  instances: RunningAppInstance[],
): string {
  if (application.state === "paused") {
    return `${application.displayName} — watching is paused.`;
  }
  if (instances.length === 0) {
    return `${application.displayName} — watched, but not running right now.`;
  }
  if (instances.length > 1) {
    const identities = instances
      .map((i) => i.workspaceIdentity ?? i.windowTitle)
      .filter(Boolean)
      .slice(0, 3);
    return identities.length > 0
      ? `${application.displayName} — ${instances.length} windows open (${identities.join("; ")}).`
      : `${application.displayName} — ${instances.length} windows open.`;
  }

  const instance = instances[0];
  const adapter = adapterFor(instance);
  const identity =
    application.privacyPolicy.windowTitle
      ? (instance.workspaceIdentity ?? instance.windowTitle)
      : null;

  if (!adapter) {
    return identity
      ? `${application.displayName} — running (${identity}). I can see its window, not what is inside it.`
      : `${application.displayName} — running. I can see its window, not what is inside it.`;
  }
  return identity
    ? `${application.displayName} — running, ${identity}.`
    : `${application.displayName} — running.`;
}

/**
 * Answer a running-apps question, or return null to let routing continue.
 *
 * Unwatched-but-running applications are listed by name only. Their window
 * titles are deliberately withheld: the user did not ask ArcSonare to pay
 * attention to them, and a title is often the most sensitive thing an
 * application exposes.
 */
export async function answerWatchQuestion(text: string): Promise<string | null> {
  const summary = isWatchSummaryQuestion(text);
  if (!summary && !isRunningAppsQuestion(text)) return null;

  try {
    await refreshWatchSnapshot();
  } catch {
    return "I couldn't read which applications are running right now.";
  }

  if (summary) {
    return summarizeWatchedApplications();
  }

  const { watched, running } = getWatchSnapshot();
  const byApp = new Map<string, RunningAppInstance[]>();
  for (const instance of running) {
    const list = byApp.get(instance.appCatalogId) ?? [];
    list.push(instance);
    byApp.set(instance.appCatalogId, list);
  }

  const watchedIds = new Set(watched.map((w) => w.appCatalogId));
  const unwatched = [...byApp.keys()].filter((id) => !watchedIds.has(id));

  if (watched.length === 0 && unwatched.length === 0) {
    return "I don't see any applications I recognise running right now.";
  }

  const parts: string[] = [];
  if (watched.length > 0) {
    parts.push("**Watching**");
    for (const application of watched) {
      parts.push(
        `- ${describeWatched(application, byApp.get(application.appCatalogId) ?? [])}`,
      );
    }
  }
  if (unwatched.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push(watched.length > 0 ? "**Also running** (not watched)" : "**Running now**");
    for (const id of unwatched.slice(0, 10)) {
      const instances = byApp.get(id) ?? [];
      const name = instances[0]?.executableName.replace(/\.exe$/i, "") ?? id;
      parts.push(
        instances.length > 1 ? `- ${name} (${instances.length} windows)` : `- ${name}`,
      );
    }
    parts.push("");
    parts.push(
      "I only read window titles and contents for applications you're watching.",
    );
  }
  return parts.join("\n");
}
