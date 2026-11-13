import { formatDay } from "./format";

// Reads a time-log CSV for backfilling: the file this app's own "Export for
// Excel" writes, and the near-identical one the standalone tracker that
// preceded it wrote. Pure text in, plain data out — no React, no network — so
// the awkward part (dates, times, quoting) can be tested on its own.

/** One usable row, already converted to instants in the browser's time zone. */
export interface ImportRow {
  /** 1-based line in the file, for pointing at problems. */
  line: number;
  category: string;
  task: string;
  reference: string | null;
  workType: string;
  notes: string | null;
  /** ISO instants. */
  startedAt: string;
  endedAt: string;
}

export interface ImportProblem {
  line: number;
  reason: string;
}

export interface CsvImport {
  rows: ImportRow[];
  /** Rows that couldn't be used, and why. They are left out, not guessed at. */
  problems: ImportProblem[];
}

// RFC 4180: quoted fields, "" for a literal quote, commas and line breaks
// allowed inside quotes. Written out rather than split(",") because task
// descriptions and notes are free text and absolutely contain commas.
const parseCsv = (source: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Excel writes a byte-order mark at the start; left in, it would glue itself
  // to the first header name and "Date" would never match.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  // The last line usually has no trailing newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

// Header names this accepts for each column, lowercased. Both generations of
// the export are covered ("Start" / "Start Time", "File Reference" / "File
// Nickname"), so a file doesn't have to be edited before it can be imported.
const HEADERS = {
  date: ["date"],
  start: ["start", "start time"],
  end: ["end", "end time"],
  category: ["category"],
  task: ["task", "task description"],
  reference: ["file reference", "file nickname", "file ref", "file ref.", "reference"],
  workType: ["work type", "worktype"],
  notes: ["notes", "note"],
} as const;

type Column = keyof typeof HEADERS;
// Without these there is nothing to import. Work type, file reference, and
// notes are optional columns.
const REQUIRED: Column[] = ["date", "start", "end", "category", "task"];

// What a row gets when the file has no Work Type column, or leaves it blank.
// It is the first default work type, so it exists for every user.
const DEFAULT_WORK_TYPE = "My work";

// "2026-11-09", or "11/9/2026" — the second because Excel silently rewrites
// ISO dates to the local format when a CSV is opened and saved again.
const parseDate = (value: string): { year: number; month: number; day: number } | null => {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : us
      ? {
          year: us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]),
          month: Number(us[1]),
          day: Number(us[2]),
        }
      : null;
  if (!parts) return null;
  // Round-trip through Date to reject impossible dates: JS turns Feb 31 into
  // Mar 3 without complaint.
  const check = new Date(parts.year, parts.month - 1, parts.day);
  return check.getFullYear() === parts.year &&
    check.getMonth() === parts.month - 1 &&
    check.getDate() === parts.day
    ? parts
    : null;
};

// "10:45:25 AM", "1:03 PM", or 24-hour "13:03:16". Seconds are optional.
const parseTime = (value: string): { hours: number; minutes: number; seconds: number } | null => {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]?\.?$|^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
    value
  );
  if (!match) return null;
  const meridiem = match[4]?.toUpperCase();
  let hours = Number(match[1] ?? match[5]);
  const minutes = Number(match[2] ?? match[6]);
  const seconds = Number(match[3] ?? match[7] ?? 0);
  if (minutes > 59 || seconds > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    // 12 AM is midnight and 12 PM is noon — the one place AM/PM isn't "+12".
    hours = (hours % 12) + (meridiem === "P" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return { hours, minutes, seconds };
};

/**
 * Parse a time-log CSV. Throws only when the file as a whole is unusable (not
 * a CSV with the expected columns); individual bad rows are reported in
 * `problems` and left out.
 */
export const parseTimeCsv = (source: string, now: Date = new Date()): CsvImport => {
  const table = parseCsv(source);
  const header = table[0]?.map((name) => name.trim().toLowerCase());
  if (!header) throw new Error("That file is empty.");

  const column = {} as Record<Column, number>;
  for (const key of Object.keys(HEADERS) as Column[]) {
    column[key] = header.findIndex((name) => (HEADERS[key] as readonly string[]).includes(name));
  }
  const missing = REQUIRED.filter((key) => column[key] === -1);
  if (missing.length > 0) {
    throw new Error(
      `This doesn't look like a time log. It needs columns for ${missing
        .map((key) => HEADERS[key][0])
        .join(", ")} — the first line should be the column names.`
    );
  }

  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];

  table.slice(1).forEach((cells, index) => {
    // +2: one for the header line, one because people count lines from 1.
    const line = index + 2;
    const get = (key: Column): string => (column[key] === -1 ? "" : (cells[column[key]] ?? "").trim());
    // A blank line (Excel adds them at the end) isn't a problem, it's nothing.
    if (cells.every((cell) => cell.trim() === "")) return;

    const date = parseDate(get("date"));
    const start = parseTime(get("start"));
    const end = parseTime(get("end"));
    if (!date) return void problems.push({ line, reason: `unreadable date "${get("date")}"` });
    if (!start) return void problems.push({ line, reason: `unreadable start time "${get("start")}"` });
    if (!end) return void problems.push({ line, reason: `unreadable end time "${get("end")}"` });
    if (!get("category")) return void problems.push({ line, reason: "no category" });
    if (!get("task")) return void problems.push({ line, reason: "no task description" });

    // Built from parts in LOCAL time: the file holds wall-clock times with no
    // zone, and they were written on a clock in the same zone as this browser.
    const startedAt = new Date(date.year, date.month - 1, date.day, start.hours, start.minutes, start.seconds);
    const endedAt = new Date(date.year, date.month - 1, date.day, end.hours, end.minutes, end.seconds);
    // The file has one date per row, so an end time earlier than the start can
    // only mean the task ran past midnight.
    if (endedAt.getTime() < startedAt.getTime()) endedAt.setDate(endedAt.getDate() + 1);
    if (endedAt.getTime() > now.getTime()) {
      return void problems.push({ line, reason: "it ends in the future" });
    }

    rows.push({
      line,
      category: get("category"),
      task: get("task"),
      reference: get("reference") || null,
      workType: get("workType") || DEFAULT_WORK_TYPE,
      notes: get("notes") || null,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    });
  });

  return { rows, problems };
};

/** One line of the import preview: a day, how many entries, how long. */
export interface ImportDay {
  day: string;
  entries: number;
  minutes: number;
}

/** Group parsed rows by local start day, oldest first, for the preview. */
export const summarizeByDay = (rows: ImportRow[]): ImportDay[] => {
  const days = new Map<string, ImportDay>();
  for (const row of rows) {
    const day = formatDay(new Date(row.startedAt));
    const entry = days.get(day) ?? { day, entries: 0, minutes: 0 };
    entry.entries += 1;
    // Rounded per entry, then summed — the same rule as every other total in
    // the Time Clock, so the preview matches what the calendar will show.
    entry.minutes += Math.max(
      0,
      Math.round((new Date(row.endedAt).getTime() - new Date(row.startedAt).getTime()) / 60000)
    );
    days.set(day, entry);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
};
