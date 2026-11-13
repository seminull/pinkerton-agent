import type { TimeEntry } from "../api/types";
import { ASSISTANT_WORK_TYPE, BREAK_CATEGORY } from "./options";

// The arithmetic behind DayTimeline: turning a day's entries into positioned
// blocks, the gaps between them, and an hour axis. Kept apart from the
// component so it is plain data in, plain data out — nothing here knows about
// React, pixels, or colours.

export type Kind = "work" | "break" | "assistant";

export interface Block {
  entry: TimeEntry;
  kind: Kind;
  start: number;
  end: number;
  /** Still running: its end is "now" and it can't be edited yet. */
  running: boolean;
}

export interface Gap {
  start: number;
  end: number;
}

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
// The API's page-size cap. One request covers any realistic day; a day with
// more entries than this gets a note rather than a silently partial picture.
export const MAX_ENTRIES = 100;

const kindOf = (entry: TimeEntry): Kind =>
  entry.category === BREAK_CATEGORY
    ? "break"
    : entry.workType === ASSISTANT_WORK_TYPE
      ? "assistant"
      : "work";

export const minutesBetween = (start: number, end: number): number =>
  Math.max(0, Math.round((end - start) / MINUTE));

export interface Layout {
  blocks: Block[];
  gaps: Gap[];
  /** Axis bounds: the day's first start and last end, widened to whole hours. */
  axisStart: number;
  axisEnd: number;
  firstStart: number;
  lastEnd: number;
  trackedMinutes: number;
  gapMinutes: number;
}

export const buildLayout = (entries: TimeEntry[], running: TimeEntry | null, now: number): Layout | null => {
  const blocks: Block[] = [
    ...entries.map((entry) => ({
      entry,
      kind: kindOf(entry),
      start: new Date(entry.startedAt).getTime(),
      end: new Date(entry.endedAt ?? entry.startedAt).getTime(),
      running: false,
    })),
    ...(running
      ? [
          {
            entry: running,
            kind: kindOf(running),
            start: new Date(running.startedAt).getTime(),
            // max(): the browser's clock can sit slightly behind the server's,
            // and a just-started task must not get a negative width.
            end: Math.max(now, new Date(running.startedAt).getTime()),
            running: true,
          },
        ]
      : []),
  ].sort((a, b) => a.start - b.start);

  if (blocks.length === 0) return null;

  // Merge overlapping spans before measuring anything. Entries can overlap
  // once times have been edited by hand, and without this an overlap would be
  // counted twice in "tracked" and could produce a negative gap.
  const covered: Gap[] = [];
  for (const block of blocks) {
    const last = covered.at(-1);
    if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
    else covered.push({ start: block.start, end: block.end });
  }

  // A gap is the space between two covered spans. Under a minute isn't one —
  // that is just the second it takes to press Stop and then Start.
  const gaps: Gap[] = [];
  for (let i = 1; i < covered.length; i += 1) {
    const gap = { start: covered[i - 1]!.end, end: covered[i]!.start };
    if (gap.end - gap.start >= MINUTE) gaps.push(gap);
  }

  const firstStart = covered[0]!.start;
  const lastEnd = covered.at(-1)!.end;
  // Widened outward to whole hours so the tick marks land on round times and
  // the first and last segments aren't jammed against the ends of the bar.
  const axisStart = Math.floor(firstStart / HOUR) * HOUR;
  const axisEnd = Math.max(Math.ceil(lastEnd / HOUR) * HOUR, axisStart + HOUR);

  return {
    blocks,
    gaps,
    axisStart,
    axisEnd,
    firstStart,
    lastEnd,
    trackedMinutes: covered.reduce((sum, span) => sum + minutesBetween(span.start, span.end), 0),
    gapMinutes: gaps.reduce((sum, gap) => sum + minutesBetween(gap.start, gap.end), 0),
  };
};

// Hour marks along the axis, thinned so they never crowd: every hour for a
// normal working day, every second or third for a very long one.
export const ticksFor = (axisStart: number, axisEnd: number): number[] => {
  const hours = Math.round((axisEnd - axisStart) / HOUR);
  const step = hours <= 8 ? 1 : hours <= 16 ? 2 : hours <= 24 ? 3 : 6;
  const ticks: number[] = [];
  for (let t = axisStart; t <= axisEnd; t += step * HOUR) ticks.push(t);
  return ticks;
};
