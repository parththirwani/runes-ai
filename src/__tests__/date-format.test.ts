import { describe, expect, it } from "vitest";
import { describeUpdate, formatAbsoluteDate, formatRelativeDate } from "../lib/date-format";

// Fixed local reference point: Wednesday 21 October 2026, 12:00 local time.
const NOW = new Date(2026, 9, 21, 12, 0, 0);
const iso = (y: number, m: number, d: number, hh = 12, mm = 0) =>
  new Date(y, m - 1, d, hh, mm, 0).toISOString();

describe("formatRelativeDate", () => {
  it("labels very recent edits", () => {
    expect(formatRelativeDate(iso(2026, 10, 21, 11, 59), NOW)).toBe("Just now");
    expect(formatRelativeDate(iso(2026, 10, 21, 11, 30), NOW)).toBe("30 min ago");
  });

  it("uses Today and Yesterday on calendar days, not millisecond maths", () => {
    expect(formatRelativeDate(iso(2026, 10, 21, 0, 5), NOW)).toBe("Today");
    expect(formatRelativeDate(iso(2026, 10, 20, 23, 55), NOW)).toBe("Yesterday");
    expect(formatRelativeDate(iso(2026, 10, 17), NOW)).toBe("4 days ago");
    expect(formatRelativeDate(iso(2026, 10, 1), NOW)).toBe("3 weeks ago");
    expect(formatRelativeDate(iso(2026, 6, 1), NOW)).toBe("4 months ago");
  });

  it("never says Today for a timestamp in the future", () => {
    const future = iso(2026, 10, 24, 9, 0);
    const label = formatRelativeDate(future, NOW);
    expect(label).not.toBe("Today");
    expect(label).toContain("2026");
  });

  it("switches to an absolute date once a year has passed", () => {
    expect(formatRelativeDate(iso(2025, 3, 4), NOW)).toContain("2025");
  });

  it("returns an empty string instead of Invalid Date", () => {
    expect(formatRelativeDate("not a date")).toBe("");
    expect(formatRelativeDate(null)).toBe("");
    expect(formatRelativeDate(undefined)).toBe("");
  });
});

describe("formatAbsoluteDate", () => {
  it("renders a stable, readable timestamp for tooltips", () => {
    expect(formatAbsoluteDate(iso(2026, 10, 21, 9, 5))).toBe("Oct 21, 2026, 09:05");
    expect(formatAbsoluteDate(null)).toBe("");
  });
});

describe("describeUpdate", () => {
  it("combines both forms for accessible labels", () => {
    expect(describeUpdate(iso(2026, 10, 20, 12, 0), NOW)).toBe(
      "Updated Yesterday (Oct 20, 2026, 12:00)",
    );
    expect(describeUpdate(null)).toBe("No recorded update");
  });
});
