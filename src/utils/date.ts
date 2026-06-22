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

/**
 * Returns the UTC timestamps for the start (00:00:00.000) and end (23:59:59.999)
 * of the given calendar date as observed in the specified timezone.
 *
 * `calendarDate` must be the UTC-midnight Date produced by `todayInUserTz` or
 * `parseDateString` — i.e. the canonical UTC-midnight anchor for that local date.
 */
export function dayBoundsInTz(calendarDate: Date, timezone: string): { start: Date; end: Date } {
  // At UTC midnight (calendarDate), find what local hour:minute the timezone shows.
  // That tells us how far ahead of UTC midnight the timezone's own midnight is.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(calendarDate);

  const tzHour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const tzMinute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

  // UTC midnight lands at tzHour:tzMinute in the local timezone, so local
  // midnight is that many ms *before* UTC midnight.
  const offsetMs = (tzHour * 60 + tzMinute) * 60_000;
  const start = new Date(calendarDate.getTime() - offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/**
 * Hour-of-day (0–23) of a timestamp as observed in the given IANA timezone. Used to
 * bucket task completions into "productive hours" on each user's own local clock.
 */
export function extractHourInTimezone(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  return hour % 24; // some engines emit "24" for midnight
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
