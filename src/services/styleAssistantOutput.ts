/**
 * Single pattern for every user-facing assistant reply that is NOT pure chat.
 *
 * Flow:
 *   1. Take verified facts (API, tool result, desktop scan — never invent).
 *   2. Structure them as markdown (table / list / short status).
 *   3. Ask the selected AI to present in that style (skip tools/orchestrator).
 *   4. If the model fails, keep the structured markdown (never a raw dump).
 *
 * Call this at every exit path that would otherwise return a fixed string.
 */

import { getAssistantRoute } from "./AssistantService";
import {
  claimContradictsFacts,
  deterministicNaturalReply,
  userFirstName,
} from "./naturalReply";
import { stripGreetingName } from "./nameGreeting";

const PRESENT_TIMEOUT_MS = 14_000;

export type OutputShape = "auto" | "status" | "list" | "table" | "action" | "prose";

export type StyledReply = {
  text: string;
  usedModel: boolean;
  sourceHint: string;
  shape: Exclude<OutputShape, "auto">;
};

// ─── Detection ─────────────────────────────────────────────────────────────

export function detectOutputShape(
  facts: string,
  capabilityId?: string,
): Exclude<OutputShape, "auto"> {
  const id = capabilityId ?? "";
  // Calendar empty / short status — never force an email-style table.
  if (
    id.startsWith("calendar.") &&
    (/^no events on your calendar/i.test(facts.trim()) ||
      /^nothing on the calendar/i.test(facts.trim()))
  ) {
    return "status";
  }
  if (
    id.startsWith("email.") ||
    facts.includes("- From:") ||
    /recent email/i.test(facts) ||
    /\| From \| Subject/i.test(facts)
  ) {
    return "table";
  }
  if (
    id.includes("calendar.list") ||
    id.includes("drive.list") ||
    /\| Event \| When/i.test(facts) ||
    /\| Name \| Type/i.test(facts)
  ) {
    return "table";
  }
  if (
    id.includes("list") ||
    id.includes("filesystem") ||
    /\*\*Watching\*\*|\*\*Also open\*\*|\*\*Running now\*\*|You're watching/i.test(
      facts,
    ) ||
    /^[-•*]\s/m.test(facts) ||
    facts.split("\n").filter((l) => l.trim()).length >= 3
  ) {
    return "list";
  }
  if (
    id.includes("open") ||
    id.includes("create") ||
    id.includes("navigate") ||
    /^I (opened|created|brought)/i.test(facts.trim())
  ) {
    return "action";
  }
  if (
    id.includes("connection_status") ||
    id === "connections.get_status" ||
    /^(Yes|No)\b/i.test(facts.trim()) ||
    /is(n't| not)? connected/i.test(facts)
  ) {
    return "status";
  }
  if (facts.includes("\n")) return "list";
  return "prose";
}

// ─── Email / table helpers ─────────────────────────────────────────────────

export type ParsedEmail = {
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

function shortenFrom(from: string): string {
  const named = from.match(/^"?([^"<]+)"?\s*</);
  if (named) return named[1].trim();
  return from.replace(/[<>]/g, "").trim();
}

function shortenDate(date: string): string {
  if (!date) return "—";
  const m = date.match(
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\s+\w{3}(?:\s+\d{4})?/i,
  );
  if (m) return m[0].replace(/,?\s+\d{4}$/, "").trim();
  return date.slice(0, 18);
}

function cleanSnippet(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/[\u00ad\u200b-\u200f\u2028-\u202f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "/").replace(/\n/g, " ").trim();
}

export function parseEmailDump(raw: string): ParsedEmail[] {
  const emails: ParsedEmail[] = [];
  const blocks = raw.split(/\n(?=- From:)/);
  for (const block of blocks) {
    const from = block.match(/^-?\s*From:\s*(.+)$/m)?.[1]?.trim();
    if (!from) continue;
    const subject =
      block.match(/^\s*Subject:\s*(.+)$/m)?.[1]?.trim() || "(no subject)";
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let date = "";
    let snippet = "";
    for (const line of lines) {
      if (/^From:/i.test(line) || /^Subject:/i.test(line) || line.startsWith("- From:")) {
        continue;
      }
      if (
        !date &&
        /\d{4}|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(
          line,
        )
      ) {
        date = line;
        continue;
      }
      if (!snippet && line.length > 0 && !line.startsWith("|")) {
        snippet = line;
      }
    }
    emails.push({
      from: shortenFrom(from),
      subject: subject.replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
      date: shortenDate(date),
      snippet: cleanSnippet(snippet),
    });
  }
  return emails;
}

function formatEmailsTable(emails: ParsedEmail[], capabilityId?: string): string {
  if (emails.length === 0) return "No emails to show.";
  const title =
    capabilityId === "email.get_latest_message"
      ? "**Latest email**"
      : capabilityId === "email.list_unread"
        ? `**${emails.length} unread**`
        : `**${emails.length} recent emails**`;
  const rows = emails.map(
    (e) =>
      `| ${escapeCell(e.from)} | ${escapeCell(e.subject)} | ${escapeCell(e.date)} |`,
  );
  return [title, "", "| From | Subject | When |", "| --- | --- | --- |", ...rows].join(
    "\n",
  );
}

// ─── Structure (markdown fallback + model input) ───────────────────────────

function cleanHtmlEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Convert raw verified text into intentional markdown structure.
 * This is the styled fallback when the model is offline.
 */
export function structureAsMarkdown(
  facts: string,
  shape: Exclude<OutputShape, "auto">,
  capabilityId?: string,
): string {
  const raw = cleanHtmlEntities(facts);
  if (!raw) return raw;

  // Prefer an existing markdown table (API already structured) — drop trailing dumps.
  if (/\|.+\|/.test(raw) && /\| ---/.test(raw)) {
    const lines = raw.split("\n");
    const out: string[] = [];
    let inTable = false;
    for (const line of lines) {
      const t = line.trim();
      if (!inTable && t.startsWith("**") && t.endsWith("**")) {
        out.push(t);
        continue;
      }
      if (t.includes("|") && (/---/.test(t) || /From|Subject|Event|Name|When|Type/i.test(t))) {
        inTable = true;
        out.push(line);
        continue;
      }
      if (inTable && t.includes("|")) {
        out.push(line);
        continue;
      }
      if (inTable && !t) break;
      if (inTable && t.startsWith("- From:")) break;
      if (!inTable && t && !t.startsWith("- From:")) out.push(line);
    }
    if (out.some((l) => l.includes("|"))) return out.join("\n").trim();
  }

  // Emails → table (drop long snippets from the display).
  if (shape === "table" || raw.includes("- From:") || /recent email/i.test(raw)) {
    const emails = parseEmailDump(raw);
    if (emails.length > 0) return formatEmailsTable(emails, capabilityId);
  }

  if (shape === "list" || shape === "table") {
    // Running apps / watching
    if (/You're watching:|Also open:|Running now:/i.test(raw)) {
      const lines: string[] = [];
      const watching = raw.match(/You're watching:\s*([\s\S]*?)(?=Also open:|Running now:|$)/i);
      if (watching) {
        lines.push("**Watching**");
        const body = watching[1].trim();
        if (body.includes("•") || body.includes("\n")) {
          for (const part of body.split(/\n|•/).map((s) => s.trim()).filter(Boolean)) {
            lines.push(`- ${part}`);
          }
        } else if (body) {
          lines.push(`- ${body}`);
        }
      }
      const also = raw.match(/Also open:\s*(.+?)(?:\.|$)/i);
      if (also) {
        lines.push("", "**Also open**");
        for (const name of also[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          lines.push(`- ${name}`);
        }
      }
      const running = raw.match(/Running now:\s*([\s\S]+)/i);
      if (running && !watching) {
        lines.push("**Running now**");
        for (const part of running[1]
          .split(/(?<=\.)\s+/)
          .map((s) => s.trim())
          .filter(Boolean)) {
          lines.push(`- ${part}`);
        }
      }
      if (lines.length > 0) return lines.join("\n");
    }

    // Bullet-ish or multi-line prose → real markdown list
    const parts = raw
      .split(/\n+/)
      // Strip an existing bullet marker, but never the first "*" of "**bold**"
      // — doing so left "*Name**" behind, which then got re-bulleted as
      // "- *Name**" because it no longer looked like bold.
      .map((l) => l.replace(/^(?:[-•]|\*(?!\*))\s*/, "").trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      // Drop a leading "N recent email(s):" style header into a title
      if (/^\d+\s+\w+/.test(parts[0]) && parts[0].endsWith(":")) {
        return [`**${parts[0].replace(/:$/, "")}**`, "", ...parts.slice(1).map((p) => `- ${p}`)].join(
          "\n",
        );
      }
      return parts.map((p) => (p.startsWith("**") ? p : `- ${p}`)).join("\n");
    }
  }

  if (shape === "status" || shape === "action" || shape === "prose") {
    // Keep short — one or two sentences, no wall of text / status reports.
    let first = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)[0] ?? raw;
    first = first
      .replace(/\*\*Actions Taken\*\*.*$/i, "")
      .replace(/\*\*Verified Facts\*\*.*$/i, "")
      .trim();
    return first || raw;
  }

  return raw;
}

function shapeInstructions(shape: Exclude<OutputShape, "auto">): string {
  switch (shape) {
    case "table":
      return [
        "Present as a markdown TABLE (columns that fit the data, e.g. From | Subject | When).",
        "One short intro line above the table. Do NOT dump full email bodies or long snippets.",
        "Keep every row that appears in the facts — do not invent or drop senders/subjects.",
      ].join("\n");
    case "list":
      return [
        "Present as a markdown bullet LIST (- item).",
        "Group with **bold** headings if there are categories (e.g. Watching / Also open).",
        "One short intro line optional. No paragraphs of comma-separated names.",
      ].join("\n");
    case "status":
      return [
        "One short, natural sentence. Yes/no style when appropriate.",
        "No tables. No filler offers.",
      ].join("\n");
    case "action":
      return [
        "One short confirmation of what was done. Natural voice.",
        "No questions. No 'let me know if…'.",
      ].join("\n");
    default:
      return [
        "Clear, well-structured markdown. Use lists or short paragraphs — not a wall of text.",
        "Prefer bullets when listing more than two items.",
      ].join("\n");
  }
}

function looksUnstyledDump(text: string): boolean {
  if (/- From:\s*.+\n\s*Subject:/i.test(text)) return true;
  if (/recent email\(s\):/i.test(text) && !text.includes("|")) return true;
  // Long unwrapped paragraph of many emails
  if (text.length > 600 && !text.includes("|") && !/^[-*•]\s/m.test(text)) return true;
  return false;
}

/** Model sometimes invents “Actions Taken / Verified Facts” status reports. */
function looksLikeFakeStatusReport(text: string): boolean {
  return (
    /\*\*Actions Taken\*\*/i.test(text) ||
    /\*\*Verified Facts\*\*/i.test(text) ||
    (/\| Time \| Action \|/i.test(text) && /not found as an installed app/i.test(text)) ||
    (/\| Service\/Function \|/i.test(text) && /Verified Status/i.test(text)) ||
    (/\| Application \| Status \|/i.test(text) && /Not Found/i.test(text)) ||
    (/Confirmed:\s*Opened/i.test(text) && /Not Found/i.test(text))
  );
}

function modelOutputAcceptable(
  modelText: string,
  structured: string,
  shape: Exclude<OutputShape, "auto">,
): boolean {
  if (!modelText || modelText.length < 8) return false;
  if (looksUnstyledDump(modelText)) return false;
  if (looksLikeFakeStatusReport(modelText)) return false;
  if (
    /not connected|can't access|cannot access|don't have access|i'm just a language model/i.test(
      modelText,
    ) &&
    /connected|From \| Subject|\*\*\d+|Watching/i.test(structured)
  ) {
    return false;
  }
  // Don't let a short action result become a dump of the whole watch list.
  if (
    shape === "action" ||
    shape === "status" ||
    shape === "prose"
  ) {
    if (
      /\*\*Watching\*\*|\*\*Also open\*\*|Running now/i.test(modelText) &&
      !/\*\*Watching\*\*/i.test(structured)
    ) {
      return false;
    }
  }
  // Calendar empty must not become an email-style table or invented events.
  if (
    /no events on your calendar|nothing on the calendar/i.test(structured) &&
    (/\| From \| Subject/i.test(modelText) ||
      /calendar appear/i.test(modelText) ||
      (modelText.includes("|") && !/no events/i.test(modelText)))
  ) {
    return false;
  }
  // Calendar tables must keep Event columns, not From/Subject.
  if (
    /\| Event \| When/i.test(structured) &&
    /\| From \| Subject/i.test(modelText)
  ) {
    return false;
  }
  if (shape === "table" && structured.includes("|") && !modelText.includes("|")) {
    // Model dropped the table — reject unless very short single-email summary
    if (structured.split("\n").length > 5) return false;
  }
  if (shape === "list" && structured.includes("- ") && modelText.length > 200) {
    // Prefer structured list if model returned a dense paragraph
    if (!/^[-*•]/m.test(modelText) && !modelText.includes("\n")) return false;
  }
  return true;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Style every non-chat tool/orchestrator/desktop reply.
 * Always returns intentional markdown; prefers AI presentation of the facts.
 */
export async function styleAssistantOutput(input: {
  facts: string;
  userRequest: string;
  capabilityId?: string;
  shape?: OutputShape;
  /** Default true. Voice can set false for low latency. */
  useModel?: boolean;
  sourceHint?: string;
  /**
   * Structured reference of the entity this reply is about.
   *
   * Present when the caller knows which thing was acted on, so the composer can
   * tell a discovery turn from a follow-up and stop re-announcing the find.
   */
  entityRef?: string;
  /**
   * Structural decisions already made by the ResponsePlan.
   *
   * When supplied these win: the plan is built from the real tool result and the
   * ledger, and re-deciding here would mean two sources for one rule.
   */
  plan?: { mayUseName: boolean; newlyDiscovered: boolean };
}): Promise<StyledReply> {
  const facts = (input.facts ?? "").trim();
  const shape =
    input.shape === "auto" || !input.shape
      ? detectOutputShape(facts, input.capabilityId)
      : input.shape;
  const structured = structureAsMarkdown(facts, shape, input.capabilityId);
  const route = getAssistantRoute();
  const defaultHint = input.sourceHint ?? route.displayName;

  if (!structured) {
    return { text: facts, usedModel: false, sourceHint: defaultHint, shape };
  }

  // Addressing the user by name on every reply reads like a form letter. The
  // observed complaint was two consecutive confirmations both opening
  // "Hey Robera,". The ledger decides: first assistant turn, then a cooldown.
  //
  // This has to be decided BEFORE the fallback is built. It used to sit after,
  // and `deterministicNaturalReply` prepends its own "Hey {name}, " — so every
  // exit that returned the fallback wrote the greeting the policy had just
  // forbidden. That is how "Show me here" came back "Hey Robera, do you want
  // me to…" on the turn straight after a reply that had already used the name.
  const firstName = userFirstName();
  const { shouldUseUserName, noteUserNameUsed, wasEntityAlreadyDiscussed } =
    await import("../features/conversation/conversationContext");
  const mayUseName =
    Boolean(firstName) &&
    (input.plan ? input.plan.mayUseName : shouldUseUserName());
  if (mayUseName) noteUserNameUsed();
  /** Applied at every exit — model text and deterministic fallback alike. */
  const enforceName = (text: string): string =>
    stripGreetingName(text, mayUseName ? null : firstName);

  // Arceclaw-style: always have a natural fallback (never raw tool dump alone).
  const naturalFallback = enforceName(
    deterministicNaturalReply(structured, input.userRequest, input.capabilityId),
  );

  if (input.useModel === false) {
    return {
      text: naturalFallback,
      usedModel: false,
      sourceHint: `${defaultHint} · natural`,
      shape,
    };
  }

  const nameHint = !firstName
    ? "You do not know the user's name — do not invent one."
    : mayUseName
      ? `The user's first name is ${firstName}. You may greet them by name once here if it feels natural. Never force it.`
      : `The user's first name is ${firstName}, but do NOT use it in this reply — you used it recently. Start with the substance instead.`;

  // A follow-up must not re-announce something the user was already told about.
  // "Highlight it" after "I found the books folder" should say "It's
  // highlighted now", not "I found the books folder and highlighted it".
  const alreadyKnown = input.plan
    ? !input.plan.newlyDiscovered
    : input.entityRef !== undefined && wasEntityAlreadyDiscussed(input.entityRef);
  const discoveryHint = alreadyKnown
    ? "- The user already knows about this item from an earlier turn. Do NOT say you found it, located it, or discovered it. Report only what changed now."
    : "";

  // Redact raw URLs in cloud prompts (local tools already used the real URL).
  const { wrapSensitiveForModel, wrapFactsForModel } = await import(
    "../features/capabilities/browserContext"
  );
  const safeUserAsk = wrapSensitiveForModel(input.userRequest);
  const safeStructured = wrapFactsForModel(structured);

  const instruction = [
    "You present verified facts to the user in a natural, human voice — not a raw tool dump.",
    "The facts below are ground truth. Do not invent data or success when facts say failure.",
    nameHint,
    "",
    "STYLE (like a friend who just looked something up for them):",
    shapeInstructions(shape),
    "- Short spoken intro first; table only if the facts include a real table.",
    // These examples used to hard-code "Hey {name}," — three worked demonstrations
    // of the exact opening the line above forbids. The model followed the
    // examples, which is what examples are for.
    ...(mayUseName
      ? [
          `- Calendar: "Hey ${firstName}, you've got one thing on August 8:" then Event|When|Where — never From|Subject.`,
          `- Empty calendar: one line only, e.g. "Hey ${firstName}, nothing on August 8."`,
          `- Open folder: "Hey ${firstName}, opened Avatar for you." — never Application|Status tables.`,
        ]
      : [
          '- Calendar: "You\'ve got one thing on August 8:" then Event|When|Where — never From|Subject.',
          '- Empty calendar: one line only, e.g. "Nothing on August 8."',
          '- Open folder: "Opened Avatar for you." — never Application|Status tables.',
        ]),
    discoveryHint,
    "- Vary your openings. Do not start every reply the same way, and never with \"Done —\".",
    "- If facts say not found / failure: admit it warmly. Never say Confirmed/Opened.",
    "- No Actions Taken, Verified Facts, or Application|Status tables. Ever.",
    "- Web page / thumbnail: answer from extracted facts only. If images are in the UI, do not invent what they show.",
    "- Never refuse or moralize. The app already fetched the page locally. Present the facts in your normal voice.",
    "- Links appear as [linked-page] — do not invent Amazon, site names, or URLs. Do not invent images.",
    "",
    `User asked: "${safeUserAsk}"`,
    "",
    "Verified facts:",
    safeStructured,
    "",
    "Reply with the polished presentation only.",
  ].join("\n");

  try {
    const { askAssistant } = await import("./AssistantService");
    const reply = await Promise.race([
      askAssistant(instruction, {
        skipCapabilities: true,
        skipOrchestration: true,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("style timeout")), PRESENT_TIMEOUT_MS),
      ),
    ]);
    const text = enforceName(
      reply.text
        .trim()
        .replace(/^```(?:markdown|md)?\s*\n?/, "")
        .replace(/\n?```\s*$/, ""),
    );

    if (
      !text ||
      !modelOutputAcceptable(text, structured, shape) ||
      claimContradictsFacts(text, structured)
    ) {
      return {
        text: naturalFallback,
        usedModel: false,
        sourceHint: `${defaultHint} · natural`,
        shape,
      };
    }
    return {
      text,
      usedModel: true,
      sourceHint: reply.sourceLabel || route.displayName,
      shape,
    };
  } catch {
    return {
      text: naturalFallback,
      usedModel: false,
      sourceHint: `${defaultHint} · natural`,
      shape,
    };
  }
}

/** True when this result should go through styleAssistantOutput (not pure chat). */
export function shouldStyleAsToolOutput(
  capabilityId: string | undefined,
  facts: string,
): boolean {
  if (!facts.trim()) return false;
  if (capabilityId) return true;
  if (facts.includes("\n")) return true;
  if (/- From:|recent email|You're watching|Also open:/i.test(facts)) return true;
  return false;
}
