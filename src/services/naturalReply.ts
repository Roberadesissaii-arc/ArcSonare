/**
 * Arceclaw-style final reply layer.
 *
 * Tools produce VERIFIED FACTS only. This module turns facts into a natural
 * user-facing message (optional first name, clean tables, no status dumps).
 * Modeled after Arceclaw's response-mode + claim-guard ideas:
 *  - prose lead-in first, structure second
 *  - never claim success when facts say failure
 *  - never invent Application|Status / Actions Taken tables
 */

import { loadAccountProfile } from "../features/account/accountProfile";

export function userFirstName(): string {
  try {
    const p = loadAccountProfile();
    const full = (p.displayName || p.fullName || "").trim();
    if (!full) return "";
    return full.split(/\s+/)[0] ?? "";
  } catch {
    return "";
  }
}

function hey(name: string): string {
  return name ? `Hey ${name}, ` : "";
}

/** True when facts indicate failure / not found. */
export function factsSayFailure(facts: string): boolean {
  return (
    /\bnot found\b/i.test(facts) ||
    /\bdoes not exist\b/i.test(facts) ||
    /\bcould(?:n't| not) (find|open|read)\b/i.test(facts) ||
    /\bisn't connected\b/i.test(facts) ||
    /\bno events on your calendar\b/i.test(facts) ||
    /\bnothing on the calendar\b/i.test(facts)
  );
}

/**
 * Model prose must not contradict verified facts (Arceclaw claim-guard idea).
 */
export function claimContradictsFacts(reply: string, facts: string): boolean {
  if (factsSayFailure(facts)) {
    if (
      /\b(opened|opening|created|playing|confirmed|success|got the screenshot|here's what you've got)\b/i.test(
        reply,
      ) &&
      !/\b(couldn't|could not|wasn't|was not|didn't|did not|no events|nothing on)\b/i.test(
        reply,
      )
    ) {
      return true;
    }
  }
  if (
    /\| Application \| Status \|/i.test(reply) ||
    /\*\*Actions Taken\*\*/i.test(reply) ||
    /\*\*Verified Facts\*\*/i.test(reply)
  ) {
    return true;
  }
  if (
    /no events on your calendar|nothing on the calendar/i.test(facts) &&
    /\| From \| Subject/i.test(reply)
  ) {
    return true;
  }
  if (/\| Event \| When/i.test(facts) && /\| From \| Subject/i.test(reply)) {
    return true;
  }
  return false;
}

/**
 * Deterministic natural reply when the model is offline or fails the claim guard.
 * Always preferred over dumping raw tool text.
 */
export function deterministicNaturalReply(
  facts: string,
  userRequest: string,
  capabilityId?: string,
): string {
  const name = userFirstName();
  const f = facts.trim();
  const q = userRequest.toLowerCase();

  // Calendar empty
  if (/^no events on your calendar/i.test(f) || /^nothing on the calendar/i.test(f)) {
    const day =
      f.match(/for (.+)\.?$/i)?.[1]?.replace(/\.$/, "") ||
      q.match(
        /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?/i,
      )?.[0] ||
      "that day";
    return `${hey(name)}nothing on your calendar for ${day}.`.replace(/\s+/g, " ").trim();
  }

  // Calendar with table
  if (/\| Event \| When/i.test(f)) {
    const countMatch = f.match(/\*\*(\d+)\s+events?\b/i);
    const count = countMatch ? Number(countMatch[1]) : 0;
    const day =
      f.match(/on ([^*]+)\*\*/i)?.[1]?.trim() ||
      q.match(
        /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?/i,
      )?.[0] ||
      "your calendar";
    // Extract table portion only
    const tableStart = f.indexOf("| Event |");
    const table = tableStart >= 0 ? f.slice(tableStart).trim() : f;
    const lead =
      count === 1
        ? `${hey(name)}you've got one thing on ${day}:`
        : count > 1
          ? `${hey(name)}you've got ${count} things on ${day}:`
          : `${hey(name)}here's what's on ${day}:`;
    return `${lead}\n\n${table}`;
  }

  // Folder / file open
  if (
    capabilityId === "filesystem.open_item" ||
    capabilityId === "filesystem.reveal_in_explorer" ||
    /^opened [“"]/i.test(f) ||
    /^showing [“"]/i.test(f) ||
    /\bdoes not exist\b/i.test(f)
  ) {
    if (factsSayFailure(f)) {
      let nameGuess =
        f.match(/[“"]([^”"]+)[”"]/)?.[1] ||
        f.match(/"([^"]+)"/)?.[1] ||
        q.match(/folder\s+(?:called|named|call)\s+(\w+)/i)?.[1] ||
        q.match(/(?:the\s+)?(\w+)\s+folder/i)?.[1] ||
        "that folder";
      // Path → leaf folder name only
      if (/[/\\]/.test(nameGuess)) {
        nameGuess = nameGuess.split(/[/\\]/).filter(Boolean).pop() ?? nameGuess;
      }
      return name
        ? `Hey ${name}, I couldn't find “${nameGuess}” there. Double-check the name?`
        : `I couldn't find “${nameGuess}” there. Double-check the name?`;
    }
    const leaf =
      f.match(/[“"]([^”"]+)[”"]/)?.[1] || f.match(/"([^"]+)"/)?.[1];
    if (leaf) {
      return name
        ? `Hey ${name}, opened “${leaf}” for you.`
        : `Opened “${leaf}” for you.`;
    }
    return name ? `Hey ${name}, opened that for you.` : "Opened that for you.";
  }

  // App open not found
  if (
    /couldn't find an app called|was not found as an installed app/i.test(f) ||
    (capabilityId === "applications.open" && factsSayFailure(f))
  ) {
    return name
      ? `Hey ${name}, I couldn't find that app. Want me to open a folder or a website instead?`
      : "I couldn't find that app. Want me to open a folder or a website instead?";
  }

  // App open success
  if (capabilityId === "applications.open" && !factsSayFailure(f)) {
    const app = f.match(/opened\s+(.+?)(?:\.|$)/i)?.[1]?.replace(/[.“"]/g, "").trim();
    if (app) return name ? `Hey ${name}, opened ${app}.` : `Opened ${app}.`;
  }

  // App close
  if (capabilityId === "applications.close" && !factsSayFailure(f)) {
    const app =
      f.match(/closed\s+(.+?)(?:\.|$)/i)?.[1]?.replace(/[.“"]/g, "").trim() ||
      q.match(/(?:close|quit|exit)\s+(.+)/i)?.[1]?.trim();
    if (app) return name ? `Hey ${name}, closed ${app}.` : `Closed ${app}.`;
    return name ? `Hey ${name}, closed it.` : "Closed it.";
  }

  // Vision: screen description
  if (capabilityId === "screen.understand") {
    if (factsSayFailure(f)) {
      return name
        ? `Hey ${name}, I couldn't read the screen just now. Try again?`
        : "I couldn't read the screen just now. Try again?";
    }
    return name && !f.toLowerCase().startsWith("hey ")
      ? `Hey ${name}, ${f.charAt(0).toLowerCase()}${f.slice(1)}`
      : f;
  }

  // Vision click
  if (capabilityId === "screen.click_target" || capabilityId === "input.click_at") {
    if (factsSayFailure(f) || /couldn't find|could not find|not found/i.test(f)) {
      const t =
        f.match(/[“"]([^”"]+)[”"]/)?.[1] ||
        q.match(/(?:click|press|tap)\s+(?:on\s+)?(?:the\s+)?(.+)/i)?.[1] ||
        "that";
      return name
        ? `Hey ${name}, I couldn't find “${t}” on the screen.`
        : `I couldn't find “${t}” on the screen.`;
    }
    const label = f.match(/clicked\s+[“"]([^”"]+)[”"]/i)?.[1];
    if (label) {
      return name ? `Hey ${name}, clicked “${label}”.` : `Clicked “${label}”.`;
    }
    return name && !f.toLowerCase().startsWith("hey ")
      ? `Hey ${name}, ${f.charAt(0).toLowerCase()}${f.slice(1)}`
      : f;
  }

  // YouTube ordinal open (success or failure) — keep short; never essay.
  if (capabilityId === "web.activate_listed_item" || /playing .* on youtube/i.test(f)) {
    if (
      factsSayFailure(f) ||
      /couldn'?t (read|open|find)|could not (read|open|find)|no #\d|media-item|unavailable/i.test(f)
    ) {
      const which =
        q.match(
          /\b(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\b/i,
        )?.[1] ?? "that";
      return name
        ? `Hey ${name}, I couldn't open the ${which} video from YouTube's list. Try “search youtube for …” first, then “open the ${which} video” again.`
        : `I couldn't open the ${which} video from YouTube's list. Try searching YouTube first, then ask again.`;
    }
    // Prefer “Playing "Title" on YouTube.”
    if (/playing /i.test(f)) {
      return name && !f.toLowerCase().startsWith("hey ")
        ? `Hey ${name}, ${f.charAt(0).toLowerCase()}${f.slice(1)}`
        : f;
    }
    return f.startsWith("Hey ")
      ? f
      : name
        ? `Hey ${name}, ${f.charAt(0).toLowerCase()}${f.slice(1)}`
        : f;
  }

  // Email tables — keep table, add short lead-in
  if (/\| From \| Subject/i.test(f)) {
    const lead = name
      ? `Hey ${name}, here's what's in your inbox:`
      : "Here's what's in your inbox:";
    const tableStart = f.indexOf("| From |");
    const table = tableStart >= 0 ? f.slice(tableStart).trim() : f;
    return `${lead}\n\n${table}`;
  }

  // Connection yes/no
  if (/^yes —/i.test(f) || /\bis connected/i.test(f)) {
    return name ? `Hey ${name}, ${f.charAt(0).toLowerCase()}${f.slice(1)}` : f;
  }

  // Default: short facts only, strip fake status reports
  if (looksLikeStatusDump(f)) {
    return name
      ? `Hey ${name}, something went wrong with that request. Try rephrasing it?`
      : "Something went wrong with that request. Try rephrasing it?";
  }

  // Single-line facts — optional name prefix if multi-word result
  if (!f.includes("\n") && name && f.length > 40 && !f.toLowerCase().startsWith("hey ")) {
    return `Hey ${name}, ${f.charAt(0).toLowerCase()}${f.slice(1)}`;
  }
  return f;
}

function looksLikeStatusDump(text: string): boolean {
  return (
    /\| Application \| Status \|/i.test(text) ||
    /\*\*Actions Taken\*\*/i.test(text) ||
    /\*\*Verified Facts\*\*/i.test(text)
  );
}
