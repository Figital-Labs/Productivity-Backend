/**
 * Returns the user's "today" as a Date at UTC midnight for the local calendar
 * date in the given IANA timezone. Postgres `@db.Date` stores only Y-M-D and
 * ignores the time component, so UTC midnight is the canonical representation.
 */
export function todayInUserTz(timezone: string): Date {
  return calendarDateInTz(new Date(), timezone);
}

/**
 * Parses a YYYY-MM-DD string into a Date at UTC midnight. The input is assumed
 * to be a calendar date (timezone-naive); the timezone arg is unused here but
 * kept in the signature so callers can pass it for symmetry with `todayInUserTz`.
 */
export function parseDateString(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/**
 * Formats a Date (assumed at UTC midnight) into a YYYY-MM-DD string. Matches
 * the format used by the AI prompts + frontend.
 */
export function formatDateYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Given a "today" Date at UTC midnight, returns the YYYY-MM-DD strings the AI
 * prompts use to anchor relative-date phrases ("today", "kal", "tomorrow", etc.).
 * Yesterday and tomorrow are computed by ±1 UTC day from `today`.
 *
 * This is correct because `todayInUserTz` returns a UTC-midnight Date for the
 * local calendar date in the user's tz — so ±1 UTC day gives the adjacent
 * calendar days in the same tz.
 */
export function promptDateAnchors(today: Date): {
  today: string;
  tomorrow: string;
  yesterday: string;
} {
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return {
    today: formatDateYmd(today),
    tomorrow: formatDateYmd(tomorrow),
    yesterday: formatDateYmd(yesterday),
  };
}

function calendarDateInTz(instant: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const lookup = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) {
      throw new Error(`Intl.DateTimeFormat missing part: ${type}`);
    }
    return part.value;
  };

  return new Date(`${lookup("year")}-${lookup("month")}-${lookup("day")}T00:00:00.000Z`);
}
