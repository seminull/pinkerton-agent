import { useEffect, useMemo, useState } from "react";
import { Box, Group, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import * as m from "motion/react-m";
import type { TimeEntry } from "../api/types";
import EditEntryModal from "./EditEntryModal";
import { formatDuration } from "./format";
import { classifier } from "./options";
import { useActiveEntry, useTimeEntries, useTimeOptions, type TimeRange } from "./queries";
import {
  buildLayout,
  MAX_ENTRIES,
  minutesBetween,
  ticksFor,
  type Kind,
} from "./timeline";

// The day as one horizontal bar: every task a coloured segment at its true
// position and width, every stretch of untracked time between them a hatched
// gap. The table answers "what did I do"; this answers "where did the day go",
// and makes a forgotten Stop or a missing hour obvious at a glance.

// Theme variables, so each colour has a light and a dark value and the rose
// tracks the brand palette. Work is the brand colour because it is the point
// of the chart; break and assistant time are deliberately quieter.
const KIND_STYLE: Record<Kind, { label: string; color: string }> = {
  work: { label: "My work", color: "var(--mantine-color-rose-filled)" },
  break: { label: "Break", color: "var(--mantine-color-yellow-filled)" },
  assistant: { label: "Assistant work", color: "var(--mantine-color-blue-filled)" },
};

// Diagonal hatching reads as "nothing here" without needing a fourth colour,
// and stays distinguishable from the segments for colour-blind users.
const GAP_BACKGROUND =
  "repeating-linear-gradient(135deg, transparent 0 5px, var(--mantine-color-default-border) 5px 7px)";

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const hourLabel = (ms: number): string =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "numeric" });

function LegendDot({ color, label, hatched }: { color?: string; label: string; hatched?: boolean }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box
        w={12}
        h={12}
        style={{
          borderRadius: 3,
          background: hatched ? GAP_BACKGROUND : color,
          border: hatched ? "1px solid var(--mantine-color-default-border)" : undefined,
        }}
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

interface Props {
  /** The day to draw. */
  range: TimeRange;
  /** Shown when the day has nothing on it. Omit to render nothing at all. */
  emptyText?: string;
}

export default function DayTimeline({ range, emptyText }: Props) {
  const entries = useTimeEntries(0, MAX_ENTRIES, range);
  const active = useActiveEntry();
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  // The running task belongs on this day's bar only if it started on this day
  // — the same "an entry lives on the day it started" rule as everywhere else.
  const candidate = active.data?.entry ?? null;
  const running =
    candidate && candidate.startedAt >= range.from && candidate.startedAt < range.to
      ? candidate
      : null;

  // Only ticks while something is running, and only twice a minute: the bar is
  // hundreds of pixels for a whole day, so a second's growth is invisible.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [running]);

  // Segment colours follow the user's own Setup: a category they marked as a
  // break is drawn as one. Until the lists load everything draws as work, and
  // recolours when they arrive.
  const options = useTimeOptions();
  const layout = useMemo(
    () =>
      entries.data
        ? buildLayout(entries.data.results, running, now, classifier(options.data))
        : null,
    [entries.data, running, now, options.data]
  );

  // Quiet while loading: this sits above a table that already shows a spinner,
  // and two of them for one day is noise.
  if (!entries.data) return null;
  if (!layout) {
    return emptyText ? (
      <Text c="dimmed" size="sm">
        {emptyText}
      </Text>
    ) : null;
  }

  const span = layout.axisEnd - layout.axisStart;
  const percent = (ms: number): number => ((ms - layout.axisStart) / span) * 100;
  const ticks = ticksFor(layout.axisStart, layout.axisEnd);
  const kindsShown = (["work", "break", "assistant"] as const).filter((kind) =>
    layout.blocks.some((block) => block.kind === kind)
  );

  return (
    <Stack gap="xs">
      <Group gap="lg">
        <Text size="sm">
          <Text span c="dimmed">
            Day span{" "}
          </Text>
          {clock(layout.firstStart)} – {running ? "now" : clock(layout.lastEnd)}
        </Text>
        <Text size="sm">
          <Text span c="dimmed">
            Tracked{" "}
          </Text>
          {formatDuration(layout.trackedMinutes)}
        </Text>
        <Text size="sm">
          <Text span c="dimmed">
            Gaps{" "}
          </Text>
          {layout.gaps.length === 0
            ? "none"
            : `${formatDuration(layout.gapMinutes)} (${layout.gaps.length})`}
        </Text>
      </Group>

      {/* The bar. Everything inside is positioned by percentage of the axis,
          so it is correct at any width without measuring the element. */}
      <Box
        pos="relative"
        h={44}
        style={{
          borderRadius: "var(--mantine-radius-md)",
          background: "var(--mantine-color-default-hover)",
          overflow: "hidden",
        }}
        role="group"
        aria-label={`Timeline from ${clock(layout.firstStart)} to ${clock(layout.lastEnd)}: ${formatDuration(layout.trackedMinutes)} tracked, ${layout.gaps.length} gap${layout.gaps.length === 1 ? "" : "s"}`}
      >
        {/* Faint hour lines behind the segments, matching the labels below. */}
        {ticks.slice(1, -1).map((tick) => (
          <Box
            key={`line-${tick}`}
            pos="absolute"
            top={0}
            bottom={0}
            left={`${percent(tick)}%`}
            w={1}
            style={{ background: "var(--mantine-color-default-border)" }}
          />
        ))}

        {layout.gaps.map((gap) => (
          <Tooltip
            key={`gap-${gap.start}`}
            withArrow
            label={`Gap · ${clock(gap.start)} – ${clock(gap.end)} · ${formatDuration(minutesBetween(gap.start, gap.end))}`}
          >
            <Box
              pos="absolute"
              top={8}
              bottom={8}
              left={`${percent(gap.start)}%`}
              w={`${percent(gap.end) - percent(gap.start)}%`}
              style={{ background: GAP_BACKGROUND, borderRadius: 4 }}
            />
          </Tooltip>
        ))}

        {layout.blocks.map((block, index) => (
          <Tooltip
            key={block.entry.id}
            withArrow
            multiline
            label={
              <>
                <Text size="sm" fw={600}>
                  {block.entry.task}
                </Text>
                <Text size="xs">{block.entry.category}</Text>
                <Text size="xs">
                  {clock(block.start)} – {block.running ? "now (running)" : clock(block.end)} ·{" "}
                  {formatDuration(minutesBetween(block.start, block.end))}
                </Text>
              </>
            }
          >
            <UnstyledButton
              component={m.button}
              // Segments sweep in left to right in the order the day happened —
              // a quick replay of the day rather than everything at once.
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{
                duration: 0.4,
                ease: [0.22, 1, 0.36, 1],
                // Capped so a busy day's last segment isn't kept waiting.
                delay: Math.min(index * 0.04, 0.5),
              }}
              pos="absolute"
              top={0}
              bottom={0}
              left={`${percent(block.start)}%`}
              // A floor of 3px: a one-minute task on a ten-hour axis would
              // otherwise be a fraction of a pixel and vanish.
              w={`max(${percent(block.end) - percent(block.start)}%, 3px)`}
              // A running task can't be edited until it is stopped. It is marked
              // aria-disabled rather than disabled: a truly disabled button
              // swallows hover in most browsers, and its tooltip ("now,
              // running") is the one people most want to read.
              aria-disabled={block.running}
              onClick={() => {
                if (!block.running) setEditing(block.entry);
              }}
              aria-label={`${block.entry.task}, ${clock(block.start)} to ${block.running ? "now, still running" : clock(block.end)}. ${block.running ? "" : "Edit."}`}
              style={{
                background: KIND_STYLE[block.kind].color,
                transformOrigin: "left center",
                // A hairline between touching segments, so back-to-back tasks
                // read as separate blocks and not one long one.
                boxShadow: "inset -1px 0 0 var(--mantine-color-body)",
                // The running task fades at its leading edge: it has no end yet.
                opacity: block.running ? 0.75 : 1,
                cursor: block.running ? "default" : "pointer",
              }}
            />
          </Tooltip>
        ))}
      </Box>

      {/* Hour labels. A separate row rather than labels inside the bar, where
          they would be covered by the segments they describe. */}
      <Box pos="relative" h={16}>
        {ticks.map((tick, index) => (
          <Text
            key={`label-${tick}`}
            size="xs"
            c="dimmed"
            pos="absolute"
            left={`${percent(tick)}%`}
            style={{
              whiteSpace: "nowrap",
              // Centre each label on its tick, except the two at the ends,
              // which are pinned inward so they don't spill past the bar.
              transform:
                index === 0
                  ? "none"
                  : index === ticks.length - 1 && percent(tick) > 99
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            {hourLabel(tick)}
          </Text>
        ))}
      </Box>

      <Group gap="md">
        {kindsShown.map((kind) => (
          <LegendDot key={kind} color={KIND_STYLE[kind].color} label={KIND_STYLE[kind].label} />
        ))}
        {layout.gaps.length > 0 && <LegendDot hatched label="Gap (nothing tracked)" />}
        {entries.data.total > MAX_ENTRIES && (
          <Text size="xs" c="dimmed">
            Showing the latest {MAX_ENTRIES} of {entries.data.total} entries.
          </Text>
        )}
      </Group>

      {editing && (
        <EditEntryModal key={editing.id} entry={editing} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
}
