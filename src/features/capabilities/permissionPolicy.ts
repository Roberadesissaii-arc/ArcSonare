/**
 * What needs asking, and how often.
 *
 * Two separate questions used to be answered by one flag. "Is this dangerous?"
 * and "have we already asked about it?" are not the same, and conflating them is
 * why one spoken sentence could produce five or ten prompts: every internal step
 * of one request re-evaluated danger from scratch, with no memory that the user
 * had already said yes to the plan the step belonged to.
 *
 * This module answers the first question only, and answers it per capability:
 *
 *   - `none`        run it; inspecting and temporary visuals change nothing
 *   - `per-request` ask once for the described plan, then stop asking
 *   - `always`      ask every single time, grant or no grant
 *
 * The second question is `approvalGrant.ts`, which owns the request-scoped
 * grant in Rust. Keeping them apart means "delete" can never be downgraded by a
 * grant, and "highlight" can never be upgraded by a cautious default.
 */

import { getCapability } from "./capabilityRegistry";
import type { CapabilityDefinition } from "./capabilityTypes";

export type PermissionTier = "none" | "per-request" | "always";

/** The four-way risk vocabulary the Rust grant store speaks. */
export type PolicyRisk = "read-only" | "reversible" | "moderate" | "destructive";

/**
 * Capabilities that always ask, whatever else is true.
 *
 * Matched on the capability id, not on a keyword in its description: a
 * description can be reworded, and "this one always asks" must not depend on
 * prose. Anything not listed still reaches `always` through its risk level or
 * an external recipient — this is the floor, not the whole rule.
 */
const ALWAYS_CONFIRM = new Set([
  "filesystem.delete",
  "tasks.delete",
  "email.send_message",
  "email.reply",
  "calendar.delete_event",
]);

/**
 * Verbs that mean "this leaves the machine".
 *
 * Anything that sends, posts, publishes, buys or subscribes reaches another
 * party, and no standing approval covers that — the grant store refuses it
 * independently, so this is belt and braces on the classification side.
 */
const EXTERNAL_VERBS =
  /^(email|message|slack|discord|telegram|whatsapp|x|twitter)\.(send|post|reply|publish|share)|\.(purchase|subscribe|checkout|transfer|upload)$/;

/**
 * Reading and looking. Never asks.
 *
 * Includes temporary visuals: an overlay that clears itself modifies nothing,
 * so asking permission to draw one is asking permission to point at something.
 */
const NEVER_ASK_PREFIXES = [
  "screen.",
  "windows.",
  "system.get_",
  "applications.list",
  "applications.resolve",
  "connections.",
  "arcsonare.",
];

const NEVER_ASK_IDS = new Set([
  "applications.open",
  "applications.focus",
  "filesystem.open_item",
  "filesystem.list_directory",
  "filesystem.list_known_folder",
  "filesystem.resolve_known_folder",
  "filesystem.read_text_file",
  "web.search",
  "web.open_url",
  "web.activate_listed_item",
  "youtube.search",
  "youtube.list_channel_videos",
  "tasks.list",
  "tasks.complete",
]);

/** Whether a step reaches a party outside this machine. */
export function isExternal(capabilityId: string): boolean {
  return EXTERNAL_VERBS.test(capabilityId);
}

// ---------------------------------------------------------------------------
// The five-level model
//
// `PermissionTier` above says how *often* to ask. This says how *dangerous* the
// thing is, in the vocabulary `pending.rs` speaks, and it exists because the
// four-level `riskLevel` in the registry could not express either end of the
// range that actually matters here.
//
// At the low end it had no word for "the user's sentence is the authorisation":
// opening an app, downloading to Downloads and editing a file the user pointed
// at all change something, so nothing classified them as free, and every one of
// them could reach a prompt. At the high end it had no word for the UAC
// boundary, so an installer had no place to stop that was distinguishable from
// the download that preceded it.
// ---------------------------------------------------------------------------

export type ActionRisk =
  | "routine"
  | "reversible"
  | "sensitive"
  | "destructive"
  | "elevated";

/**
 * Work the request itself authorises.
 *
 * Every entry is something the user asked for in the sentence that produced it.
 * "Download LightBurn" is a download; asking whether to download is asking the
 * user to repeat themselves. The boundary that matters for a download is the
 * *install*, and that is `elevated` below.
 */
const ROUTINE_IDS = new Set([
  // Opening, focusing, looking.
  "applications.open",
  "applications.open_with",
  "applications.focus",
  "applications.focus_watched",
  "applications.list",
  "applications.resolve",
  "applications.refresh_index",
  "applications.get_window_context",
  "filesystem.open_item",
  "filesystem.reveal_in_explorer",
  "filesystem.list_directory",
  "filesystem.list_known_folder",
  "filesystem.resolve_known_folder",
  "filesystem.read_text_file",
  "filesystem.read_for_edit",
  "filesystem.get_metadata",
  "filesystem.get_directory_summary",
  "filesystem.find",
  // Creating and changing files the user named. The confirmation that belongs
  // on files is on *destroying* content, not on writing the thing that was
  // just requested.
  "filesystem.create_file",
  "filesystem.create_directory",
  "filesystem.modify_file",
  "filesystem.write_text_file",
  // The web, read and navigated.
  "web.search",
  "web.open_url",
  "web.fetch_page",
  "web.activate_listed_item",
  "browser.get_page_context",
  "browser.get_active_tab",
  "browser.list_windows",
  "browser.navigate",
  "browser.search",
  "browser.find_text",
  "browser.find_link",
  "browser.scroll",
  "browser.go_back",
  "browser.go_forward",
  "browser.refresh",
  "browser.open_new_tab",
  // A download lands in Downloads and installs nothing.
  "browser.download",
  "browser.get_downloads",
  "browser.wait_for_download",
  // Media transport: the opposite command is one word away.
  "spotify.play",
  "spotify.pause",
  "spotify.next",
  "spotify.previous",
  // ArcSonare's own surfaces.
  "clipboard.write_text",
  "tasks.list",
  "tasks.complete",
  "youtube.search",
  "youtube.list_channel_videos",
]);

/**
 * Undoable, or plainly visible the moment it happens.
 *
 * Distinguished from routine only so the trace can say which was which — both
 * run without asking. Renaming and moving live here rather than in routine
 * because they change where something *is*, which is worth naming in a log even
 * when it is not worth a question.
 */
const REVERSIBLE_IDS = new Set([
  "filesystem.rename",
  "filesystem.move",
  "filesystem.copy",
  "windows.focus",
  "windows.minimize",
  "windows.maximize",
  "windows.restore",
  "windows.move_resize",
  "system.set_volume",
  "system.set_brightness",
  "browser.click_element",
  "browser.fill_field",
  "browser.submit_form",
  "browser.close_tab",
  // Launching a downloaded installer is not installing: it opens a window the
  // user can close. The elevation inside it is what asks.
  "installer.launch",
  "vscode.run_task",
  "vscode.start_debug",
  "vscode.stop_task",
]);

/**
 * Reaches another party, touches credentials, or commits the user to terms.
 *
 * One approval covers the described plan — the point of `ApprovalScope`.
 */
const SENSITIVE_IDS = new Set([
  "browser.login",
  "browser.use_saved_credentials",
  "browser.accept_terms",
  "browser.install_extension",
  "browser.upload_file",
  "discord_desktop.prepare_message",
  "discord_desktop.send_message",
  "applications.close",
  "windows.close",
  "watch.enable_background",
]);

/**
 * Cannot be taken back. Asks per action, every time, plan or no plan.
 */
const DESTRUCTIVE_IDS = new Set([
  "filesystem.delete",
  "tasks.delete",
  "calendar.delete_event",
  "applications.uninstall",
  "system.reset_settings",
]);

/**
 * Crosses the administrator boundary.
 *
 * Asked immediately before the step that needs it and never earlier, which is
 * why "download the installer" and "install it" must not share a question.
 */
const ELEVATED_IDS = new Set([
  "installer.install",
  "installer.elevate",
  "system.modify_firewall",
  "system.install_driver",
  "system.write_protected_location",
]);

/**
 * How dangerous a capability is, on the five-level scale.
 *
 * Falls through to `destructive` for anything unrecognised: a capability nobody
 * classified is not thereby free, and defaulting an unknown to `routine` is how
 * a permission system quietly stops being one.
 */
export function actionRisk(capabilityId: string): ActionRisk {
  if (ELEVATED_IDS.has(capabilityId)) return "elevated";
  if (DESTRUCTIVE_IDS.has(capabilityId)) return "destructive";
  if (isExternal(capabilityId)) return "sensitive";
  if (SENSITIVE_IDS.has(capabilityId)) return "sensitive";
  if (REVERSIBLE_IDS.has(capabilityId)) return "reversible";
  if (ROUTINE_IDS.has(capabilityId)) return "routine";

  // Whole families that are read-only or self-clearing by construction.
  if (
    capabilityId.startsWith("screen.") ||
    capabilityId.startsWith("system.get_") ||
    capabilityId.startsWith("windows.list") ||
    capabilityId.startsWith("windows.get_") ||
    capabilityId.startsWith("desktop.list") ||
    capabilityId.startsWith("desktop.find") ||
    capabilityId.startsWith("connections.") ||
    capabilityId.startsWith("arcsonare.") ||
    capabilityId.startsWith("annotation.") ||
    /^(vscode|discord_desktop|spotify|browser)\.get_/.test(capabilityId) ||
    capabilityId.startsWith("input.")
  ) {
    return "routine";
  }

  const definition = getCapability(capabilityId);
  if (!definition) return "destructive";
  switch (definition.riskLevel) {
    case "read-only":
      return "routine";
    case "reversible":
      return "reversible";
    case "sensitive":
      return "sensitive";
    default:
      return "destructive";
  }
}

/** Whether this capability ever stops to ask. */
export function requiresApproval(capabilityId: string): boolean {
  const risk = actionRisk(capabilityId);
  return risk === "sensitive" || risk === "destructive" || risk === "elevated";
}

/**
 * Whether one plan approval may cover this step.
 *
 * Destructive and elevated steps are confirmed at their own boundary however
 * clearly the plan described them — an approved install plan does not thereby
 * authorise a delete inside it.
 */
export function coverableByPlan(capabilityId: string): boolean {
  const risk = actionRisk(capabilityId);
  return risk !== "destructive" && risk !== "elevated";
}

/**
 * Map a capability's declared risk onto the grant vocabulary.
 *
 * The registry says `read-only | reversible | sensitive | destructive`; the
 * grant store says `read-only | reversible | moderate | destructive`. One
 * translation, in one place, so the two cannot drift into disagreeing about
 * what "sensitive" means.
 */
export function policyRisk(capability: CapabilityDefinition): PolicyRisk {
  switch (capability.riskLevel) {
    case "read-only":
      return "read-only";
    case "reversible":
      return "reversible";
    case "sensitive":
      return "moderate";
    case "destructive":
      return "destructive";
    default:
      // An unrecognised level is treated as the most cautious thing it could
      // be, rather than silently as read-only.
      return "destructive";
  }
}

export interface PermissionDecision {
  tier: PermissionTier;
  risk: PolicyRisk;
  external: boolean;
  /** Shown to the user only when something is actually being asked. */
  reason?: string;
}

/**
 * How much permission this capability needs, before any grant is considered.
 */
export function permissionFor(capabilityId: string): PermissionDecision {
  const capability = getCapability(capabilityId);
  if (!capability) {
    // Not a real capability. Refusing to classify it is safer than defaulting
    // to "no permission needed" for something we cannot describe.
    return {
      tier: "always",
      risk: "destructive",
      external: false,
      reason: "unknown capability",
    };
  }

  const risk = policyRisk(capability);
  const external = isExternal(capabilityId);

  if (ALWAYS_CONFIRM.has(capabilityId) || risk === "destructive" || external) {
    return {
      tier: "always",
      risk,
      external,
      reason: external
        ? "this sends something out"
        : "this cannot be undone",
    };
  }

  if (
    NEVER_ASK_IDS.has(capabilityId) ||
    NEVER_ASK_PREFIXES.some((p) => capabilityId.startsWith(p)) ||
    risk === "read-only"
  ) {
    return { tier: "none", risk, external: false };
  }

  return {
    tier: "per-request",
    risk,
    external: false,
    reason: "this changes something",
  };
}

/**
 * Whether a step may run given what has already been approved for the request.
 *
 * `granted` is the answer from the Rust grant store — this function does not
 * decide it, only combines it with the tier. Split that way so a tier of
 * `always` cannot be argued out of asking by any grant state.
 */
export function needsPrompt(capabilityId: string, granted: boolean): boolean {
  const { tier } = permissionFor(capabilityId);
  if (tier === "always") return true;
  if (tier === "none") return false;
  return !granted;
}

/**
 * Everything a plan's steps need approved, collapsed into one question.
 *
 * A plan containing three moderate steps and four read-only ones is one
 * `per-request` approval covering the three; a plan containing a delete is that
 * plus a separate confirmation for the delete, which this does not fold in.
 */
export function planApproval(capabilityIds: string[]): {
  needsApproval: boolean;
  approvedRisk: PolicyRisk;
  capabilities: string[];
  /** Steps that will still ask individually, however the plan is approved. */
  alwaysAsk: string[];
} {
  const order: PolicyRisk[] = ["read-only", "reversible", "moderate", "destructive"];
  let highest: PolicyRisk = "read-only";
  const grantable: string[] = [];
  const alwaysAsk: string[] = [];

  for (const id of capabilityIds) {
    const decision = permissionFor(id);
    if (decision.tier === "always") {
      alwaysAsk.push(id);
      continue;
    }
    if (order.indexOf(decision.risk) > order.indexOf(highest)) highest = decision.risk;
    if (decision.tier === "per-request") grantable.push(id);
  }

  return {
    needsApproval: grantable.length > 0,
    approvedRisk: highest,
    // Read-only steps ride along inside the grant so a re-inspection between
    // two approved steps does not fall outside it.
    capabilities: capabilityIds.filter((id) => permissionFor(id).tier !== "always"),
    alwaysAsk,
  };
}
