// One date formatter for every surface that shows document timestamps.
// The grid and the list used to keep private copies, and both could print
// "Today" for a timestamp a few hours in the future.

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Clock skew we are willing to treat as "now". */
const FUTURE_TOLERANCE = 2 * MINUTE;

const ABSOLUTE_DATE = { day: "numeric", month: "short", year: "numeric" } as const;
const ABSOLUTE_TIME = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
const LOCALE = "en-US";

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function wholeDaysBetween(later: Date, earlier: Date): number {
  return Math.round((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / DAY);
}

function monthsBetween(later: Date, earlier: Date): number {
  let months = (later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth());
  if (later.getDate() < earlier.getDate()) months -= 1;
  return Math.max(months, 0);
}

/** "Oct 21, 2026, 16:24" - used for titles and accessible labels. */
export function formatAbsoluteDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return `${date.toLocaleDateString(LOCALE, ABSOLUTE_DATE)}, ${date.toLocaleTimeString(LOCALE, ABSOLUTE_TIME)}`;
}

/**
 * Compact relative label for the row or card, always consistent with the
 * updatedAt ordering the list is sorted by. Anything in the future falls back
 * to the absolute date instead of claiming "Today".
 */
export function formatRelativeDate(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return "";

  const delta = now.getTime() - date.getTime();
  if (delta < -FUTURE_TOLERANCE) return formatAbsoluteDate(date);
  if (delta <= MINUTE) return "Just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} min ago`;

  const days = wholeDaysBetween(now, date);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 31) return `${Math.ceil(days / 7)} weeks ago`;
  if (days < 365) return `${monthsBetween(now, date)} months ago`;
  return formatAbsoluteDate(date);
}

/** Sentence case label used in accessible descriptions, e.g. "Updated …". */
export function describeUpdate(value: string | number | Date | null | undefined, now?: Date): string {
  const absolute = formatAbsoluteDate(value);
  if (!absolute) return "No recorded update";
  return `Updated ${formatRelativeDate(value, now)} (${absolute})`;
}
