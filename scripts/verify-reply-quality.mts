/**
 * REPLY CORRECTNESS eval (Arceclaw-style) — not just routing.
 *
 * For each case we:
 *   1. Know the VERIFIED FACTS (what the tool would return)
 *   2. Run deterministicNaturalReply + styleAssistantOutput (if --live)
 *   3. Assert the user-facing text is correct AND natural
 *
 * Run:
 *   npx tsx scripts/verify-reply-quality.mts
 *   npx tsx scripts/verify-reply-quality.mts --live   # also ask Ollama to present
 */

import {
  claimContradictsFacts,
  deterministicNaturalReply,
  factsSayFailure,
} from "../src/services/naturalReply";
import { routeDeterministic } from "../src/features/capabilities/capabilityRouter";
import {
  classifyIntent,
  isOrchestratedDomain,
} from "../src/features/orchestration/IntentClassifier";
import { resolveCalendarQueryRange } from "../src/features/orchestration/parseCalendarRange";

const LIVE = process.argv.includes("--live");

type Case = {
  id: string;
  q: string;
  /** Simulated tool facts (ground truth). */
  facts: string;
  capabilityId?: string;
  /** Reply must match at least one of these. */
  must: RegExp[];
  /** Reply must NOT match any of these. */
  mustNot: RegExp[];
  /** Expected route prefix when routing is checked. */
  wantRoute?: string;
};

const CASES: Case[] = [
  {
    id: "cal-aug8-has-event",
    q: "what do I have on August 8th",
    facts:
      "**1 event on August 8, 2026**\n\n| Event | When | Where |\n| --- | --- | --- |\n| Aurallio - Standard - Robera Desissa | Aug 8, 2:30 PM | — |",
    capabilityId: "calendar.list_events",
    must: [/aurallio/i, /aug(ust)?\s*8|august 8/i, /2:30|event/i],
    mustNot: [
      /from\s*\|\s*subject/i,
      /application\s*\|\s*status/i,
      /actions taken/i,
      /appears to be empty/i,
      /no events/i,
    ],
    wantRoute: "orchestrated:calendar",
  },
  {
    id: "cal-empty-day",
    q: "what do I have on August 20th",
    facts: "No events on your calendar for August 20, 2026.",
    capabilityId: "calendar.list_events",
    must: [/nothing|no events/i, /august\s*20|aug\s*20/i],
    mustNot: [/from\s*\|\s*subject/i, /application\s*\|\s*status/i, /aurallio/i],
    wantRoute: "orchestrated:calendar",
  },
  {
    id: "folder-open-ok",
    q: "open the avatar folder on my desktop",
    facts: 'Opened "Avatar" with its default app.',
    capabilityId: "filesystem.open_item",
    must: [/open/i, /avatar/i],
    mustNot: [/application\s*\|\s*status/i, /not found/i, /confirmed:/i],
    wantRoute: "capability:filesystem.open_item",
  },
  {
    id: "folder-open-missing",
    q: "open folder call avater it is in my desktop",
    facts: '"C:\\Users\\x\\Desktop\\avater" does not exist.',
    capabilityId: "filesystem.open_item",
    must: [/couldn'?t find|could not find|don'?t see/i],
    mustNot: [/confirmed:\s*opened/i, /application\s*\|\s*status/i],
    wantRoute: "capability:filesystem.open_item",
  },
  {
    id: "app-not-video",
    q: "open the third video",
    facts: 'Playing “Lo-fi beats” on YouTube.',
    capabilityId: "web.activate_listed_item",
    must: [/youtube|playing|video|lo-fi/i],
    mustNot: [/installed app/i, /application\s*\|\s*status/i],
    wantRoute: "capability:web.activate_listed_item",
  },
  {
    id: "app-not-found-phrase",
    q: "open folder call avater it is in my desktop",
    facts:
      'I couldn\'t find an app called “folder call avater it is in my desktop”. If you meant a YouTube video, say “open the first/second/third video”.',
    capabilityId: "applications.open",
    must: [/couldn'?t find|folder|app/i],
    mustNot: [/confirmed:\s*opened/i, /\| application \| status \|/i],
  },
  {
    id: "gmail-connected",
    q: "is my gmail connected",
    facts: "Yes — Gmail is connected to ArcSonare.",
    capabilityId: "email.get_connection_status",
    must: [/yes|connected/i, /gmail/i],
    mustNot: [/application\s*\|\s*status/i, /not connected/i],
    wantRoute: "orchestrated:email",
  },
  {
    id: "open-youtube",
    q: "open youtube",
    facts: "Opened YouTube.",
    capabilityId: "applications.open",
    must: [/open/i, /youtube/i],
    mustNot: [/not found/i, /application\s*\|\s*status/i],
    wantRoute: "capability:applications.open",
  },
];

function routeLabel(q: string): string {
  const c = classifyIntent(q);
  if (isOrchestratedDomain(c)) return `orchestrated:${c.domain}`;
  const d = routeDeterministic(q);
  if (d) return `capability:${d.capabilityId}`;
  return "chat";
}

function scoreReply(
  reply: string,
  c: Case,
): { ok: boolean; fails: string[] } {
  const fails: string[] = [];
  for (const re of c.must) {
    if (!re.test(reply)) fails.push(`missing /${re.source}/`);
  }
  for (const re of c.mustNot) {
    if (re.test(reply)) fails.push(`forbidden /${re.source}/`);
  }
  if (claimContradictsFacts(reply, c.facts)) {
    fails.push("claim-contradicts-facts");
  }
  if (factsSayFailure(c.facts) && /\bconfirmed:\s*opened\b/i.test(reply)) {
    fails.push("false-success");
  }
  return { ok: fails.length === 0, fails };
}

async function main() {
  console.log("═".repeat(72));
  console.log("REPLY QUALITY VERIFY (facts → natural reply correctness)");
  console.log(`Mode: ${LIVE ? "live model present" : "deterministic natural only"}`);
  console.log("═".repeat(72));

  let pass = 0;
  const failures: string[] = [];

  for (const c of CASES) {
    // Route check
    if (c.wantRoute) {
      const got = routeLabel(c.q);
      if (!got.startsWith(c.wantRoute) && got !== c.wantRoute) {
        // filesystem.open_item vs applications.open for folder
        if (
          c.wantRoute.includes("filesystem.open_item") &&
          got.includes("filesystem.open_item")
        ) {
          // ok
        } else {
          failures.push(`${c.id}: route ${got} want ${c.wantRoute}`);
          console.log(`\n[FAIL-ROUTE] ${c.id}\n  Q: ${c.q}\n  got ${got} want ${c.wantRoute}`);
          continue;
        }
      }
    }

    // Calendar range sanity for date asks
    if (c.id.startsWith("cal-aug") || /august\s*8/i.test(c.q)) {
      const range = resolveCalendarQueryRange(c.q, new Date("2026-07-30"));
      if (range.relativeExpression !== "absolute_day") {
        failures.push(`${c.id}: calendar range not absolute_day`);
        console.log(`\n[FAIL-RANGE] ${c.id} range=${range.relativeExpression}`);
        continue;
      }
      if (!range.timeMin.startsWith("2026-08-08")) {
        failures.push(`${c.id}: timeMin ${range.timeMin}`);
        console.log(`\n[FAIL-RANGE] ${c.id} timeMin=${range.timeMin}`);
        continue;
      }
    }

    let reply = deterministicNaturalReply(c.facts, c.q, c.capabilityId);

    if (LIVE) {
      try {
        // Dynamic import — styleAssistantOutput pulls modelRegistry SVGs in Vite.
        const { styleAssistantOutput } = await import(
          "../src/services/styleAssistantOutput.ts"
        );
        const styled = await styleAssistantOutput({
          facts: c.facts,
          userRequest: c.q,
          capabilityId: c.capabilityId,
          useModel: true,
        });
        reply = styled.text;
      } catch {
        console.log(`  (live present failed for ${c.id}, using deterministic)`);
      }
    }

    const { ok, fails } = scoreReply(reply, c);
    if (ok) {
      pass++;
      console.log(`\n[PASS] ${c.id}`);
      console.log(`  Q: ${c.q}`);
      console.log(`  reply: ${reply.replace(/\s+/g, " ").slice(0, 180)}`);
    } else {
      failures.push(`${c.id}: ${fails.join("; ")}`);
      console.log(`\n[FAIL] ${c.id}`);
      console.log(`  Q: ${c.q}`);
      console.log(`  facts: ${c.facts.slice(0, 100)}…`);
      console.log(`  reply: ${reply.slice(0, 220)}`);
      console.log(`  fails: ${fails.join(", ")}`);
    }
  }

  console.log("\n" + "─".repeat(72));
  console.log(`SUMMARY  ${pass}/${CASES.length} replies CORRECT`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }

  // Folder route dedicated check
  const folderRoute = routeDeterministic(
    "open the avatar folder on my desktop",
  );
  if (folderRoute?.capabilityId !== "filesystem.open_item") {
    console.log(
      `\n[FAIL] folder route is ${folderRoute?.capabilityId} (want filesystem.open_item)`,
    );
    process.exit(1);
  } else {
    console.log("\n[PASS] open avatar folder → filesystem.open_item");
  }

  process.exit(pass === CASES.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
