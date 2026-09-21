/**
 * 100-case ArcSonare correctness suite.
 *
 * Each case checks:
 *   A) ROUTE  â€” which handler would run (must match)
 *   B) REPLY  â€” natural reply from verified facts must match must/mustNot
 *   C) VISION â€” pure vision coord / JSON parse helpers (no live API required)
 *
 * Open / close / click / vision / calendar / folders / youtube / etc.
 *
 * Run:  npx tsx scripts/suite-100.mts
 * Exit: 0 only when 100/100 pass.
 */

import {
  claimContradictsFacts,
  deterministicNaturalReply,
} from "../src/services/naturalReply";
import { routeDeterministic } from "../src/features/capabilities/capabilityRouter";
import {
  classifyIntent,
  isOrchestratedDomain,
} from "../src/features/orchestration/IntentClassifier";
import {
  needsSearchQuery,
  needsTaskTitle,
} from "../src/features/capabilities/clarifyGuards";
import { isRunningAppsQuestion } from "../src/services/runningAppsQuestions";
import { resolveCalendarQueryRange } from "../src/features/orchestration/parseCalendarRange";
import {
  box2dToPixels,
  diagnosticClickPointFromDetection,
  diagnosticImagePointToScreen,
  parseDetectedTarget,
} from "../src/services/visionCoords";
import { writeFileSync } from "node:fs";

type Case = {
  id: string;
  cat: string;
  q?: string;
  wantRoute?: string;
  args?: Record<string, unknown>;
  facts?: string;
  capabilityId?: string;
  must?: RegExp[];
  mustNot?: RegExp[];
  wantDay?: string;
  /** Pure vision unit checks (no live Gemini). */
  vision?: () => string | null;
};

function resolveRoute(q: string): { label: string; args?: Record<string, unknown> } {
  if (isRunningAppsQuestion(q)) return { label: "running-apps" };
  if (needsTaskTitle(q) || needsSearchQuery(q)) return { label: "clarify" };
  const c = classifyIntent(q);
  if (isOrchestratedDomain(c)) {
    return { label: `orchestrated:${c.capabilityId ?? c.domain}` };
  }
  const d = routeDeterministic(q);
  if (d) return { label: `capability:${d.capabilityId}`, args: d.arguments };
  return { label: "chat" };
}

function routeOk(got: string, want: string): boolean {
  if (got === want) return true;
  if (got.startsWith(want)) return true;
  const g = got.split(":");
  const w = want.split(":");
  if (g[0] === w[0] && w[1] && g[1]?.startsWith(w[1])) return true;
  return false;
}

function argsOk(
  got: Record<string, unknown> | undefined,
  want: Record<string, unknown> | undefined,
): boolean {
  if (!want) return true;
  if (!got) return false;
  for (const [k, v] of Object.entries(want)) {
    if (typeof v === "object" && v !== null) {
      const gv = got[k];
      if (typeof gv !== "object" || gv === null) return false;
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (String((gv as Record<string, unknown>)[sk]).toLowerCase() !== String(sv).toLowerCase()) {
          return false;
        }
      }
    } else if (String(got[k]).toLowerCase() !== String(v).toLowerCase()) {
      return false;
    }
  }
  return true;
}

function replyOk(
  reply: string,
  must?: RegExp[],
  mustNot?: RegExp[],
  facts?: string,
): string[] {
  const fails: string[] = [];
  for (const re of must ?? []) {
    if (!re.test(reply)) fails.push(`missing /${re.source}/`);
  }
  for (const re of mustNot ?? []) {
    if (re.test(reply)) fails.push(`forbidden /${re.source}/`);
  }
  if (facts && claimContradictsFacts(reply, facts)) fails.push("claim-contradicts-facts");
  if (/\| Application \| Status \|/i.test(reply)) fails.push("app-status-table");
  if (/\*\*Actions Taken\*\*/i.test(reply)) fails.push("actions-taken");
  return fails;
}

const FORBIDDEN_DUMP = [
  /\| Application \| Status \|/i,
  /\*\*Actions Taken\*\*/i,
  /\*\*Verified Facts\*\*/i,
  /confirmed:\s*opened/i,
];

const CASES: Case[] = [
  // â”€â”€ A. Connection (8) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "a01", cat: "connect", q: "is my gmail connected", wantRoute: "orchestrated:email.get_connection_status", facts: "Yes â€” Gmail is connected to ArcSonare.", capabilityId: "email.get_connection_status", must: [/yes|connected/i, /gmail/i], mustNot: FORBIDDEN_DUMP },
  { id: "a02", cat: "connect", q: "is my email connected", wantRoute: "orchestrated:email.get_connection_status", facts: "Yes â€” Gmail is connected to ArcSonare.", capabilityId: "email.get_connection_status", must: [/connected/i], mustNot: [/not connected/i] },
  { id: "a03", cat: "connect", q: "do I have gmail linked", wantRoute: "orchestrated:email.get_connection_status" },
  { id: "a04", cat: "connect", q: "is google drive linked", wantRoute: "orchestrated:drive.get_connection_status", facts: "Yes â€” Google Drive is connected to ArcSonare.", capabilityId: "drive.get_connection_status", must: [/connected|drive/i], mustNot: FORBIDDEN_DUMP },
  { id: "a05", cat: "connect", q: "is my calendar connected", wantRoute: "orchestrated:calendar.get_connection_status", facts: "Yes â€” Google Calendar is connected to ArcSonare.", capabilityId: "calendar.get_connection_status", must: [/connected|calendar/i], mustNot: FORBIDDEN_DUMP },
  { id: "a06", cat: "connect", q: "check my email", wantRoute: "orchestrated:email.get_inbox_summary" },
  { id: "a07", cat: "connect", q: "what is my latest email", wantRoute: "orchestrated:email.get_latest_message" },
  { id: "a08", cat: "connect", q: "what's in my google drive", wantRoute: "orchestrated:drive.list" },

  // â”€â”€ B. Calendar (8) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "b01", cat: "calendar", q: "what's on my calendar today", wantRoute: "orchestrated:calendar.list_events" },
  { id: "b02", cat: "calendar", q: "what is on my calendar tomorrow", wantRoute: "orchestrated:calendar.list_events" },
  { id: "b03", cat: "calendar", q: "what do I have on August 8th", wantRoute: "orchestrated:calendar.list_events", wantDay: "2026-08-08", facts: "**1 event on August 8, 2026**\n\n| Event | When | Where |\n| --- | --- | --- |\n| Aurallio - Standard - Robera Desissa | Aug 8, 2:30 PM | â€” |", capabilityId: "calendar.list_events", must: [/aurallio/i, /aug/i], mustNot: [...FORBIDDEN_DUMP, /from\s*\|\s*subject/i, /no events/i] },
  { id: "b04", cat: "calendar", q: "check my calendar for August 8", wantRoute: "orchestrated:calendar.list_events", wantDay: "2026-08-08" },
  { id: "b05", cat: "calendar", q: "do I have anything on Aug 8", wantRoute: "orchestrated:calendar.list_events", wantDay: "2026-08-08" },
  { id: "b06", cat: "calendar", q: "what do I have on August 20th", wantRoute: "orchestrated:calendar.list_events", wantDay: "2026-08-20", facts: "No events on your calendar for August 20, 2026.", capabilityId: "calendar.list_events", must: [/nothing|no events/i, /august\s*20|aug\s*20/i], mustNot: [...FORBIDDEN_DUMP, /from\s*\|\s*subject/i, /aurallio/i] },
  { id: "b07", cat: "calendar", q: "what's my next meeting", wantRoute: "orchestrated:calendar.get_next_event" },
  { id: "b08", cat: "calendar", q: "open my calendar", wantRoute: "orchestrated:calendar.open_ui" },

  // â”€â”€ C. Watch / running (6) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "c01", cat: "watch", q: "what's running", wantRoute: "running-apps" },
  { id: "c02", cat: "watch", q: "what apps are running", wantRoute: "running-apps" },
  { id: "c03", cat: "watch", q: "what is open right now", wantRoute: "running-apps" },
  { id: "c04", cat: "watch", q: "is edge open", wantRoute: "running-apps" },
  { id: "c05", cat: "watch", q: "what am i watching", wantRoute: "running-apps" },

  // â”€â”€ D. YouTube / media ordinals (10) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "d01", cat: "youtube", q: "open youtube", wantRoute: "capability:applications.open", args: { query: "youtube" }, facts: "Opened YouTube.", capabilityId: "applications.open", must: [/open/i, /youtube/i], mustNot: FORBIDDEN_DUMP },
  { id: "d02", cat: "youtube", q: "open the first video", wantRoute: "capability:web.activate_listed_item", args: { index: 1 }, facts: 'Playing "Lo-fi beats" on YouTube.', capabilityId: "web.activate_listed_item", must: [/youtube|playing|lo-fi|video/i], mustNot: FORBIDDEN_DUMP },
  { id: "d03", cat: "youtube", q: "open the second video", wantRoute: "capability:web.activate_listed_item", args: { index: 2 } },
  { id: "d04", cat: "youtube", q: "open the third video", wantRoute: "capability:web.activate_listed_item", args: { index: 3 } },
  { id: "d05", cat: "youtube", q: "open the theird video", wantRoute: "capability:web.activate_listed_item", args: { index: 3 } },
  { id: "d06", cat: "youtube", q: "open the 3rd video", wantRoute: "capability:web.activate_listed_item", args: { index: 3 } },
  { id: "d07", cat: "youtube", q: "play video 1", wantRoute: "capability:web.activate_listed_item", args: { index: 1 } },
  { id: "d08", cat: "youtube", q: "click the second video", wantRoute: "capability:web.activate_listed_item", args: { index: 2 } },
  { id: "d09", cat: "youtube", q: "search youtube for lofi hip hop", wantRoute: "capability:web.search" },
  { id: "d10", cat: "youtube", q: "open the first one", wantRoute: "capability:web.activate_listed_item", args: { index: 1 } },

  // â”€â”€ E. Folders (8) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "e01", cat: "folder", q: "open the avatar folder on my desktop", wantRoute: "capability:filesystem.open_item", args: { __known_subpath: { folder: "desktop", name: "avatar" } }, facts: 'Opened "Avatar" with its default app.', capabilityId: "filesystem.open_item", must: [/open/i, /avatar/i], mustNot: FORBIDDEN_DUMP },
  { id: "e02", cat: "folder", q: "open folder called avatar on my desktop", wantRoute: "capability:filesystem.open_item", args: { __known_subpath: { folder: "desktop", name: "avatar" } } },
  { id: "e03", cat: "folder", q: "open folder call avater it is in my desktop", wantRoute: "capability:filesystem.open_item", args: { __known_subpath: { folder: "desktop", name: "avater" } }, facts: '"C:\\Users\\x\\Desktop\\avater" does not exist.', capabilityId: "filesystem.open_item", must: [/couldn'?t find|could not find|double-check/i], mustNot: [...FORBIDDEN_DUMP, /confirmed:\s*opened/i] },
  { id: "e04", cat: "folder", q: "open the reports folder on my desktop", wantRoute: "capability:filesystem.open_item", args: { __known_subpath: { folder: "desktop", name: "reports" } } },
  { id: "e05", cat: "folder", q: "what's on my desktop", wantRoute: "capability:filesystem.list_known_folder", args: { folder: "desktop" } },
  { id: "e06", cat: "folder", q: "what's in my downloads", wantRoute: "capability:filesystem.list_known_folder", args: { folder: "downloads" } },
  { id: "e07", cat: "folder", q: "create a folder called reports on my desktop", wantRoute: "capability:filesystem.create_directory" },
  { id: "e08", cat: "folder", q: "list the contents of reports on my desktop", wantRoute: "capability:filesystem.list_directory" },

  // â”€â”€ F. Apps OPEN (12) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "f01", cat: "open", q: "open spotify", wantRoute: "capability:applications.open", args: { query: "spotify" }, facts: "Opened Spotify.", capabilityId: "applications.open", must: [/spotify/i], mustNot: FORBIDDEN_DUMP },
  { id: "f02", cat: "open", q: "open chrome", wantRoute: "capability:applications.open", args: { query: "chrome" } },
  { id: "f03", cat: "open", q: "open edge", wantRoute: "capability:applications.open", args: { query: "edge" } },
  { id: "f04", cat: "open", q: "launch visual studio code", wantRoute: "capability:applications.open" },
  { id: "f05", cat: "open", q: "open the calculator app", wantRoute: "capability:applications.open" },
  { id: "f06", cat: "open", q: "open notepad", wantRoute: "capability:applications.open", args: { query: "notepad" } },
  { id: "f07", cat: "open", q: "open discord", wantRoute: "capability:applications.open", args: { query: "discord" } },
  { id: "f08", cat: "open", q: "open slack", wantRoute: "capability:applications.open", args: { query: "slack" } },
  { id: "f09", cat: "open", q: "open gmail", wantRoute: "orchestrated:email.open_inbox_ui" },
  { id: "f10", cat: "open", q: "open google drive", wantRoute: "orchestrated:drive.open_ui" },

  // â”€â”€ G. Apps CLOSE (10) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "g01", cat: "close", q: "close spotify", wantRoute: "capability:applications.close", args: { query: "spotify" }, facts: "Closed Spotify.", capabilityId: "applications.close", must: [/closed|close/i, /spotify/i], mustNot: FORBIDDEN_DUMP },
  { id: "g02", cat: "close", q: "close chrome", wantRoute: "capability:applications.close", args: { query: "chrome" } },
  { id: "g03", cat: "close", q: "quit notepad", wantRoute: "capability:applications.close" },
  { id: "g04", cat: "close", q: "exit edge", wantRoute: "capability:applications.close" },
  { id: "g05", cat: "close", q: "close discord", wantRoute: "capability:applications.close", args: { query: "discord" } },
  { id: "g06", cat: "close", q: "close slack", wantRoute: "capability:applications.close", args: { query: "slack" } },
  { id: "g07", cat: "close", q: "quit calculator", wantRoute: "capability:applications.close" },
  { id: "g08", cat: "close", q: "close visual studio code", wantRoute: "capability:applications.close" },

  // â”€â”€ H. Focus (4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "h01", cat: "focus", q: "switch to chrome", wantRoute: "capability:applications.focus" },
  { id: "h02", cat: "focus", q: "focus edge", wantRoute: "capability:applications.focus" },
  { id: "h03", cat: "focus", q: "bring up discord", wantRoute: "capability:applications.focus" },
  { id: "h04", cat: "focus", q: "switch to spotify", wantRoute: "capability:applications.focus" },

  // â”€â”€ I. Vision click routes (10) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "i01", cat: "click", q: "click the play button", wantRoute: "capability:screen.click_target", args: { target: "play button" }, facts: 'Clicked "Play" at (640, 360).', capabilityId: "screen.click_target", must: [/click/i, /play/i], mustNot: FORBIDDEN_DUMP },
  { id: "i02", cat: "click", q: "click save", wantRoute: "capability:screen.click_target", args: { target: "save" } },
  { id: "i03", cat: "click", q: "click the blue Submit button", wantRoute: "capability:screen.click_target", args: { target: "blue submit button" } },
  { id: "i04", cat: "click", q: "press the close button", wantRoute: "capability:screen.click_target" },
  { id: "i05", cat: "click", q: "click ok", wantRoute: "capability:screen.click_target", args: { target: "ok" } },
  { id: "i06", cat: "click", q: "tap the search icon", wantRoute: "capability:screen.click_target" },
  { id: "i07", cat: "click", q: "click next", wantRoute: "capability:screen.click_target", args: { target: "next" } },
  { id: "i08", cat: "click", q: "click the download button", wantRoute: "capability:screen.click_target", args: { target: "download button" } },
  { id: "i09", cat: "click", q: "click pause", wantRoute: "capability:screen.click_target", args: { target: "pause" }, facts: "I couldn't find â€œpauseâ€ on the screen.", capabilityId: "screen.click_target", must: [/couldn'?t find|could not find/i, /pause/i], mustNot: [...FORBIDDEN_DUMP, /clicked/i] },
  { id: "i10", cat: "click", q: "please click the settings gear", wantRoute: "capability:screen.click_target" },

  // â”€â”€ J. Vision understand routes (8) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "j01", cat: "vision", q: "what's on my screen", wantRoute: "capability:screen.understand", facts: "Chrome is open on a YouTube results page with three video thumbnails.", capabilityId: "screen.understand", must: [/chrome|youtube|video/i], mustNot: FORBIDDEN_DUMP },
  { id: "j02", cat: "vision", q: "what do you see on my screen", wantRoute: "capability:screen.understand" },
  { id: "j03", cat: "vision", q: "describe my screen", wantRoute: "capability:screen.understand" },
  { id: "j04", cat: "vision", q: "look at my screen", wantRoute: "capability:screen.understand" },
  { id: "j05", cat: "vision", q: "describe this screenshot", wantRoute: "capability:screen.understand" },
  { id: "j06", cat: "vision", q: "what's in this screenshot", wantRoute: "capability:screen.understand" },
  { id: "j07", cat: "vision", q: "what is visible on my screen", wantRoute: "capability:screen.understand" },

  // â”€â”€ K. Screenshots capture (6) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "k01", cat: "screen", q: "take a screenshot", wantRoute: "capability:screen.capture", facts: "Got the screenshot.", capabilityId: "screen.capture", must: [/screenshot/i], mustNot: FORBIDDEN_DUMP },
  { id: "k02", cat: "screen", q: "screenshot", wantRoute: "capability:screen.capture" },
  { id: "k03", cat: "screen", q: "screenshot that", wantRoute: "capability:screen.capture" },
  { id: "k04", cat: "screen", q: "take a screenshot of edge", wantRoute: "capability:screen.capture" },
  { id: "k05", cat: "screen", q: "screenshot my second monitor", wantRoute: "capability:screen.capture" },
  { id: "k06", cat: "screen", q: "screenshot the left half", wantRoute: "capability:screen.capture" },

  // â”€â”€ L. System / tasks (6) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { id: "l01", cat: "system", q: "what time is it", wantRoute: "capability:system.get_local_datetime" },
  { id: "l02", cat: "system", q: "what's on my clipboard", wantRoute: "capability:clipboard.read_text" },
  { id: "l03", cat: "system", q: "google rust lifetimes", wantRoute: "capability:web.search" },
  { id: "l04", cat: "system", q: "create a task to renew my passport", wantRoute: "capability:tasks.create" },
  { id: "l05", cat: "system", q: "can you create a task for me", wantRoute: "clarify" },
  { id: "l06", cat: "system", q: "search youtube", wantRoute: "clarify" },

  // â”€â”€ M. Vision pure helpers (14) â€” Gemini box_2d math + JSON parse â”€â”€â”€â”€â”€â”€â”€
  {
    id: "m01",
    cat: "vision-math",
    vision: () => {
      const p = box2dToPixels([0, 0, 1000, 1000], 1920, 1080);
      if (!p || p.centerX !== 960 || p.centerY !== 540) return `full-box center ${p?.centerX},${p?.centerY}`;
      return null;
    },
  },
  {
    id: "m02",
    cat: "vision-math",
    vision: () => {
      const p = box2dToPixels([250, 250, 750, 750], 1000, 1000);
      if (!p || p.centerX !== 500 || p.centerY !== 500) return `center ${p?.centerX},${p?.centerY}`;
      return null;
    },
  },
  {
    id: "m03",
    cat: "vision-math",
    vision: () => {
      const p = box2dToPixels([0, 0, 100, 100], 2000, 1000);
      if (!p || p.width !== 200 || p.height !== 100) return `size ${p?.width}x${p?.height}`;
      return null;
    },
  },
  {
    id: "m04",
    cat: "vision-math",
    vision: () => {
      const p = box2dToPixels([100, 200, 300, 400], 1000, 1000);
      if (!p || p.left !== 200 || p.top !== 100 || p.right !== 400 || p.bottom !== 300) {
        return `box ${JSON.stringify(p)}`;
      }
      return null;
    },
  },
  {
    id: "m05",
    cat: "vision-math",
    vision: () => {
      const s = diagnosticImagePointToScreen(100, 50, 1920, 0);
      if (s.x !== 2020 || s.y !== 50) return `screen ${s.x},${s.y}`;
      return null;
    },
  },
  {
    id: "m06",
    cat: "vision-math",
    vision: () => {
      const raw = '{"found":true,"label":"Play","box_2d":[400,450,600,550],"confidence":0.9}';
      const d = parseDetectedTarget(raw);
      if (!d?.found || d.label !== "Play" || !d.box_2d) return `parse ${JSON.stringify(d)}`;
      return null;
    },
  },
  {
    id: "m07",
    cat: "vision-math",
    vision: () => {
      const raw = "```json\n{\"found\":true,\"label\":\"Save\",\"box_2d\":[100,100,200,300]}\n```";
      const d = parseDetectedTarget(raw);
      if (!d?.found || d.label !== "Save") return `fenced ${JSON.stringify(d)}`;
      return null;
    },
  },
  {
    id: "m08",
    cat: "vision-math",
    vision: () => {
      const d = parseDetectedTarget('{"found":false,"label":"missing"}');
      if (!d || d.found) return "expected not found";
      return null;
    },
  },
  {
    id: "m09",
    cat: "vision-math",
    vision: () => {
      const point = diagnosticClickPointFromDetection(
        { found: true, label: "OK", box_2d: [0, 0, 1000, 1000] },
        1920,
        1080,
        0,
        0,
      );
      if (!point || point.x !== 960 || point.y !== 540 || point.label !== "OK") {
        return `point ${JSON.stringify(point)}`;
      }
      return null;
    },
  },
  {
    id: "m10",
    cat: "vision-math",
    vision: () => {
      const point = diagnosticClickPointFromDetection(
        { found: true, label: "Btn", box_2d: [200, 100, 400, 300] },
        1000,
        1000,
        100,
        50,
      );
      // center local = (200, 300); screen = (300, 350)
      if (!point || point.x !== 300 || point.y !== 350) return `origin map ${JSON.stringify(point)}`;
      return null;
    },
  },
];

if (CASES.length !== 100) {
  console.error(`Expected 100 cases, got ${CASES.length}`);
  process.exit(2);
}

async function main() {
  console.log("â•".repeat(72));
  console.log("SUITE-100 â€” open/close/click/vision + route + reply (must be 100/100)");
  console.log("â•".repeat(72));

  let pass = 0;
  const fails: { id: string; reasons: string[] }[] = [];
  const now = new Date("2026-07-30T12:00:00");

  for (const c of CASES) {
    const reasons: string[] = [];
    let reply = "";

    if (c.vision) {
      const err = c.vision();
      if (err) reasons.push(`vision:${err}`);
    } else if (c.q) {
      const { label, args } = resolveRoute(c.q);

      if (c.wantRoute && !routeOk(label, c.wantRoute)) {
        reasons.push(`route got ${label} want ${c.wantRoute}`);
      }
      if (!argsOk(args, c.args)) {
        reasons.push(`args ${JSON.stringify(args)} want ${JSON.stringify(c.args)}`);
      }

      if (c.wantDay) {
        const range = resolveCalendarQueryRange(c.q, now);
        if (!range.timeMin.startsWith(c.wantDay)) {
          reasons.push(`calendar day ${range.timeMin.slice(0, 10)} want ${c.wantDay}`);
        }
      }

      if (c.facts) {
        reply = deterministicNaturalReply(c.facts, c.q, c.capabilityId);
        const rf = replyOk(reply, c.must, c.mustNot, c.facts);
        reasons.push(...rf.map((r) => `reply:${r}`));
      }
    } else {
      reasons.push("invalid case: no q and no vision");
    }

    if (reasons.length === 0) {
      pass++;
    } else {
      fails.push({ id: c.id, reasons });
      console.log(`\n[FAIL] ${c.id} (${c.cat}) ${c.q ? `"${c.q}"` : "(vision-math)"}`);
      for (const r of reasons) console.log(`  - ${r}`);
      if (reply) console.log(`  reply: ${reply.slice(0, 160)}`);
    }
  }

  console.log("\n" + "â”€".repeat(72));
  console.log(`SUMMARY  ${pass}/100 PASS  |  ${fails.length} FAIL`);

  const byCat = new Map<string, { p: number; t: number }>();
  for (const c of CASES) {
    const s = byCat.get(c.cat) ?? { p: 0, t: 0 };
    s.t++;
    if (!fails.some((f) => f.id === c.id)) s.p++;
    byCat.set(c.cat, s);
  }
  for (const [cat, s] of byCat) console.log(`  ${cat}: ${s.p}/${s.t}`);

  writeFileSync(
    "suite-100-report.json",
    JSON.stringify({ at: new Date().toISOString(), pass, fail: fails.length, fails }, null, 2),
  );
  console.log("\nWrote suite-100-report.json");

  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

