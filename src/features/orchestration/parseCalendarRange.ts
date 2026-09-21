/**
 * Resolve calendar read windows from natural language.
 * "August 8th", "on Aug 8", "today", "tomorrow", "this week".
 */

export type CalendarQueryRange = {
  /** Inclusive start of the window (local → ISO). */
  timeMin: string;
  /** Exclusive-ish end of the window (local end-of-day → ISO). */
  timeMax: string;
  /** Short label for empty-state copy, e.g. "August 8". */
  label: string;
  relativeExpression: string;
};

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function monthLabel(monthIndex: number, day: number, year: number): string {
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${names[monthIndex]} ${day}, ${year}`;
}

/**
 * Parse absolute dates like "August 8", "aug 8th", "8/8", "2026-08-08".
 * Year defaults to current if omitted; if that date already passed this year,
 * use next year only when the month/day is more than ~1 day in the past.
 */
export function parseAbsoluteCalendarDay(
  text: string,
  now = new Date(),
): { day: Date; label: string } | null {
  const n = text.toLowerCase();

  // ISO-ish 2026-08-08
  const iso = n.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day);
      return { day: d, label: monthLabel(month, day, year) };
    }
  }

  // August 8 / Aug 8th / August 8th 2026
  const named = n.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept?|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i,
  );
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    const day = Number(named[2]);
    let year = named[3] ? Number(named[3]) : now.getFullYear();
    if (month == null || day < 1 || day > 31) return null;
    let d = new Date(year, month, day);
    // If no year and the date is clearly in the past (e.g. asking in late year for Jan), keep current year;
    // if more than 1 day past, roll to next year for near-term planning.
    if (!named[3]) {
      const endToday = endOfLocalDay(now).getTime();
      if (d.getTime() < endToday - 36 * 3600 * 1000) {
        // More than ~1.5 days ago — assume next year only if within 11 months ahead would be weird;
        // For "what do I have on August 8" in July, same year is correct. For asking in Sept about Aug 8, next year.
        d = new Date(year + 1, month, day);
        year = year + 1;
      }
    }
    return { day: d, label: monthLabel(month, day, year) };
  }

  // 8/8 or 8/8/2026 (US style month/day)
  const slash = n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
  if (slash) {
    const month = Number(slash[1]) - 1;
    const day = Number(slash[2]);
    let year = now.getFullYear();
    if (slash[3]) {
      year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    }
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let d = new Date(year, month, day);
      if (!slash[3] && d.getTime() < endOfLocalDay(now).getTime() - 36 * 3600 * 1000) {
        d = new Date(year + 1, month, day);
        year += 1;
      }
      return { day: d, label: monthLabel(month, day, year) };
    }
  }

  return null;
}

/** Full query range for a calendar list/read. */
export function resolveCalendarQueryRange(
  utterance: string,
  now = new Date(),
): CalendarQueryRange {
  const n = utterance.toLowerCase();
  const absolute = parseAbsoluteCalendarDay(utterance, now);
  if (absolute) {
    const start = startOfLocalDay(absolute.day);
    const end = endOfLocalDay(absolute.day);
    return {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      label: absolute.label,
      relativeExpression: "absolute_day",
    };
  }

  if (/\btomorrow\b/.test(n)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return {
      timeMin: startOfLocalDay(d).toISOString(),
      timeMax: endOfLocalDay(d).toISOString(),
      label: "tomorrow",
      relativeExpression: "tomorrow",
    };
  }

  if (/\bthis\s+week\b/.test(n)) {
    const start = startOfLocalDay(now);
    const end = new Date(now);
    // Through end of Sunday (or +7 days)
    const day = end.getDay();
    const daysUntilSunday = day === 0 ? 0 : 7 - day;
    end.setDate(end.getDate() + daysUntilSunday);
    return {
      timeMin: start.toISOString(),
      timeMax: endOfLocalDay(end).toISOString(),
      label: "this week",
      relativeExpression: "this_week",
    };
  }

  // Default / "today" / "check my calendar" → from now through end of today
  // (upcoming remaining today). For generic "check my calendar" without "today",
  // still show the next few days so we don't claim empty when events are soon.
  if (/\btoday\b/.test(n) || /\bafter\s+(?:noon|4|four|\d)/.test(n)) {
    return {
      timeMin: now.toISOString(),
      timeMax: endOfLocalDay(now).toISOString(),
      label: "today",
      relativeExpression: "today",
    };
  }

  // Generic calendar check: next 14 days from now (not only today).
  const fortnight = new Date(now);
  fortnight.setDate(fortnight.getDate() + 14);
  return {
    timeMin: now.toISOString(),
    timeMax: endOfLocalDay(fortnight).toISOString(),
    label: "the next two weeks",
    relativeExpression: "upcoming",
  };
}
