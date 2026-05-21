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
