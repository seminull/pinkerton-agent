import type { TimeEntry } from "../api/types";

// Time Clock formatting. Everything is rendered in the browser's own time zone:
// the API stores and returns UTC instants, and "9:14 AM" only means something
// relative to where the person reading it is sitting.

const pad = (n: number): string => String(n).padStart(2, "0");

/** A local calendar date as YYYY-MM-DD — sortable, and unambiguous in a CSV. */
export const formatDay = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const formatClockTime = (iso: string, timeZone?: string): string =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });

// Whole minutes for one completed entry, rounded the same way the server's
// summary rounds (see GET /time-entries/summary) so the Minutes column always
// adds up to the totals shown above it.
export const entryMinutes = (entry: Pick<TimeEntry, "startedAt" | "endedAt">): number =>
  entry.endedAt
    ? Math.max(
        0,
        Math.round(
          (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 60000
        )
      )
    : 0;

/** 135 -> "2h 15m". */
export const formatDuration = (minutes: number): string =>
  `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;

/** Milliseconds -> "HH:MM:SS" for the running clock. Hours don't wrap at 24. */
export const formatElapsed = (ms: number): string => {
  const safe = Math.max(0, ms);
  return [
    Math.floor(safe / 3_600_000),
    Math.floor(safe / 60_000) % 60,
    Math.floor(safe / 1000) % 60,
  ]
    .map(pad)
    .join(":");
};

// The [from, to) instants of a local calendar day, for the API's range filter.
// Built from local-midnight Date objects so a daylight-saving day (23 or 25
// hours long) still gets its true boundaries rather than "+24h".
export const dayRange = (day: Date): { from: string; to: string } => {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
};

/** "2026-11-12" -> a Date at local midnight of that day. */
export const parseDay = (day: string): Date => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!);
};

/** An ISO instant -> "Nov 12, 2026, 3:04:05 PM", in the browser's zone. */
export const formatInstant = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

/** "2026-11-12" -> "Thursday, November 12, 2026". */
export const formatLongDay = (day: string): string =>
  parseDay(day).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

// --- <input type="datetime-local"> ----------------------------------------
// That input speaks "YYYY-MM-DDTHH:mm:ss" in the browser's LOCAL time, with no
// zone. These two convert between that and the UTC instants the API uses.

/** An ISO instant -> the local value a datetime-local input expects. */
export const toLocalInput = (iso: string): string => {
  const date = new Date(iso);
  return `${formatDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
};

/** A datetime-local value -> a Date, or null if the field is blank/invalid. */
export const fromLocalInput = (value: string): Date | null => {
  if (!value) return null;
  // A zone-less date-time string is parsed as local time, which is exactly
  // what the input means by it.
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
