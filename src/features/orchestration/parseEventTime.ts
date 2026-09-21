/**
 * Extracts a title and start/end time from natural phrasing like
 * "i have an appointment today at 1:30 add to my calendar".
 *
 * Deliberately conservative: when the time cannot be determined it returns
 * null, and the caller asks the user rather than guessing a slot. Silently
 * inventing a time is worse than asking.
 */

export interface ParsedEvent {
  title: string;
  /** RFC3339 with local offset. */
  start: string;
  end: string;
  /** True when only a date was found and 09:00 was assumed. */
  assumedTime: boolean;
}

const DEFAULT_DURATION_MIN = 60;

function rfc3339Local(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Pulls "1:30", "at 3pm", "13:00" out of the text. */
function extractTime(text: string): { hour: number; minute: number } | null {
  // 1:30pm / 1:30 / 13:00
  const withMinutes = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (withMinutes) {
    let hour = Number(withMinutes[1]);
    const minute = Number(withMinutes[2]);
    const mer = withMinutes[3]?.toLowerCase();
    if (minute > 59) return null;
    if (mer === "pm" && hour < 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
    // No meridiem and an ambiguous small hour: assume daytime (1:30 → 13:30).
    if (!mer && hour >= 1 && hour <= 7) hour += 12;
    return hour <= 23 ? { hour, minute } : null;
  }
  // "at 3pm" / "at 9 am"
  const hourOnly = text.match(/\bat\s+(\d{1,2})\s*(am|pm)\b/i);
  if (hourOnly) {
    let hour = Number(hourOnly[1]);
    const mer = hourOnly[2].toLowerCase();
    if (mer === "pm" && hour < 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
    return hour <= 23 ? { hour, minute: 0 } : null;
  }
  return null;
}

/** Resolves today / tomorrow / a weekday name to a date. */
function extractDay(text: string, now: Date): Date {
  const base = new Date(now);
  if (/\btomorrow\b/i.test(text)) {
    base.setDate(base.getDate() + 1);
    return base;
  }
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const named = weekdays.findIndex((d) => new RegExp(`\\b${d}\\b`, "i").test(text));
  if (named >= 0) {
    // Next occurrence of that weekday (today counts only if it is that day).
    const delta = (named - base.getDay() + 7) % 7;
    base.setDate(base.getDate() + delta);
  }
  return base;
}

/** Strips scheduling scaffolding to leave a usable event title. */
function extractTitle(text: string): string {
  let t = ` ${text} `
    // Politeness / framing.
    .replace(/\b(?:please\s+)?(?:can|could|would|will)\s+you\b/gi, " ")
    .replace(/\bi\s+(?:have|have\s+got|got|need)\s+(?:an?\s+)?/gi, " ")
    .replace(/\bfor\s+me\b/gi, " ")
    // "to/on/in my calendar" anywhere in the sentence.
    .replace(/\b(?:to|on|in|into)\s+(?:my\s+)?(?:cal[ae]nd[ae]r|schedule|agenda)\b/gi, " ")
    .replace(/\bmy\s+(?:cal[ae]nd[ae]r|schedule|agenda)\b/gi, " ")
    // Times and days, in any position.
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, " ")
    .replace(/\b(?:today|tomorrow|tonight)\b/gi, " ")
    .replace(/\b(?:on\s+|this\s+|next\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Leading scheduling verb, stripped last so it can't eat a real title word
  // that happens to follow a time expression.
  t = t
    .replace(/^(?:add|put|save|create|schedule|book|set\s+up|make)\s+(?:an?\s+|the\s+|it\s+|this\s+)?/i, "")
    .replace(/^(?:an?|the)\s+/i, "")
    // Trailing verb left behind by phrasing like "… at 1:30 add to my calendar",
    // where removing the calendar phrase strands the verb at the end.
    .replace(/\s+(?:add|put|save|schedule|book)$/i, "")
    .replace(/[.!?,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!t) t = "Appointment";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function parseEventFromText(text: string, now = new Date()): ParsedEvent | null {
  const time = extractTime(text);
  const day = extractDay(text, now);

  // No time at all and no day word → too vague to schedule.
  const hasDayWord = /\b(today|tomorrow|tonight|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(text);
  if (!time && !hasDayWord) return null;

  const start = new Date(day);
  if (time) {
    start.setHours(time.hour, time.minute, 0, 0);
  } else {
    start.setHours(9, 0, 0, 0);
  }
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);

  return {
    title: extractTitle(text),
    start: rfc3339Local(start),
    end: rfc3339Local(end),
    assumedTime: !time,
  };
}
